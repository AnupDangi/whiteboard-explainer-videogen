import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HypothesisRunOptions } from '../../shared/contracts.js';
import { runHypothesis } from '../pipeline/run.js';
import { createBrowserPreviewHandler, loadBrowserPreview } from '../player/previewServer.js';
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
    const html = await readFile(path.join(process.cwd(), 'src/experimental/hypothesis/v1_claude/player/index.html'));
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

    const client = await request('/dist/src/experimental/hypothesis/v1_claude/player/client.js');
    assert.equal(client.status, 200);
    assert.match(client.body, /export\/frame\.js/);
    const renderer = await request('/dist/src/experimental/hypothesis/v1_claude/render/renderScene.js');
    assert.equal(renderer.status, 200);
    assert.match(renderer.body, /mathIds\.js/);
    assert.doesNotMatch(renderer.body, /from ["']\.\/math\.js["']/);
    assert.equal((await request('/dist/src/server.js')).status, 404, 'preview must not serve production runtime files');
    assert.equal((await request('/dist/src/experimental/hypothesis/v1_claude/../../../server.js')).status, 404, 'module route must reject traversal out of the allowlisted renderer tree');
    assert.equal((await request('/', 'POST')).status, 405);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
