import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import { compileSceneTimeline } from '../visual-v2/timeline/compile.js';
import { compileScene } from '../visual-v2/renderer/frame.js';
import { writeLessonLockV2, type LessonLockV2 } from '../pipeline-v2/lockV2.js';
import { createBrowserPreviewHandler, loadBrowserPreview, lockedFrameHashAt } from '../export/player/previewServer.js';

// Synthetic contract data: playback and confinement evidence, never visual-quality evidence.
async function lockedFixture(dir: string): Promise<LessonLockV2> {
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
  await writeFile(path.join(dir, 'v2', 'scene.one.json'), JSON.stringify({ ops: timeline.ops.map((item) => item.op), beats: [], narration: { text: 'A test token appears.' }, beatTimings: [], timelineHash: timeline.hash }));
  const scene = compileScene('one', 'A token', timeline, 'test');
  return writeLessonLockV2({ outputDir: dir, lessonId: 'test', scenes: [{ scene, startMs: 0, endMs: 2000 }], durationMs: 2000, audioPath: path.join(dir, 'audio.wav'), fps: 4 });
}

async function request(handler: ReturnType<typeof createBrowserPreviewHandler>, url: string) {
  let status = 0; let body: Buffer | string = '';
  await handler({ method: 'GET', url } as IncomingMessage, { writeHead(code: number) { status = code; }, end(bytes?: Buffer | string) { body = bytes ?? ''; } } as unknown as ServerResponse);
  return { status, body: Buffer.isBuffer(body) ? body : Buffer.from(body) };
}

test('V2 browser playback serves the exact frozen frame sequence and verified master audio', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-browser-v2-'));
  try {
    const lock = await lockedFixture(dir);
    const payload = await loadBrowserPreview(dir);
    assert.equal(payload.lockedV2?.frames, 8);
    assert.equal(payload.durationMs, 2000);
    assert.equal(payload.alignedWords[1]?.startMs, 400);
    assert.equal(payload.alignedWords[1]?.w, 'test');
    const handler = createBrowserPreviewHandler(payload, dir, path.resolve('dist'), Buffer.from('<html/>'));
    const served = JSON.parse((await request(handler, '/run.json')).body.toString('utf8')) as typeof payload;
    assert.deepEqual(served.lockedV2?.renderPlan, lock.renderPlan);
    for (let frame = 0; frame < lock.render.frames; frame++) {
      const hash = lockedFrameHashAt(lock, frame * 1000 / lock.render.fps);
      const svg = await request(handler, `/locked/svg/${hash}.svg`);
      assert.equal(svg.status, 200);
      assert.equal(createHash('sha256').update(svg.body).digest('hex'), hash);
    }
    assert.equal(lockedFrameHashAt(lock, 2000), lockedFrameHashAt(lock, 1750), 'end seek is clamped to the final locked frame');
    const audio = await request(handler, '/locked/audio.wav');
    assert.equal(audio.status, 200);
    assert.equal(createHash('sha256').update(audio.body).digest('hex'), lock.media.audio.hash);
    assert.equal((await request(handler, `/locked/svg/${'0'.repeat(64)}.svg`)).status, 404);
    assert.equal((await request(handler, '/locked/svg/%2E%2E%2Faudio.wav')).status, 404);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('V2 browser playback fails closed when frozen SVG or audio changes or resolves outside the run', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-browser-v2-tamper-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'hyp-browser-v2-outside-'));
  try {
    const lock = await lockedFixture(dir);
    const payload = await loadBrowserPreview(dir);
    const handler = createBrowserPreviewHandler(payload, dir, path.resolve('dist'), Buffer.from('<html/>'));
    const svgPath = path.join(dir, lock.svgAssets[0]!.file);
    const original = await readFile(svgPath);
    await writeFile(svgPath, Buffer.concat([original, Buffer.from('tampered')]));
    await assert.rejects(loadBrowserPreview(dir), /verification|hash drift/i);
    assert.notEqual((await request(handler, `/locked/svg/${lock.svgAssets[0]!.hash}.svg`)).status, 200);
    await writeFile(svgPath, original);
    const audioPath = path.join(dir, lock.media.audio.file);
    await writeFile(audioPath, Buffer.from('tampered'));
    assert.notEqual((await request(handler, '/locked/audio.wav')).status, 200);
    await writeFile(audioPath, await readFile(path.join(dir, 'audio.wav')));
    await writeFile(path.join(outside, 'same.svg'), original);
    await rm(svgPath);
    await symlink(path.join(outside, 'same.svg'), svgPath);
    await assert.rejects(loadBrowserPreview(dir), /verification|escape|outside/i);
    assert.notEqual((await request(handler, `/locked/svg/${lock.svgAssets[0]!.hash}.svg`)).status, 200);
  } finally { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
