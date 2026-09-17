/** Live V2 topic video: plan -> direct -> narrate -> export narrated MP4.
 *
 *  Usage:
 *    npm run build && node --env-file-if-exists=.env dist/scripts/generate-v2-video.js \
 *      --out output/<name> --prompt "..." --archetypes cause_effect,transformation \
 *      --scenes 2 --narration
 */
import { mkdir, writeFile } from 'node:fs/promises';
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
const maxScenes = Number(flag('scenes', '2'));
// The teaching planner has always accepted a target length and built the prompt
// around it, but this entry point never passed one, so the planner never knew
// whether it was writing a one-minute lesson or a thirty-minute one. That is why
// identical requests produced 60s, 64s and 93s lessons.
const targetMinutes = Number(flag('minutes', '1'));
const narrate = args.includes('--narration');
const maxCostUsd = Number(flag('budget', '0.5'));

await mkdir(out, { recursive: true });
const model = createJsonModel({ env: process.env, maxCostUsd });
const speech = narrate ? createVoiceEngineSpeech({ env: process.env, language: 'en' }) : undefined;
const start = performance.now();
let scenes = 0, exported = 0;

try {
  for await (const result of generateV2({ prompt, maxScenes, allowedArchetypes: archetypes, language: 'en', targetMinutes }, model, {
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
