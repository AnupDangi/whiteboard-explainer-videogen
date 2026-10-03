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

test('revision rewrites the longest scenes first, each by a bounded share, and stops once the gap is covered', () => {
  const scenes = [{ sceneId: 'a', audioMs: 30000, words: 60 }, { sceneId: 'b', audioMs: 57000, words: 114 }];
  const pauses = DEFAULT_PACING.gapMs.nominal + DEFAULT_PACING.trailingMs.nominal;
  const gap = 87000 - (60000 - pauses);
  const targets = revisionTargets(scenes, 60000);
  assert.ok(gap > 0);
  const speechAfter = targets.scenes.reduce((sum, t) => sum + (scenes.find((s) => s.sceneId === t.sceneId)!.audioMs - t.targetAudioMs), 0);
  assert.ok(Math.abs(speechAfter - Math.min(gap, 0.25 * 87000)) < 1, 'the cuts add up to the gap, or to the per-scene cap if the gap is larger');
  assert.equal(targets.scenes[0]!.sceneId, 'a', 'results stay in lesson order');
  const b = targets.scenes.find((t) => t.sceneId === 'b')!;
  assert.equal(b.measuredWordsPerSec, 2);
  assert.ok(b.targetAudioMs >= 57000 * 0.75 - 1, 'no scene is cut by more than a quarter');
  assert.ok(targets.scenes.every((t) => t.targetWords >= 6), 'a revision never asks for a scene to vanish');
  const small = revisionTargets([{ sceneId: 'a', audioMs: 20000, words: 40 }, { sceneId: 'b', audioMs: 20000, words: 40 }, { sceneId: 'c', audioMs: 14000, words: 28 }], 60000, DEFAULT_PACING, 'shorten');
  assert.ok(small.scenes.length < 3, 'a small mismatch touches fewer scenes than the lesson has');
  assert.equal(revisionTargets([{ sceneId: 'a', audioMs: 28800, words: 57 }], 28800 + DEFAULT_PACING.trailingMs.nominal).scenes.length, 0, 'speech already at the target needs no rewrite');
});

test('a known direction asks for slightly less (shorten) or more (lengthen) speech than the centred target, always keeping the pauses inside their bounds', () => {
  const scenes = [{ sceneId: 'a', audioMs: 30000, words: 60 }, { sceneId: 'b', audioMs: 30000, words: 60 }];
  const centred = revisionTargets(scenes, 60000);
  const shorter = revisionTargets(scenes, 60000, DEFAULT_PACING, 'shorten');
  const longer = revisionTargets(scenes, 60000, DEFAULT_PACING, 'lengthen');
  assert.ok(shorter.scale < centred.scale && centred.scale < longer.scale);
  for (const result of [shorter, longer]) {
    const pauses = 60000 - 60000 * result.scale;
    assert.ok(pauses >= DEFAULT_PACING.gapMs.min + DEFAULT_PACING.trailingMs.min && pauses <= DEFAULT_PACING.gapMs.max + DEFAULT_PACING.trailingMs.max);
  }
});
