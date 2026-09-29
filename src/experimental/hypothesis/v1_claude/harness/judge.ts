import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { EvaluationBundle, HypothesisRunManifest } from '../../shared/contracts.js';
import type { AlignedWord, Timeline } from '../types.js';
import { chatVision } from '../llm/openrouter.js';
import { parseCandidates } from '../llm/structuredCall.js';
import { judgeRunEligibility, resolveLocalRunArtifact, sourceDocMatchesRecordedHash, type JudgeNarration } from './judgeEligibility.js';
import { judgeCacheKey, readJudgeCache, writeJudgeCache } from './judgeCache.js';

/**
 * VLM judge (hypothesis/v1_claude/03 §5): fixed, versioned prompts; JSON
 * answers validated with zod; costs accounted against the separate judge cap
 * (EXPERIMENT.maxJudgeCostUsd). J-simi runs in BOTH presentation orders and a
 * win only counts when the two orders agree. Judge outputs are evaluation
 * data, never fed back into generation.
 */
export const JUDGE_PROMPT_VERSION = 'judge/v3';

export const J_CLARITY = (narration: string) => `You see the final frame of one scene of a whiteboard teaching video. Narration: "${narration}".
1) Would a first-time learner understand the idea from this visual + narration? 1-5
2) Does the visual show the relationship/mechanism, or only list things? "mechanism"|"list"
3) One concrete improvement (<=20 words).
Answer ONLY JSON: {"clarity":n,"type":"mechanism"|"list","fix":"..."}`;

export const J_STYLE = `Rate 1-5 whether every element in this frame looks drawn by the same illustrator (stroke weight, line style, fill palette, lettering). List up to 3 elements that break the style.
Answer ONLY JSON: {"score":n,"offenders":["..."]}`;

export const J_TIMED = (narration: string, states: Array<{ timeMs: number; activeWord?: string }>) => `These three frames are ordered samples from one completed whiteboard teaching scene. Narration: "${narration}".
Frame timestamps and word spoken at that time: ${JSON.stringify(states)}.
Rate whether the diagram builds in a coherent order, its reveals support the spoken mechanism, and important objects do not appear too early or late. Judge timing from the full sequence, not only the final board.
Answer ONLY JSON: {"score":1-5,"sequenceCoherent":true|false,"mechanismVisible":true|false,"issues":["..."]}`;

export const J_SIMI = `Frame A is the first image, Frame B the second. Which looks more like a polished whiteboard explainer (clean marker strokes, flat pastel fills, clear diagram, good use of space)? Ignore watermarks and logos.
Answer ONLY JSON: {"winner":"A"|"B"|"tie","reasons":["..."]}`;

const ClaritySchema = z.object({ clarity: z.number().min(1).max(5), type: z.enum(['mechanism', 'list']), fix: z.string() });
const StyleSchema = z.object({ score: z.number().min(1).max(5), offenders: z.array(z.string()) });
const TimedSchema = z.object({ score: z.number().min(1).max(5), sequenceCoherent: z.boolean(), mechanismVisible: z.boolean(), issues: z.array(z.string()) });
const SimiSchema = z.object({ winner: z.enum(['A', 'B', 'tie']), reasons: z.array(z.string()) });

export function frameAt(video: string, seconds: number, width = 1280): Buffer {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', seconds.toFixed(2), '-i', video, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0 || r.stdout.length === 0) throw new Error(`could not extract a frame at ${seconds}s from ${video}`);
  return r.stdout;
}

export interface JudgeContext {
  model: string;
  apiKey: string;
  budgetUsd: number;
  spentUsd: number;
  cacheDir?: string;
  cacheHits?: number;
  cacheMisses?: number;
}

async function ask<T>(ctx: JudgeContext, prompt: string, images: Buffer[], schemaId: string, schema: z.ZodType<T>): Promise<{ value?: T; error?: string }> {
  const key = judgeCacheKey({ model: ctx.model, promptVersion: JUDGE_PROMPT_VERSION, schemaId, prompt, images });
  const cached = await readJudgeCache(ctx.cacheDir, key, schema);
  if (cached !== undefined) {
    ctx.cacheHits = (ctx.cacheHits ?? 0) + 1;
    return { value: cached };
  }
  ctx.cacheMisses = (ctx.cacheMisses ?? 0) + 1;
  if (ctx.spentUsd >= ctx.budgetUsd) return { error: `judge budget ($${ctx.budgetUsd}) exhausted` };
  const r = await chatVision(ctx.apiKey, { model: ctx.model, prompt, imagesPng: images, maxTokens: 1200, signal: AbortSignal.timeout(90_000) });
  ctx.spentUsd += r.usage.costUsd;
  const parsed = parseCandidates(r.content, schema);
  if (!parsed.ok) return { error: parsed.error };
  await writeJudgeCache(ctx.cacheDir, key, parsed.value).catch(() => undefined);
  return { value: parsed.value };
}

export interface SceneJudgement {
  sceneId: string;
  atSec: number;
  clarity?: z.infer<typeof ClaritySchema>;
  style?: z.infer<typeof StyleSchema>;
  timed?: z.infer<typeof TimedSchema>;
  simi?: { reference: string; orderAB?: string; orderBA?: string; consistent: 'ours' | 'reference' | 'tie' | 'inconsistent' };
  errors: string[];
}

