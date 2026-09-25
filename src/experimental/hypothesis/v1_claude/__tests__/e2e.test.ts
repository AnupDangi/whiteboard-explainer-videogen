import test from 'node:test';
import assert from 'node:assert/strict';
import type { HypothesisRunOptions } from '../../shared/contracts.js';
import { runHypothesis } from '../pipeline/run.js';
import { SYNTHETIC_SCENES } from './support/syntheticScenes.js';

/**
 * Synthetic, neutral inputs exercise renderer/cache/export contracts only.
 * They make no claim about lesson quality, planner quality, or architecture rank.
 *
 * The synthetic offline path stops at scene SVGs. S11 export plumbing is
 * exercised with synthetic scene data and system ffmpeg below.
 */

function options(): HypothesisRunOptions {
  return {
    mode: 'fixture',
    outputDir: '',
    narrationModel: 'fixture:hand-authored',
    visualModel: 'fixture:hand-authored',
    voice: { provider: 'voice-engine', language: 'en', speed: 1 },
    alignment: { provider: 'fixture' },
    render: { width: 1920, height: 1080, fps: 30 },
    maxRepairs: 1,
    cache: 'cold',
    maxCostUsd: 0.1,
  };
}

test('e2e contract: neutral synthetic inputs traverse the offline renderer path', async () => {
  const input = { caseId: 'synthetic-contract', scenes: SYNTHETIC_SCENES };
  const result = await runHypothesis(input, options());
  assert.equal(result.scenes.length, SYNTHETIC_SCENES.length);
  assert.equal(result.evaluationBundle.runClass, 'renderer-fixture');
  assert.equal(result.evaluationBundle.status, 'draft');
});

test('e2e contract: synthetic narration clocks fill the configured clip duration', async () => {
  const input = { caseId: 'synthetic-contract', scenes: SYNTHETIC_SCENES };
  const result = await runHypothesis(input, options());
  assert.equal(result.alignedAudio.durationMs, 30_000);
});

test('e2e contract: synthetic run bundle records renderer plumbing and zero provider invocations', async () => {
  const input = { caseId: 'synthetic-contract', scenes: SYNTHETIC_SCENES };
  const result = await runHypothesis(input, options());
  const bundle = result.evaluationBundle;
  assert.equal(bundle.pipeline, 'claude');
  assert.equal(bundle.runClass, 'renderer-fixture');
  assert.equal(bundle.status, 'draft', 'offline fixture success is not an external quality judgment');
  assert.equal(bundle.caseId, 'synthetic-contract');
  assert.ok(bundle.elements.length > 0);
  assert.ok(bundle.timeline.length > 0);
  assert.equal(typeof bundle.usage.costUsd, 'number');
  assert.equal(bundle.usage.costUsd, 0, 'fixture mode makes zero live calls, so cost must be exactly 0');
  assert.equal(bundle.usage.calls, 0);
  assert.ok('meanOccupancy' in bundle.metrics);
});

