import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResolvedMention, SceneSpec } from '../types.js';
import { STYLE, MAX_CONCURRENT_REVEALS } from '../style.js';
import { resolveScene } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimeline, compileTimelineFull, maxIdleWindowMs } from '../timeline/compile.js';
import { renderSVG } from '../render/renderScene.js';
import { toNeutralElements, toNeutralEvents } from '../validation/gates.js';
import { deterministicGates } from '../../shared/evaluation.js';

const chainSpec: SceneSpec = {
  schemaVersion: 'claude-scene-spec/v1',
  sceneId: 'chain_test',
  title: 'Chain',
  template: 'chain',
  elements: [
    { id: 'a', anchor: 'mention:a', prim: 'box', text: 'A' },
    { id: 'b', anchor: 'mention:b', prim: 'box', text: 'B' },
    { id: 'c', anchor: 'mention:c', prim: 'box', text: 'C' },
    { id: 'd', anchor: 'after:c', prim: 'box', text: 'D' },
  ],
  edges: [],
  focus: ['d'],
};

function mention(id: string, startMs: number, endMs: number): ResolvedMention {
  return { sceneId: 'chain_test', mentionId: id, startMs, endMs, ambiguous: false, wordRange: [0, 1] };
}

test('timeline: reveal start = mention time - lead (clamped to scene start)', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  const mentions = [mention('a', 5000, 5300)];
  const timeline = compileTimeline(laidOut, mentions, 0, 20000);
  const ev = timeline.events.find((e) => e.elementId === 'a')!;
  assert.equal(ev.t0, 5000 - STYLE.motion.leadMs);
});

test('timeline: a mention time earlier than lead does not produce a negative reveal start', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  const mentions = [mention('a', 50, 100)];
  const timeline = compileTimeline(laidOut, mentions, 0, 20000);
  const ev = timeline.events.find((e) => e.elementId === 'a')!;
  assert.ok(ev.t0 >= 0);
});

test('timeline: at most MAX_CONCURRENT_REVEALS reveals are active at any instant, even with 4 near-simultaneous mentions', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  const mentions = [mention('a', 1000, 1100), mention('b', 1010, 1110), mention('c', 1020, 1120)];
  const timeline = compileTimelineFull(laidOut, mentions, 0, 20000);
  const reveals = timeline.events.filter((e) => e.track !== 'hold' && e.track !== 'emphasis');
  const boundaries = [...new Set(reveals.flatMap((e) => [e.t0, e.t1]))].sort((x, y) => x - y);
  for (let i = 0; i < boundaries.length - 1; i++) {
    const mid = (boundaries[i] + boundaries[i + 1]) / 2;
    const active = reveals.filter((e) => e.t0 <= mid && mid < e.t1).length;
    assert.ok(active <= MAX_CONCURRENT_REVEALS, `${active} concurrent reveals at ${mid}ms`);
  }
});

test('timeline: after:<id> schedules relative to the referenced element\'s ACTUAL (possibly delayed) end time', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  // Force heavy contention so "c" gets delayed well past its nominal mention time.
  const mentions = [mention('a', 0, 0), mention('b', 0, 0), mention('c', 0, 0)];
  const timeline = compileTimelineFull(laidOut, mentions, 0, 20000);
  const c = timeline.events.find((e) => e.elementId === 'c' && e.track !== 'fill')!;
  const d = timeline.events.find((e) => e.elementId === 'd')!;
  assert.equal(d.t0, c.t1, 'after:c must start exactly when c actually finishes, not at c\'s nominal anchor time');
});

test('timeline: carry-over elements get a full-scene hold event, not a reveal', () => {
  const spec: SceneSpec = { ...chainSpec, sceneId: 'chain_carry', carryOver: ['a'] };
  const laidOut = layoutScene(resolveScene(spec));
  const timeline = compileTimeline(laidOut, [], 1000, 9000);
  const ev = timeline.events.find((e) => e.elementId === 'a')!;
  assert.equal(ev.track, 'hold');
  assert.equal(ev.t0, 1000);
  assert.equal(ev.t1, 9000);
});

test('scene gates validate absolute lesson events against the local scene clock', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  const sceneStartMs = 12_000;
  const sceneEndMs = sceneStartMs + 8_000;
  const timeline = compileTimelineFull(laidOut, [], sceneStartMs, sceneEndMs);
  const svg = renderSVG(laidOut, timeline, sceneEndMs - 1);

  const failures = deterministicGates({
    elements: toNeutralElements(laidOut),
    timeline: toNeutralEvents(laidOut, timeline, sceneStartMs),
    durationMs: sceneEndMs - sceneStartMs,
    svg,
  });

  assert.deepEqual(failures.filter((failure) => failure.code === 'timeline-bounds'), []);
});

