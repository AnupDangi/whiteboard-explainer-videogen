import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HypothesisRunOptions } from '../shared/contracts.js';
import { runHypothesis } from '../run/run.js';
import { createBrowserPreviewHandler, loadBrowserPreview } from '../export/player/previewServer.js';
import { SYNTHETIC_SCENES } from './support/syntheticScenes.js';

const options = (outputDir: string): HypothesisRunOptions => ({
  mode: 'fixture', outputDir, narrationModel: 'fixture:hand-authored', visualModel: 'fixture:hand-authored',
  voice: { provider: 'voice-engine', language: 'en', speed: 1 }, alignment: { provider: 'fixture' },
  render: { width: 1920, height: 1080, fps: 30 }, maxRepairs: 1, cache: 'cold', maxCostUsd: 0.1,
});

test('hypothesis browser player serves run status and uses the shared renderer module', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-browser-player-'));
  try {
    await runHypothesis({ caseId: 'synthetic-contract', scenes: SYNTHETIC_SCENES }, options(dir));
    const payload = await loadBrowserPreview(dir);
    const html = await readFile(path.join(process.cwd(), 'src/export/player/index.html'));
    const handler = createBrowserPreviewHandler(payload, dir, path.resolve('dist'), html);
    const request = async (url: string, method = 'GET') => {
      let status = 0;
      let responseBody: string | Buffer = '';
      const req = { method, url } as IncomingMessage;
      const res = {
        writeHead(code: number) { status = code; },
        end(body?: string | Buffer) { responseBody = body ?? ''; },
      } as unknown as ServerResponse;
      await handler(req, res);
      return { status, rawBody: Buffer.isBuffer(responseBody) ? responseBody : Buffer.from(responseBody), body: Buffer.isBuffer(responseBody) ? responseBody.toString('utf8') : responseBody };
    };

    const page = await request('/');
    assert.equal(page.status, 200);
    assert.match(page.body, /player\/client\.js/);
    assert.match(page.body, /Kalam-Bold\.ttf/);
    const font = await request('/fonts/Kalam-Bold.ttf');
    assert.equal(font.status, 200);
    assert.deepEqual([...font.rawBody.subarray(0, 4)], [0, 1, 0, 0], 'player serves the bundled TrueType font');

    const runResponse = await request('/run.json');
    assert.equal(runResponse.status, 200);
    const run = JSON.parse(runResponse.body) as { status: string; runClass: string; durationMs: number; scenes: unknown[]; alignedWords: unknown[] };
    assert.equal(run.status, 'draft', 'preview must preserve publish status');
    assert.equal(run.runClass, 'renderer-fixture', 'synthetic browser-player test inputs are explicitly non-generated');
    assert.equal(run.durationMs, 30_000);
    assert.equal(run.scenes.length, SYNTHETIC_SCENES.length);
    assert.ok(run.alignedWords.length > 0);

    const client = await request('/dist/src/export/player/client.js');
    assert.equal(client.status, 200);
    assert.match(client.body, /(\.\.\/frame\.js|export\/frame\.js)/, 'player client must import the shared export/frame.js composer');
    const renderer = await request('/dist/src/render/renderScene.js');
    assert.equal(renderer.status, 200);
    assert.match(renderer.body, /mathIds\.js/);
    assert.doesNotMatch(renderer.body, /from ["']\.\/math\.js["']/);
    assert.equal((await request('/dist/src/server.js')).status, 404, 'preview must not serve production runtime files');
    assert.equal((await request('/dist/src/run/../../../server.js')).status, 404, 'module route must reject traversal out of the allowlisted renderer tree');
    assert.equal((await request('/', 'POST')).status, 405);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('browser preview consumes ordered playable events and serves only hashed run-local descriptors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-browser-events-'));
  try {
    await runHypothesis({ caseId: 'synthetic-contract', scenes: SYNTHETIC_SCENES }, options(dir));
    const initial = await loadBrowserPreview(dir);
    const scene = initial.scenes[0]!;
    const sceneAudio = Buffer.from('synthetic scene audio bytes');
    const sceneAudioPath = 'scene-audio/000.wav';
    await mkdir(path.join(dir, 'scene-audio'), { recursive: true });
    await writeFile(path.join(dir, sceneAudioPath), sceneAudio);
    const descriptor = {
      schemaVersion: 'hypothesis-scene-preview/v1', runId: 'run_stream_01', moduleId: 'module_1', sceneId: scene.laidOut.sceneId,
      sequence: 0, durationMs: scene.endMs - scene.startMs, laidOut: scene.laidOut, timeline: scene.timeline,
      audio: { path: 'audio.wav', startMs: scene.startMs, endMs: scene.endMs, scenePath: sceneAudioPath, sceneContentHash: createHash('sha256').update(sceneAudio).digest('hex') },
      alignment: { path: 'aligned-audio.json', sceneId: scene.laidOut.sceneId, words: [] },
    };
    const descriptorBytes = Buffer.from(JSON.stringify(descriptor));
    const descriptorHash = createHash('sha256').update(descriptorBytes).digest('hex');
    const previewLocation = `preview-scenes/${scene.laidOut.sceneId}.json`;
    await mkdir(path.join(dir, 'preview-scenes'), { recursive: true });
    await writeFile(path.join(dir, previewLocation), descriptorBytes);
    const event = {
      type: 'scene.playable', schemaVersion: 'hypothesis-scene-event/v1', runId: 'run_stream_01', moduleId: 'module_1',
      sceneId: scene.laidOut.sceneId, sequence: 0, durationMs: scene.endMs - scene.startMs, artifactHash: descriptorHash, previewLocation,
    };
    await writeFile(path.join(dir, 'scene-events.jsonl'), `${JSON.stringify(event)}\n`);
    const payload = await loadBrowserPreview(dir);
    assert.equal(payload.events.length, 1);
    assert.equal(payload.sceneAudio[0]!.path, sceneAudioPath);
    assert.equal(payload.events[0]!.sequence, 0);
    assert.ok(payload.scenes.some((item) => item.laidOut.sceneId === scene.laidOut.sceneId));

    const html = await readFile(path.join(process.cwd(), 'src/export/player/index.html'));
    const handler = createBrowserPreviewHandler(payload, dir, path.resolve('dist'), html);
    const request = async (url: string) => {
      let status = 0;
      let responseBody: string | Buffer = '';
      await handler({ method: 'GET', url } as IncomingMessage, {
        writeHead(code: number) { status = code; }, end(body?: string | Buffer) { responseBody = body ?? ''; },
      } as unknown as ServerResponse);
      return { status, body: Buffer.isBuffer(responseBody) ? responseBody.toString('utf8') : responseBody };
    };
    assert.equal((await request(`/artifact/${previewLocation}`)).status, 200);
    assert.equal((await request(`/artifact/${sceneAudioPath}`)).status, 200);
    assert.equal((await request('/artifact/%2E%2E%2Foutside.json')).status, 404);
    assert.equal((await request('/scene-events.jsonl')).status, 200);

    await writeFile(path.join(dir, 'scene-events.jsonl'), `${JSON.stringify(event)}\n${JSON.stringify({ ...event, sequence: 2 })}\n`);
    await assert.rejects(loadBrowserPreview(dir), /Invalid scene event/, 'the player rejects gaps in the playable-event sequence');
    await writeFile(path.join(dir, 'scene-events.jsonl'), `${JSON.stringify(event)}\n`);

    await writeFile(path.join(dir, sceneAudioPath), 'tampered audio');
    assert.equal((await request(`/artifact/${sceneAudioPath}`)).status, 404, 'scene audio must match the descriptor content hash');
    await writeFile(path.join(dir, previewLocation), 'tampered');
    assert.equal((await request(`/artifact/${previewLocation}`)).status, 404, 'descriptor must match its event content hash');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