test('e2e contract: synthetic offline path writes its declared artifacts and does not claim an MP4', async () => {
  const { mkdtemp, readFile, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-claude-e2e-'));

  const input = { caseId: 'synthetic-contract', scenes: SYNTHETIC_SCENES };
  await runHypothesis(input, { ...options(), outputDir: dir });

  const files = await readdir(dir);
  for (const expected of ['narration.json', 'aligned-audio.json', 'evaluation-bundle.json', 'final-scene.svg', 'contact-sheet.svg']) {
    assert.ok(files.includes(expected), `missing artifact: ${expected}`);
  }
  for (const { sceneId } of SYNTHETIC_SCENES) {
    for (const prefix of ['scene-spec', 'resolved-scene', 'layout', 'timeline']) {
      assert.ok(files.includes(`${prefix}.${sceneId}.json`), `missing artifact: ${prefix}.${sceneId}.json`);
    }
  }
  assert.ok(!files.includes('video.mp4'), 'video.mp4 must be absent (documented gap), never a fake/empty stand-in file');

  const svg = await readFile(path.join(dir, 'final-scene.svg'), 'utf8');
  assert.ok(svg.startsWith('<svg'));
});

test('S11: raster workers and ffmpeg produce a decodable MP4 from the shared frame renderer', async (t) => {
  const { spawnSync } = await import('node:child_process');
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('system ffmpeg is unavailable');
    return;
  }
  const { mkdtemp, readFile, stat, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
    const { encodeVideoAtomically } = await import('../export/videoEncode.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-claude-mp4-'));
  try {
    // Minimal valid 500 ms, mono, 16-bit PCM WAV. No external audio tool or model call.
    const sampleRate = 44_100;
    const samples = sampleRate / 2;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
    wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    const audioPath = path.join(dir, 'silence.wav');
    const videoPath = path.join(dir, 'output.mp4');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(audioPath, wav));

    const sceneInput = SYNTHETIC_SCENES[0]!;
    const run = await runHypothesis({ caseId: 'synthetic-contract', scenes: [sceneInput] }, options());
    const scene = run.scenes[0];
    const encoded = await encodeVideoAtomically([{ laidOut: scene.laidOut, timeline: scene.timeline, startMs: 0, endMs: 500 }], 500, audioPath, videoPath, 2, 1);
    assert.equal(encoded.frames, 1);
    assert.ok((await stat(videoPath)).size > 1000, 'MP4 should contain encoded video and audio streams');
    const probe = spawnSync('ffmpeg', ['-v', 'error', '-i', videoPath, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);

    const failedPath = path.join(dir, 'interrupted.mp4');
    await assert.rejects(encodeVideoAtomically([], 500, audioPath, failedPath, 2, 1, async (_scenes, _duration, _audio, partialPath) => {
      await import('node:fs/promises').then(({ writeFile }) => writeFile(partialPath, Buffer.from('incomplete')));
      throw new Error('synthetic encoder interruption');
    }), /synthetic encoder interruption/);
    await assert.rejects(stat(failedPath), { code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('e2e contract: identical synthetic runs replay deterministically for cache integrity', async () => {
  const input = { caseId: 'synthetic-contract', scenes: SYNTHETIC_SCENES };
  const r1 = await runHypothesis(input, options());
  const r2 = await runHypothesis(input, options());
  assert.deepEqual(r1.evaluationBundle, r2.evaluationBundle);
  assert.equal(r1.scenes.map((s) => s.finalFrameSvg).join(''), r2.scenes.map((s) => s.finalFrameSvg).join(''));
});

test('runner: warm cache reuses typed stage artifacts and changed narration invalidates dependent stages', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-claude-cache-e2e-'));
  try {
    const cacheDir = path.join(dir, 'cache');
    const base = { caseId: 'synthetic-contract', scenes: SYNTHETIC_SCENES };
    const cold = await runHypothesis(base, { ...options(), outputDir: path.join(dir, 'cold'), cache: 'cold' }, cacheDir);
    const warm = await runHypothesis(base, { ...options(), outputDir: path.join(dir, 'warm'), cache: 'warm' }, cacheDir);
    assert.equal(warm.runId, cold.runId, 'cache mode and output location are operational settings, not content identity');
    assert.equal(warm.evaluationBundle.usage.cacheHits, 14, 'S4/S5 plus S7–S10 across three scenes should hit');

    const changed = structuredClone(base);
    changed.scenes[0].raw = changed.scenes[0].raw.replace('sample item A', 'changed sample A');
    assert.notEqual(changed.scenes[0].raw, base.scenes[0].raw, 'synthetic input perturbation should change narration');
    await runHypothesis(changed, { ...options(), outputDir: path.join(dir, 'changed'), cache: 'warm' }, cacheDir);

    const coldManifest = JSON.parse(await readFile(path.join(dir, 'cold', 'run-manifest.json'), 'utf8')) as { stageArtifacts: Record<string, { key: string }> };
    const changedManifest = JSON.parse(await readFile(path.join(dir, 'changed', 'run-manifest.json'), 'utf8')) as { stageArtifacts: Record<string, { key: string }> };
    assert.notEqual(coldManifest.stageArtifacts['S4-narration'].key, changedManifest.stageArtifacts['S4-narration'].key);
    assert.notEqual(coldManifest.stageArtifacts['S5-alignment'].key, changedManifest.stageArtifacts['S5-alignment'].key);
    assert.equal(coldManifest.stageArtifacts['S7-resolve:sample_b'].key, changedManifest.stageArtifacts['S7-resolve:sample_b'].key, 'unrelated visual resolution remains reusable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('e2e: changing scene input changes run identity with case and options fixed', async () => {
  const original = { caseId: 'synthetic-contract', scenes: SYNTHETIC_SCENES };
  const changed = structuredClone(original);
  changed.scenes[0].spec.title = 'Changed source title';
  const first = await runHypothesis(original, options());
  const second = await runHypothesis(changed, options());
  assert.notEqual(first.runId, second.runId);
  assert.notEqual(first.evaluationBundle.metrics.inputHash, second.evaluationBundle.metrics.inputHash);
});
