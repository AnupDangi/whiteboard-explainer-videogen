import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneSpec } from '../shared/types.js';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { claimDeadlines } from '../run/visualChain.js';

const spec = (n: number): SceneSpec => ({
  schemaVersion: 'claude-scene-spec/v1', sceneId: 'dl', title: 'Deadlines', template: 'chain',
  elements: Array.from({ length: n }, (_, i) => ({ id: `n${i + 1}`, slot: 'node', anchor: `mention:m${i + 1}`, prim: 'box', text: `Item ${i + 1}` })),
  edges: [],
} as SceneSpec);
const mentions = (n: number, start: number, gap: number) => Array.from({ length: n }, (_, i) => ({ sceneId: 'dl', mentionId: `m${i + 1}`, startMs: start + i * gap, endMs: start + i * gap + 200, ambiguous: false, wordRange: [i, i + 1] as [number, number] }));

test('a reveal blocked by a busy lane starts inside its claim window by speeding up the blocker, not by failing', () => {
  const laid = layoutScene(resolveScene(spec(5)));
  const m = mentions(5, 500, 150); // five elements named almost at once: two lanes cannot keep up at nominal speed
  const base = compileTimelineFull(laid, m, 0, 20_000);
  const lateBase = Math.max(...base.events.filter((e) => e.track !== 'edge' && e.track !== 'hold' && e.track !== 'emphasis').map((e) => e.t0));
  const by = new Map<string, number>(Array.from({ length: 5 }, (_, i) => [`n${i + 1}`, 500 + 4 * 150 + 700] as [string, number]));
  const sped = compileTimelineFull(laid, m, 0, 20_000, { elementEndBy: by });
  const lateSped = Math.max(...sped.events.filter((e) => e.track !== 'edge' && e.track !== 'hold' && e.track !== 'emphasis').map((e) => e.t0));
  assert.ok(lateSped <= lateBase, `${lateSped} vs ${lateBase}`);
  for (const event of sped.events.filter((e) => by.has(e.elementId) && e.track !== 'hold' && e.track !== 'emphasis')) assert.ok(event.t1 > event.t0, 'every reveal keeps a positive duration');
});

test('deadlines are derived from aligned claim windows plus the grace, per target, and are topic-free', () => {
  const coverage = {
    essentialClaims: [{ id: 'c1', statement: 's', conceptIds: ['a'], relations: [], evidenceSpanIds: ['x'] }],
    spokenClaimSpans: [{ claimId: 'c1', exactText: 'Alpha beta gamma.', plainStart: 0, plainEnd: 17 }],
    plainText: 'Alpha beta gamma.',
    alignedWords: [{ w: 'Alpha', startMs: 0, endMs: 400 }, { w: 'beta', startMs: 400, endMs: 800 }, { w: 'gamma.', startMs: 800, endMs: 1500 }],
  };
  const withIntent = { ...spec(2), boardIntent: { visualIntents: [{ claimId: 'c1', strategy: 'literal', targets: [{ kind: 'element', elementId: 'n1', evidenceSpanIds: ['x'] }, { kind: 'edge', fromElementId: 'n1', toElementId: 'n2', relationType: 'causes', evidenceSpanIds: ['x'] }] }] } } as unknown as SceneSpec;
  const d = claimDeadlines(withIntent, coverage as never);
  assert.equal(d.elementEndBy.get('n1'), 1500 + 900 - 150);
  assert.equal(d.edgeEndBy.get('n1->n2'), 1500 + 900 - 150);
  assert.equal(d.elementEndBy.has('n2'), false);
});

test('a reveal that would end after its claim window is drawn faster so it ends inside it', () => {
  const laid = layoutScene(resolveScene(spec(2)));
  const m = mentions(2, 500, 3000);
  const nominalEnd = compileTimelineFull(laid, m, 0, 20_000).events.find((e) => e.elementId === 'n2' && e.track !== 'emphasis')!.t1;
  const endBy = nominalEnd - 500;
  const timeline = compileTimelineFull(laid, m, 0, 20_000, { elementEndBy: new Map([['n2', endBy]]) });
  const event = timeline.events.find((e) => e.elementId === 'n2' && e.track !== 'emphasis')!;
  assert.ok(event.t1 <= endBy + 1, `${event.t1} <= ${endBy}`);
  assert.ok(event.t1 > event.t0);
});
