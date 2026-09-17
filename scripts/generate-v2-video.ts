/** Live V2 topic video: plan -> direct -> narrate -> export narrated MP4.
 *
 *  Usage:
 *    npm run build && node --env-file-if-exists=.env dist/scripts/generate-v2-video.js \
 *      --out output/<name> --prompt "..." --archetypes cause_effect,transformation \
 *      --scenes 2 --narration
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { documentIdentity } from '../src/shared/document.js';
import { join } from 'node:path';
import { createJsonModel } from '../src/semantic/planning/model-adapter.js';
import { generateV2 } from '../src/semantic/planning/generate.js';
import { createVoiceEngineSpeech } from '../src/semantic/speech.js';
import { writeV2Artifacts } from '../src/semantic/artifacts.js';
import { lintCompiledScene } from '../src/semantic/evaluation.js';
import {readdir,access} from 'node:fs/promises';
import {concatVideos} from '../src/semantic/artifacts.js';
import type { VisualArchetype } from '../src/semantic/types.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.findIndex(a => a === `--${name}`);
  if (i >= 0) return args[i + 1];
  return fallback;
};
const out = flag('out', 'output/v2-topic-video')!;
const prompt = flag('prompt');
if (!prompt) throw new Error('Missing --prompt "..."');
const archetypes = (flag('archetypes', 'cause_effect,transformation,flow,structural_diagram')!).split(',') as VisualArchetype[];
/** Scene count comes from the requested length unless pinned explicitly. */
const targetMinutes = Number(flag('minutes', '1'));
const maxScenes = Number(flag('scenes', String(Math.min(120, Math.max(1, Math.ceil((targetMinutes * 60) / 30))))));
/** A document source, not just a prompt. The semantic pipeline grounds teaching
 *  in `sourceText` (knowledge compiler, evidence, source-visual-grounding) and
 *  the CLI never exposed it, so every run treated a long report as a one-line
 *  prompt. `--source <file>` reads the file and passes it as the grounded source. */
const sourceFile = flag('source');
const sourceText = sourceFile ? await readFile(sourceFile, 'utf8') : undefined;
/** The plan schema constrains every id, including evidence sourceId, to
 *  `^[a-z][a-z0-9_-]*$` - no dots. Passing a filename verbatim produced
 *  `deepseek-report-excerpt.md`, which failed validation as an invalid string and
 *  killed the whole source-grounded run. */
const sourceId = sourceFile ? (basename(sourceFile).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/g, '-').replace(/^[^a-z]+/, '') || 'source') : undefined;
/** What document is being taught, derived from the source itself. */
const identity = documentIdentity({ ...(sourceText ? { text: sourceText } : {}), ...(sourceId ? { sourceId } : {}) });
const narrate = args.includes('--narration');
/** Cost ceiling scales with the requested length: a 20-minute lesson is 40 scenes
 *  and cannot run inside a one-minute cap. */
/** The model adapter caps any single run at $2, so scaling must respect that. */
const maxCostUsd = Number(flag('budget', String(Math.min(2, Math.max(0.5, targetMinutes * 0.35)).toFixed(2))));

await mkdir(out, { recursive: true });
const model = createJsonModel({ env: process.env, maxCostUsd });
const speech = narrate ? createVoiceEngineSpeech({ env: process.env, language: 'en' }) : undefined;
const start = performance.now();
let scenes = 0, exported = 0;

try {
  for await (const result of generateV2({ prompt, maxScenes, allowedArchetypes: archetypes, language: 'en', targetMinutes, ...(sourceText ? { sourceText, sourceId } : {}), ...(identity ? { documentTitle: identity.title, documentAuthors: identity.authors, documentKind: identity.kind } : {}) }, model, {
    ...(speech ? { speech } : {}),
  })) {
    scenes++;
    const dir = join(out, result.compiled.scene.id);
    await mkdir(dir, { recursive: true });
    const findings = lintCompiledScene(result.compiled);
    await writeFile(join(dir, 'findings.json'), JSON.stringify(findings, null, 2));
    await writeFile(join(dir, 'diagnostics.json'), JSON.stringify(result.compiled.diagnostics, null, 2));
    if (findings.some(f => f.severity === 'hard')) {
      await writeFile(join(dir, 'scene.json'), JSON.stringify(result.compiled.scene, null, 2));
      console.log(`scene ${scenes}: ${result.compiled.scene.id} PREFLIGHT-HARD ${findings.filter(f => f.severity === 'hard').map(f => f.code).join(',')}`);
      continue;
    }
    await writeV2Artifacts(result.compiled, dir, {
      video: true,
      ...(result.speech ? { audio: { data: result.speech.audio, format: result.speech.format ?? 'wav' } } : {}),
    });
    exported++;
    await writeFile(join(dir, 'narration.txt'), result.narration.text);
    await writeFile(join(dir, 'metrics.json'), JSON.stringify(result.metrics, null, 2));
    console.log(`scene ${scenes}: ${result.compiled.scene.id} archetype=${result.compiled.scene.archetype} duration=${result.compiled.durationMs}ms timing=${result.compiled.timing.kind} diagnostics=${JSON.stringify(result.compiled.diagnostics)}`);
  }
  // The lesson itself: one file a learner can watch end to end. Without this the
  // run produced only per-scene parts and no answer to "make a one-minute video".
  let lessonPath: string | undefined;
  const parts: string[] = [];
  for (const name of await readdir(out)) {
    const part = join(out, name, 'narrated.mp4');
    try { await access(part); parts.push(part); } catch { /* scene not exported */ }
  }
  parts.sort();
  if (parts.length) {
    lessonPath = join(out, 'lesson.mp4');
    await concatVideos(parts, lessonPath);
    console.log(`lesson: ${lessonPath} from ${parts.length} scene(s)`);
  }
  const cost = model.calls.reduce((s, c) => s + c.costUsd, 0);
  await writeFile(join(out, 'report.json'), JSON.stringify({
    status: exported > 0 ? 'complete' : 'failed', scenes, exported, wallMs: Math.round(performance.now() - start),
    costUsd: cost, calls: model.calls.length, narrated: narrate,
    lesson: lessonPath ?? null, lessonParts: parts.length,
  }, null, 2));
  if (exported === 0) throw new Error('No scene passed deterministic preflight; see per-scene findings.json');
  console.log(JSON.stringify({ out, scenes, exported, costUsd: cost }));
} catch (e) {
  const error = e instanceof Error ? e.message : String(e);
  await writeFile(join(out, 'failure.json'), JSON.stringify({ status: 'failed', error, scenes }, null, 2));
  throw e;
}
