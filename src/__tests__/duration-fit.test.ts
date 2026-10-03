import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PACING, fitPacing, revisionTargets } from '../pipeline-v2/durationFit.js';

const total = (audio: number[], fit: { gapMs: number; trailingMs: number }) => audio.reduce((a, b) => a + b, 0) + fit.gapMs * (audio.length - 1) + fit.trailingMs;

test('pacing absorbs a small mismatch exactly: the scene gaps and final hold move inside their bounds, speech is never touched', () => {
  for (const [audio, requested] of [
    [[15000, 14000, 13000, 12000], 60000],   // pauses 6000 = above nominal 5400
    [[15000, 15000, 15000, 15000], 60000],   // pauses 0 -> too long, see next test
    [[14000, 14000, 14000, 14000], 60000],   // pauses 4000
    [[20000, 20000, 15000], 60000],          // pauses 5000, 3 scenes
    [[58000], 60000],                        // single scene: only the hold
  ] as const) {
    const fit = fitPacing([...audio], requested);
    if (!fit.ok) continue;
    assert.equal(total([...audio], fit), requested, `exact total for ${audio.join('+')}`);
    assert.ok(fit.gapMs >= DEFAULT_PACING.gapMs.min && fit.gapMs <= DEFAULT_PACING.gapMs.max);
    assert.ok(fit.trailingMs >= DEFAULT_PACING.trailingMs.min && fit.trailingMs <= DEFAULT_PACING.trailingMs.max);
  }
  const nominal = fitPacing([15000, 14000, 13000, 12600], 60000);
  assert.ok(nominal.ok && nominal.gapMs === DEFAULT_PACING.gapMs.nominal && nominal.trailingMs === DEFAULT_PACING.trailingMs.nominal, 'exactly nominal pauses stay nominal');
});

test('speech that cannot fit even with the shortest pauses, or leaves more silence than the longest pauses, is reported with the signed gap to close', () => {
  const tooLong = fitPacing([20000, 20000, 20000, 20000], 60000);
  assert.deepEqual({ ok: tooLong.ok, ...(tooLong.ok ? {} : { direction: tooLong.direction, deltaMs: tooLong.deltaMs }) }, { ok: false, direction: 'shorten', deltaMs: 80000 + 3 * 1000 + 800 - 60000 });
  const tooShort = fitPacing([10000, 10000, 10000, 10000], 60000);
  assert.ok(!tooShort.ok && tooShort.direction === 'lengthen');
  assert.equal(tooShort.deltaMs, 60000 - 40000 - (3 * DEFAULT_PACING.gapMs.max + DEFAULT_PACING.trailingMs.max));
  assert.throws(() => fitPacing([], 60000), /at least one scene/);
  assert.throws(() => fitPacing([1000, -5], 60000), /positive/);
});

test('revision targets scale every scene by the same measured factor, from its own measured speaking rate', () => {
  const targets = revisionTargets([{ sceneId: 'a', audioMs: 30000, words: 60 }, { sceneId: 'b', audioMs: 57000, words: 114 }], 60000);
  const pauses = DEFAULT_PACING.gapMs.nominal * 1 + DEFAULT_PACING.trailingMs.nominal;
  const speechTarget = 60000 - pauses;
  assert.equal(Math.round(targets.scale * 87000), speechTarget);
  assert.deepEqual(targets.scenes.map((s) => s.sceneId), ['a', 'b']);
  assert.equal(targets.scenes[0]!.targetWords, Math.round(60 * targets.scale));
  assert.equal(targets.scenes[1]!.measuredWordsPerSec, 2);
  assert.ok(Math.abs(targets.scenes[1]!.targetAudioMs - 57000 * targets.scale) < 1);
  assert.ok(targets.scenes.every((s) => s.targetWords >= 6), 'a revision never asks for a scene to vanish');
});
