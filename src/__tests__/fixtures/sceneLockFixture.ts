import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyBoardState } from '../../visual-v2/board-state/reducer.js';
import { compileSceneTimeline } from '../../visual-v2/timeline/compile.js';
import { compileScene } from '../../visual-v2/renderer/frame.js';
import type { V2VideoScene } from '../../visual-v2/renderer/encode.js';

// Synthetic contract data, never visual-quality or live-performance evidence.
export const FPS = 4;
export const SCENES = [
  { id: 'one', title: 'A token', words: ['A', 'test', 'token', 'appears'], startMs: 0, endMs: 2500 },
  { id: 'two', title: 'Another token', words: ['A', 'second', 'token', 'follows'], startMs: 2500, endMs: 5000 },
];

export function wavBytes(): Buffer {
  const wav = Buffer.alloc(44 + 22050 * 2 * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  return wav;
}

export async function prepareScenes(dir: string): Promise<V2VideoScene[]> {
  await mkdir(path.join(dir, 'v2'), { recursive: true });
  await mkdir(path.join(dir, 'scene-audio'), { recursive: true });
  const wav = wavBytes();
  await writeFile(path.join(dir, 'audio.wav'), wav);
  await writeFile(path.join(dir, 'captions.vtt'), 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.800\nA test token appears.\n');
  await writeFile(path.join(dir, 'v2', 'lesson-context.json'), JSON.stringify({ plan: { sections: SCENES.map((s) => s.id) }, graph: { concepts: [] } }));
  await writeFile(path.join(dir, 'v2', 'alignment.json'), JSON.stringify({ schemaVersion: 'v2-alignment/v1', scenes: SCENES.map((s) => ({
    sceneId: s.id, durationMs: 2000, aligner: 'stable-ts', repairedWordIndexes: [], calibration: { status: 'unmeasured' },
    words: s.words.map((word, i) => ({ word, startMs: i * 400, endMs: i * 400 + 300 })),
  })) }));
  const out: V2VideoScene[] = [];
  for (const s of SCENES) {
    const timeline = compileSceneTimeline({ initial: emptyBoardState(), ops: [{ op: 'add', opId: `${s.id}.o1`, beatId: `${s.id}.b1`, id: `token-${s.id}`, element: { type: 'token', text: s.id, provenance: 'illustrative' }, at: { region: 'center' }, cue: 0 }], beats: [{ beatId: `${s.id}.b1`, startMs: 0, endMs: 1800, sentences: [{ startMs: 0, endMs: 1800 }] }] } as never);
    await writeFile(path.join(dir, 'v2', `scene.${s.id}.json`), JSON.stringify({ ops: timeline.ops.map((o) => o.op), beats: [], narration: { text: s.words.join(' ') }, beatTimings: [], timelineHash: timeline.hash }));
    await writeFile(path.join(dir, 'scene-audio', `${s.id}.wav`), wav);
    out.push({ scene: compileScene(s.id, s.title, timeline, 'test'), startMs: s.startMs, endMs: s.endMs });
  }
  return out;
}