export function timedSamplePoints(timeline: Timeline, words: AlignedWord[]): Array<{ timeMs: number; activeWord?: string }> {
  const lo = timeline.sceneStartMs;
  const hi = timeline.sceneEndMs - 1;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) throw new Error(`invalid scene bounds for timed judging: ${timeline.sceneId}`);
  const eventTimes = [...new Set(timeline.events.map((event) => event.t0).filter((time) => Number.isFinite(time) && time >= lo && time <= hi))].sort((a, b) => a - b);
  const candidateTimes = eventTimes.length >= 3
    ? [eventTimes[0], eventTimes[Math.floor((eventTimes.length - 1) / 2)], eventTimes[eventTimes.length - 1]].map((time) => Math.min(hi, time + 300))
    : [lo + (hi - lo) * 0.2, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.8];
  return [...new Set(candidateTimes.map((time) => Math.round(time)))].map((timeMs) => {
    const activeWord = words.filter((word) => word.startMs <= timeMs && word.endMs >= timeMs).at(-1)?.w ?? words.filter((word) => word.startMs <= timeMs).at(-1)?.w;
    return { timeMs, ...(activeWord ? { activeWord } : {}) };
  });
}

/** Judge final boards and three timeline-selected moments from every eligible generated scene. */
export async function judgeRun(runDir: string, laminaFrames: Array<{ label: string; png: Buffer }>, ctx: JudgeContext, topic?: string, topicAliases: string[] = []): Promise<SceneJudgement[]> {
  const root = path.resolve(runDir);
  const manifest = JSON.parse(readFileSync(path.join(root, 'run-manifest.json'), 'utf8')) as HypothesisRunManifest & { runClass?: string; status?: string; video?: string };
  const bundle = JSON.parse(readFileSync(path.join(root, 'evaluation-bundle.json'), 'utf8')) as EvaluationBundle;
  const narration = JSON.parse(readFileSync(path.join(root, 'narration.json'), 'utf8')) as JudgeNarration & { scenes: Array<{ sceneId: string; plainText: string }> };
  if (laminaFrames.length && !topic) throw new Error('topic-matched Lamina frames require an explicit topic');
  const videoPath = resolveLocalRunArtifact(root, manifest.video) ?? '';
  const sourceDocPath = resolveLocalRunArtifact(root, bundle.nativeArtifacts.sourceDoc);
  const videoExists = Boolean(videoPath) && existsSync(videoPath) && statSync(videoPath).isFile();
  const sourceDocExists = sourceDocPath !== undefined && existsSync(sourceDocPath) && statSync(sourceDocPath).isFile();
  const sourceDoc = sourceDocExists ? JSON.parse(readFileSync(sourceDocPath!, 'utf8')) as { title?: string } : undefined;
  const eligibility = judgeRunEligibility({ manifest, bundle, narration, videoExists, sourceDocExists, sourceDocHashMatchesManifest: sourceDoc ? sourceDocMatchesRecordedHash(manifest, sourceDoc) : false, topic, sourceTitle: sourceDoc?.title, topicAliases });
  if (eligibility.length) throw new Error(`run is not eligible for visual-quality judging: ${eligibility.join('; ')}`);
  const audio = JSON.parse(readFileSync(path.join(root, 'aligned-audio.json'), 'utf8')) as { sceneBoundsMs: Record<string, { startMs: number; endMs: number }>; sceneWords: Record<string, AlignedWord[]> };
  const out: SceneJudgement[] = [];
  for (const scene of narration.scenes) {
    const b = audio.sceneBoundsMs[scene.sceneId];
    if (!b) throw new Error(`aligned-audio clock is missing scene ${scene.sceneId}`);
    if (!Number.isFinite(b.startMs) || !Number.isFinite(b.endMs) || b.endMs <= b.startMs) throw new Error(`invalid aligned-audio bounds for scene ${scene.sceneId}`);
    const atSec = Math.max(b.startMs, b.endMs - 500) / 1000;
    const png = frameAt(videoPath, atSec);
    const j: SceneJudgement = { sceneId: scene.sceneId, atSec, errors: [] };
    const c = await ask(ctx, J_CLARITY(scene.plainText), [png], 'clarity/v1', ClaritySchema);
    if (c.value) j.clarity = c.value; else j.errors.push(`clarity: ${c.error}`);
    const s = await ask(ctx, J_STYLE, [png], 'style/v1', StyleSchema);
    if (s.value) j.style = s.value; else j.errors.push(`style: ${s.error}`);
    const timeline = JSON.parse(readFileSync(path.join(root, `timeline.${scene.sceneId}.json`), 'utf8')) as Timeline;
    const points = timedSamplePoints(timeline, audio.sceneWords[scene.sceneId] ?? []);
    const timedImages = points.map((point) => frameAt(videoPath, point.timeMs / 1000));
    const timed = await ask(ctx, J_TIMED(scene.plainText, points), timedImages, 'timed/v1', TimedSchema);
    if (timed.value) j.timed = timed.value; else j.errors.push(`timed sequence: ${timed.error}`);
    if (laminaFrames.length) {
      const ref = laminaFrames[out.length % laminaFrames.length];
      const ab = await ask(ctx, J_SIMI, [png, ref.png], 'simi/v1', SimiSchema); // ours = A
      const ba = await ask(ctx, J_SIMI, [ref.png, png], 'simi/v1', SimiSchema); // ours = B
      const ourWinAB = ab.value?.winner === 'A', ourWinBA = ba.value?.winner === 'B';
      const refWinAB = ab.value?.winner === 'B', refWinBA = ba.value?.winner === 'A';
      const consistent = ourWinAB && ourWinBA ? 'ours' : refWinAB && refWinBA ? 'reference' : ab.value?.winner === 'tie' && ba.value?.winner === 'tie' ? 'tie' : 'inconsistent';
      j.simi = { reference: ref.label, orderAB: ab.value?.winner, orderBA: ba.value?.winner, consistent };
      if (ab.error) j.errors.push(`simi A/B: ${ab.error}`);
      if (ba.error) j.errors.push(`simi B/A: ${ba.error}`);
    }
    out.push(j);
  }
  return out;
}
