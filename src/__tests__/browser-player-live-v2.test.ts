import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { publishSceneLockV2, writeLessonLockV2 } from '../pipeline-v2/lockV2.js';
import { KALAM_FONT_SHA256 } from '../render/fonts.js';
import { createBrowserPreviewHandler, createBrowserPreviewServer, createBrowserPreviewServerWhenReady, loadBrowserPreview } from '../export/player/previewServer.js';
import { parsePcmWav } from '../export/player/wavPrefix.js';
import { FPS, prepareScenes } from './fixtures/sceneLockFixture.js';

// Synthetic contract data: live-prefix playback and confinement evidence, never visual-quality or latency evidence.
async function request(handler: ReturnType<typeof createBrowserPreviewHandler>, url: string) {
  let status = 0; let body: Buffer | string = '';
  await handler({ method: 'GET', url } as IncomingMessage, { writeHead(code: number) { status = code; }, end(bytes?: Buffer | string) { body = bytes ?? ''; } } as unknown as ServerResponse);
  return { status, body: Buffer.isBuffer(body) ? body : Buffer.from(body) };
}

test('while later scenes are still being planned, the preview serves the verified ready prefix as a growing locked session', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-live-v2-'));
  try {
    const scenes = await prepareScenes(dir);
    await assert.rejects(loadBrowserPreview(dir), /No laid-out scenes|playable/i, 'nothing is playable before the first scene lock');

    await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 0, item: scenes[0]!, fps: FPS });
    const first = await loadBrowserPreview(dir);
    assert.equal(first.streaming, true, 'the run is not finished');
    assert.equal(first.durationMs, 2500);
    assert.equal(first.lockedV2?.frames, 10);
    assert.equal(first.lockedV2?.live, true);
    assert.match(first.lockedV2!.audioUrl, /^\/locked\/prefix\.wav\?through=2500$/);

    await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 1, item: scenes[1]!, fps: FPS, final: true });
    const both = await loadBrowserPreview(dir);
    assert.equal(both.durationMs, 5000);
    assert.equal(both.lockedV2?.frames, 20);
    assert.equal(both.lockedV2?.renderPlan.at(-1)!.firstFrame! + both.lockedV2!.renderPlan.at(-1)!.frameCount, 20);

    const handler = createBrowserPreviewHandler(both, dir, path.resolve('dist'), Buffer.from('<html/>'), undefined, () => loadBrowserPreview(dir));
    const hashes = both.lockedV2!.renderPlan.flatMap((s) => s.kind === 'hold' ? [s.svgHash!] : s.svgHashes!);
    for (const hash of new Set(hashes)) {
      const svg = await request(handler, `/locked/svg/${hash}.svg`);
      assert.equal(svg.status, 200, hash);
      assert.equal(createHash('sha256').update(svg.body).digest('hex'), hash);
    }
    assert.equal((await request(handler, `/locked/svg/${'0'.repeat(64)}.svg`)).status, 404);

    const prefix = await request(handler, '/locked/prefix.wav?through=5000');
    assert.equal(prefix.status, 200);
    const wav = parsePcmWav(prefix.body);
    assert.equal(Math.round(wav.data.length / 2 / wav.sampleRate * 1000), 5000, 'scene speech padded to both placements');
    const partial = parsePcmWav((await request(handler, '/locked/prefix.wav?through=2500')).body);
    assert.equal(Math.round(partial.data.length / 2 / partial.sampleRate * 1000), 2500);
    assert.equal((await request(handler, '/locked/prefix.wav?through=7500')).status, 404, 'audio beyond the ready prefix does not exist yet');
    assert.equal((await request(handler, '/locked/prefix.wav?through=1234')).status, 404, 'only scene boundaries are valid');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a tampered ready scene is withdrawn from the live preview instead of being played', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-live-v2-tamper-'));
  try {
    const scenes = await prepareScenes(dir);
    const one = await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 0, item: scenes[0]!, fps: FPS });
    await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 1, item: scenes[1]!, fps: FPS, final: true });
    const payload = await loadBrowserPreview(dir);
    const handler = createBrowserPreviewHandler(payload, dir, path.resolve('dist'), Buffer.from('<html/>'), undefined, () => loadBrowserPreview(dir));
    const audio = path.join(dir, one.audio.file);
    await writeFile(audio, Buffer.concat([await readFile(audio), Buffer.from('edited')]));
    assert.notEqual((await request(handler, '/locked/prefix.wav?through=2500')).status, 200);
    await assert.rejects(loadBrowserPreview(dir), /No laid-out scenes|playable/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('once the lesson lock is published the preview switches to the finished lock and stops streaming', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-live-v2-final-'));
  try {
    const scenes = await prepareScenes(dir);
    for (const [index, item] of scenes.entries()) await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index, item, fps: FPS, final: index === scenes.length - 1 });
    const live = await loadBrowserPreview(dir);
    assert.equal(live.streaming, true);
    await writeLessonLockV2({ outputDir: dir, lessonId: 'test', scenes, durationMs: 5000, audioPath: path.join(dir, 'audio.wav'), fps: FPS });
    const finished = await loadBrowserPreview(dir);
    assert.equal(finished.streaming, false);
    assert.equal(finished.lockedV2?.live, undefined);
    assert.equal(finished.lockedV2?.audioUrl, '/locked/audio.wav');
    assert.equal(finished.durationMs, 5000);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the preview can be started before the first scene exists and begins serving once it is verified', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-live-v2-wait-'));
  try {
    const scenes = await prepareScenes(dir);
    const started = createBrowserPreviewServerWhenReady(dir, { timeoutMs: 5000, pollMs: 20 });
    setTimeout(() => { void publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 0, item: scenes[0]!, fps: FPS }); }, 100);
    const server = await started;
    assert.ok(server.listening === false && typeof server.listen === 'function');
    await assert.rejects(createBrowserPreviewServerWhenReady(path.join(dir, 'missing'), { timeoutMs: 60, pollMs: 20 }), /ENOENT|No laid-out|playable/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a started preview server really serves the page, the pinned player font and the live frames over HTTP', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-live-v2-http-'));
  try {
    const scenes = await prepareScenes(dir);
    await publishSceneLockV2({ outputDir: dir, lessonId: 'test', index: 0, item: scenes[0]!, fps: FPS });
    const server = await createBrowserPreviewServer(dir);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as { port: number };
      const get = async (route: string) => { const response = await fetch(`http://127.0.0.1:${port}${route}`); return { status: response.status, body: Buffer.from(await response.arrayBuffer()) }; };
      const font = await get('/fonts/Kalam-Bold.ttf');
      assert.equal(font.status, 200);
      assert.equal(createHash('sha256').update(font.body).digest('hex'), KALAM_FONT_SHA256, 'the browser draws with the same font the lock pins');
      assert.equal((await get('/')).status, 200);
      const run = JSON.parse((await get('/run.json')).body.toString('utf8')) as { streaming: boolean; lockedV2: { audioUrl: string } };
      assert.equal(run.streaming, true);
      assert.equal((await get(run.lockedV2.audioUrl)).status, 200);
      assert.equal((await get('/dist/src/export/player/client.js')).status, 200);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
