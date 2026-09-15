/** Offline V2 example export: no model calls, no provider keys.
 *
 *  Compiles committed example scenes, narrates each with the local voice engine
 *  (engine word timing, so the frame stamp reads "LOCAL TTS"), writes per-scene
 *  review artifacts, and concatenates the narrated segments into one MP4.
 *
 *  Usage:
 *    npm run export:example -- --scenes photosynthesis-plant,water-cycle --out output/example
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { compileScene } from '../src/semantic/compiler/compile-scene.js';
import { writeV2Artifacts } from '../src/semantic/artifacts.js';
import { createVoiceEngineSpeech } from '../src/semantic/speech.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.findIndex(a => a === `--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const picks = flag('scenes', 'photosynthesis-plant,water-cycle').split(',').map(s => s.trim()).filter(Boolean);
const out = resolve(flag('out', 'output/example'));
const language = flag('language', 'en');
const base = flag('base', 'examples/semantic');
await mkdir(out, { recursive: true });

const speech = createVoiceEngineSpeech({ env: process.env, language });
const segments: string[] = [];
for (const name of picks) {
  const raw = JSON.parse(await readFile(join(base, `${name}.scene.json`), 'utf8'));
  const narration = raw.beats.map((beat: { narration?: string }) => beat.narration).filter(Boolean).join(' ');
  const spoken = await speech(narration);
  const compiled = compileScene(raw, spoken.timing);
  const dir = join(out, name);
  await writeV2Artifacts(compiled, dir, { video: true, audio: { data: spoken.audio, format: 'wav' } });
  console.log(JSON.stringify({ scene: name, timingKind: compiled.timing.kind, durationMs: compiled.durationMs, beats: compiled.scene.beats.length, narrated: true }));
  segments.push(resolve(dir, 'narrated.mp4'));
}

const list = join(out, 'concat.txt');
await writeFile(list, segments.map(segment => `file '${segment}'`).join('\n'));
const final = join(out, 'narrated.mp4');
await new Promise<void>((done, fail) => {
  const concat = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final], { stdio: 'inherit' });
  concat.on('error', fail);
  concat.on('close', code => (code === 0 ? done() : fail(new Error(`ffmpeg concat exited ${code}`))));
});
console.log(JSON.stringify({ output: final, scenes: picks.length }, null, 2));
