#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EXPERIMENT, type EvaluationBundle, type HypothesisRunManifest } from '../../shared/contracts.js';
import { loadOpenRouterEnv } from '../planner/env.js';
import { frameAt, judgeRun, JUDGE_PROMPT_VERSION, type SceneJudgement } from './judge.js';
import { judgeRunEligibility, resolveLocalRunArtifact, sourceDocMatchesRecordedHash, type JudgeNarration } from './judgeEligibility.js';
import { sha256 } from '../../shared/artifacts.js';

/**
 * Judge rendered runs against the Lamina reference pack and write a report
 * (hypothesis/v1_claude/03 §7 format, the parts this harness measures).
 * Usage: node judgeCli.js --runs=.data/hypothesis-runs/claude/lessons [--topic=photosynthesis] [--judge=<vision model>] [--refs=6]
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const runsRoot = arg('runs') ?? '.data/hypothesis-runs/claude/lessons';
  const topic = arg('topic')?.trim().toLowerCase();
  const env = await loadOpenRouterEnv();
  const model = arg('judge') ?? env.visionModel;
  if (!model) throw new Error('No judge model: pass --judge=<model> or set OPENROUTER_VISION_MODEL in .env');

  // A topic must be explicit before any Simi comparison; untagged runs receive style/clarity scores only.
  const refRoot = 'harness/reference/lamina';
  const index = JSON.parse(await readFile(path.join(refRoot, 'index.json'), 'utf8')) as Array<{ video: string; scene: number; endS: number }>;
  const topicMapBytes = await readFile(path.join(refRoot, 'topics.v1.json'));
  const topicMapHash = sha256(topicMapBytes);
  const topicIndex = JSON.parse(topicMapBytes.toString('utf8')) as { schemaVersion: string; topics: Record<string, string>; aliases?: Record<string, string[]> };
  if (topicIndex.schemaVersion !== 'lamina-reference-topics/v1') throw new Error('Unsupported Lamina reference topic map');
  const refCount = Number(arg('refs') ?? 6);
  if (!Number.isInteger(refCount) || refCount < 1 || refCount > 20) throw new Error('--refs must be an integer from 1 to 20');
  if (topic && !Object.values(topicIndex.topics).includes(topic)) throw new Error(`No reference topic is tagged ${topic}`);
  const matchingReferences = topic
    ? index.filter((reference) => topicIndex.topics[reference.video]?.toLowerCase() === topic)
    : [];
  if (topic && !matchingReferences.length) throw new Error(`No Lamina reference frames are tagged for topic ${topic}`);
  const laminaFrames = matchingReferences.slice(0, refCount).map((r) => ({ label: `${r.video}#${r.scene} (${topic})`, png: frameAt(path.join('../lamina-labs-video', r.video), Math.max(0, r.endS - 0.7)) }));

  const ctx = { model, apiKey: env.apiKey, budgetUsd: EXPERIMENT.maxJudgeCostUsd, spentUsd: 0, cacheDir: path.resolve(arg('cache-dir') ?? '.data/hypothesis-runs/judge-cache'), cacheHits: 0, cacheMisses: 0 };
  const runs = (await readdir(runsRoot, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const results: Record<string, SceneJudgement[]> = {};
  const skipped: Record<string, string[]> = {};
  for (const run of runs) {
    try {
      const runDir = path.join(runsRoot, run);
      const [manifestText, evaluationText, narrationText] = await Promise.all([
        readFile(path.join(runDir, 'run-manifest.json'), 'utf8'),
        readFile(path.join(runDir, 'evaluation-bundle.json'), 'utf8'),
        readFile(path.join(runDir, 'narration.json'), 'utf8'),
      ]);
      const manifest = JSON.parse(manifestText) as HypothesisRunManifest & { runClass?: string; status?: string; video?: string };
      const bundle = JSON.parse(evaluationText) as EvaluationBundle;
      const narration = JSON.parse(narrationText) as JudgeNarration;
      const videoPath = resolveLocalRunArtifact(runDir, manifest.video);
      const sourceDocPath = resolveLocalRunArtifact(runDir, bundle.nativeArtifacts.sourceDoc);
      const videoExists = Boolean(videoPath) && await stat(videoPath!).then((item) => item.isFile(), () => false);
      const sourceDocExists = Boolean(sourceDocPath) && await stat(sourceDocPath!).then((item) => item.isFile(), () => false);
      const sourceDoc = sourceDocExists ? JSON.parse(await readFile(sourceDocPath!, 'utf8')) as { title?: string } : undefined;
      const eligibility = judgeRunEligibility({ manifest, bundle, narration, videoExists, sourceDocExists, sourceDocHashMatchesManifest: sourceDoc ? sourceDocMatchesRecordedHash(manifest, sourceDoc) : false, topic, sourceTitle: sourceDoc?.title, topicAliases: topic ? topicIndex.aliases?.[topic] ?? [] : [] });
      if (eligibility.length) {
        skipped[run] = eligibility;
        console.log(`${run}: skipped from visual quality report (${eligibility.join('; ')})`);
        continue;
      }
      results[run] = await judgeRun(runDir, laminaFrames, ctx, topic, topic ? topicIndex.aliases?.[topic] ?? [] : []);
      console.log(`${run}: ${results[run].length} scenes judged, spent $${ctx.spentUsd.toFixed(4)}`);
    } catch (error) {
      skipped[run] = [error instanceof Error ? error.message : String(error)];
      console.error(`${run}: skipped (${skipped[run][0]})`);
    }
  }

  const all = Object.values(results).flat();
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined);
  const clarity = mean(all.flatMap((j) => (j.clarity ? [j.clarity.clarity] : [])));
  const style = mean(all.flatMap((j) => (j.style ? [j.style.score] : [])));
  const timedScore = mean(all.flatMap((j) => (j.timed ? [j.timed.score] : [])));
  const timedJudged = all.filter((j) => j.timed).length;
  const timedCoherent = timedJudged ? all.filter((j) => j.timed?.sequenceCoherent).length / timedJudged : undefined;
  const judgedClarity = all.filter((j) => j.clarity).length;
  const mech = judgedClarity ? all.filter((j) => j.clarity?.type === 'mechanism').length / judgedClarity : undefined;
  const simi = { ours: 0, reference: 0, tie: 0, inconsistent: 0 } as Record<string, number>;
  for (const j of all) if (j.simi) simi[j.simi.consistent]++;

  const date = new Date().toISOString().slice(0, 10);
  await mkdir('harness/reports', { recursive: true });
  const base = `harness/reports/${date}-judge`;
  await writeFile(`${base}.json`, `${JSON.stringify({ judgeModel: model, promptVersion: JUDGE_PROMPT_VERSION, topic: topic ?? null, referenceMode: topic ? 'topic-matched' : 'style-only', referenceTopicMapVersion: topicIndex.schemaVersion, referenceTopicMapSha256: topicMapHash, referenceFrames: laminaFrames.map(({ label }) => label), spentUsd: ctx.spentUsd, judgeCache: { directory: ctx.cacheDir, hits: ctx.cacheHits, misses: ctx.cacheMisses }, results, skipped }, null, 2)}\n`);
  const lines = [
    `# VLM judge report — ${date}`,
    '',
    `Judge: \`${model}\` · prompts \`${JUDGE_PROMPT_VERSION}\` · spend $${ctx.spentUsd.toFixed(4)} (cap $${EXPERIMENT.maxJudgeCostUsd}) · ${ctx.cacheHits} cache hits / ${ctx.cacheMisses} misses · ${all.length} scenes from ${Object.keys(results).length} runs.`,
    topic ? `Simi references: topic-matched to \`${topic}\` (${laminaFrames.map(({ label }) => label).join(', ')}).` : 'Simi pairing disabled: this report is style-only because no explicit --topic was supplied.',
    `Reference-topic map: \`${topicIndex.schemaVersion}\` · SHA-256 \`${topicMapHash}\`.`,
    `${Object.keys(skipped).length} run directories excluded by generated-run eligibility checks.`,
    'Judge-human agreement has NOT been calibrated yet (03 §5 hygiene step); treat these numbers as indicative.',
    '',
    '| Metric | Value | Week-1 target (03 §3) |',
    '|---|---|---|',
    `| Teaching clarity (J-clarity, 1-5) | ${clarity === undefined ? 'not measured' : clarity.toFixed(2)} | ≥ 3.8 |`,
    `| Timed sequence (J-timed, 1-5) | ${timedScore === undefined ? 'not measured' : timedScore.toFixed(2)} | — |`,
    `| Coherent timed sequences | ${timedCoherent === undefined ? 'not measured' : `${(timedCoherent * 100).toFixed(0)}%`} | — |`,
    `| Mechanism vs list | ${mech === undefined ? 'not measured' : `${(mech * 100).toFixed(0)}% mechanism`} | — |`,
    `| Style coherence (J-style, 1-5) | ${style === undefined ? 'not measured' : style.toFixed(2)} | ≥ 4.0 |`,
    `| J-simi vs Lamina (order-consistent) | ${topic ? `ours ${simi.ours} · Lamina ${simi.reference} · tie ${simi.tie} · inconsistent ${simi.inconsistent}` : 'not run (style-only mode)'} | — |`,
    '',
    '## Per scene',
    '',
    '| Run | Scene | Clarity | Timed | Sequence | Style | J-simi | Suggested fix / timed issues |',
    '|---|---|---|---|---|---|---|---|',
    ...Object.entries(results).flatMap(([run, js]) => js.map((j) => `| ${run} | ${j.sceneId} | ${j.clarity?.clarity ?? '—'} | ${j.timed?.score ?? '—'} | ${j.timed?.sequenceCoherent ?? '—'} | ${j.style?.score ?? '—'} | ${j.simi?.consistent ?? '—'} | ${[j.clarity?.fix, ...(j.timed?.issues ?? []), ...j.errors].filter(Boolean).join('; ').replace(/\|/g, '/')} |`)),
    '',
  ];
  await writeFile(`${base}.md`, lines.join('\n'));
  console.log(`report: ${base}.md`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