test('timeline/layout: carry-over pins to a supplied previous bbox; omitting the id from carryOver resets to a freshly computed position', () => {
  const resolved1 = resolveScene(chainSpec);
  const laidOut1 = layoutScene(resolved1);
  const freshBbox = laidOut1.elements.find((e) => e.id === 'a')!.bbox;

  // An arbitrary "previous position" that does NOT match where the template
  // would naturally place 'a' — proves pinning is really happening, not a
  // coincidence of both runs using the same template.
  const arbitraryPrevious = new Map([['a', { x: 900, y: 900, w: 50, h: 50 }]]);

  const carried: SceneSpec = { ...chainSpec, sceneId: 'chain_test', carryOver: ['a'] };
  const laidOutCarried = layoutScene(resolveScene(carried), { previous: arbitraryPrevious });
  assert.deepEqual(laidOutCarried.elements.find((e) => e.id === 'a')!.bbox, arbitraryPrevious.get('a'), 'carried element must keep the exact previous position, not the template default');

  // Same `previous` map, but 'a' is no longer listed in carryOver: it must
  // reset to the template's freshly computed position instead of staying pinned.
  const laidOutReset = layoutScene(resolveScene(chainSpec), { previous: arbitraryPrevious });
  assert.deepEqual(laidOutReset.elements.find((e) => e.id === 'a')!.bbox, freshBbox, 'dropping the id from carryOver must reset its position');
});

test('timeline: exact audio bounds — the last event never extends past sceneEndMs', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  const mentions = [mention('a', 100, 200), mention('b', 300, 400), mention('c', 500, 600)];
  const sceneEnd = 3000;
  const timeline = compileTimelineFull(laidOut, mentions, 0, sceneEnd);
  for (const ev of timeline.events) assert.ok(ev.t1 <= sceneEnd + 1e-6, `event ${ev.elementId}/${ev.track} ends at ${ev.t1} > sceneEnd ${sceneEnd}`);
});

test('timeline: a long final hold before closing emphasis receives generic activity without adding content', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  const mentions = [mention('a', 100, 200), mention('b', 300, 400), mention('c', 500, 600)];
  const endMs = 15000;
  const timeline = compileTimelineFull(laidOut, mentions, 0, endMs);
  const idleEmphasis = timeline.events.filter((e) => e.track === 'emphasis' && e.t0 < endMs - 400);
  assert.ok(idleEmphasis.length > 0, 'the final long hold should receive a quiet emphasis on an existing element');
  assert.ok(maxIdleWindowMs(timeline) <= STYLE.motion.maxIdleMs, `largest quiet window is ${maxIdleWindowMs(timeline)}ms`);
  assert.ok(timeline.events.every((e) => laidOut.elements.some((element) => element.id === e.elementId)), 'emphasis uses existing scene elements only');
});

test('timeline: an overfull scene clamps reveals to a nonzero window the exported frame shows', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  const sceneEnd = 8000;
  // Every mention lands on the final millisecond, so every reveal overruns:
  // each must still occupy at least 1ms ending at sceneEndMs (frame export
  // renders at most at endMs - 1, so a zero-duration reveal at sceneEndMs
  // would never appear in any exported frame).
  const mentions = [mention('a', sceneEnd, sceneEnd), mention('b', sceneEnd, sceneEnd), mention('c', sceneEnd, sceneEnd)];
  const timeline = compileTimeline(laidOut, mentions, 0, sceneEnd);
  const reveals = timeline.events.filter((e) => e.track === 'stroke' || e.track === 'wipe' || e.track === 'grow');
  assert.ok(reveals.length > 0);
  for (const ev of reveals) {
    assert.ok(ev.t0 <= sceneEnd - 1, `${ev.elementId} starts at ${ev.t0}; no exported frame shows t >= ${sceneEnd}`);
    assert.ok(ev.t1 - ev.t0 >= 1, `${ev.elementId} has zero duration`);
    assert.ok(ev.t1 <= sceneEnd + 1e-6, `${ev.elementId} ends at ${ev.t1} > sceneEnd ${sceneEnd}`);
  }
});

test('renderer: arbitrary seeking never throws and is a pure function of timeMs', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  const mentions = [mention('a', 500, 600), mention('b', 1500, 1600), mention('c', 2500, 2600)];
  const timeline = compileTimelineFull(laidOut, mentions, 0, 5000);
  for (const t of [-500, 0, 1, 750, 2000, 3999.5, 5000, 999999]) {
    const svg1 = renderSVG(laidOut, timeline, t);
    const svg2 = renderSVG(laidOut, timeline, t);
    assert.equal(svg1, svg2, `renderSVG(t=${t}) must be deterministic`);
    assert.ok(svg1.startsWith('<svg'));
  }
});
