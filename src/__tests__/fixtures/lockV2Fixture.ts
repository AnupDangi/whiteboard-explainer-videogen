import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyBoardState } from '../../visual-v2/board-state/reducer.js';
import { compileSceneTimeline } from '../../visual-v2/timeline/compile.js';
import { compileScene } from '../../visual-v2/renderer/frame.js';
import { writeLessonLockV2, type LessonLockV2 } from '../../pipeline-v2/lockV2.js';

// Synthetic contract data, never visual-quality or live-performance evidence.
export async function fixtureLock(dir: string): Promise<LessonLockV2> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(dir, 'v2'), { recursive: true });
  await mkdir(path.join(dir, 'scene-audio'), { recursive: true });
  const wav = Buffer.alloc(44 + 22050 * 2 * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await writeFile(path.join(dir, 'audio.wav'), wav);
  await writeFile(path.join(dir, 'scene-audio', 'one.wav'), wav);
  await writeFile(path.join(dir, 'captions.vtt'), 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.800\nA test token appears.\n');
  await writeFile(path.join(dir, 'v2', 'lesson-context.json'), JSON.stringify({ plan: { sections: ['one'] }, graph: { concepts: [] } }));
  await writeFile(path.join(dir, 'v2', 'alignment.json'), JSON.stringify({ schemaVersion: 'v2-alignment/v1', scenes: [{ sceneId: 'one', durationMs: 2000, words: ['A', 'test', 'token', 'appears'].map((word, i) => ({ word, startMs: i * 400, endMs: i * 400 + 300 })), aligner: 'stable-ts', repairedWordIndexes: [], calibration: { status: 'unmeasured' } }] }));
  const timeline = compileSceneTimeline({ initial: emptyBoardState(), ops: [{ op: 'add', opId: 'o1', beatId: 'one.b1', id: 'token', element: { type: 'token', text: 'sample', provenance: 'illustrative' }, at: { region: 'center' }, cue: 0 }], beats: [{ beatId: 'one.b1', startMs: 0, endMs: 1800, sentences: [{ startMs: 0, endMs: 1800 }] }] });
  await writeFile(path.join(dir, 'v2', 'scene.one.json'), JSON.stringify({ ops: timeline.ops.map((s) => s.op), beats: [], narration: { text: 'A test token appears.' }, beatTimings: [], timelineHash: timeline.hash }));
  const scene = compileScene('one', 'A token', timeline, 'test');
  return writeLessonLockV2({ outputDir: dir, lessonId: 'test', scenes: [{ scene, startMs: 0, endMs: 2000 }], durationMs: 2000, audioPath: path.join(dir, 'audio.wav'), fps: 4 });
}

