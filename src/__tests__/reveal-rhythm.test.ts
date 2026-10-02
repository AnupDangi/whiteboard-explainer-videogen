import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneSpec } from '../shared/types.js';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull, EDGE_STAGGER_MS } from '../timeline/compile.js';
import { runClaudeGates, CLOSING_FREEZE_MIN_MS } from '../validate/gates.js';

const spec: SceneSpec = {
  schemaVersion: 'claude-scene-spec/v1', sceneId: 'rhythm', title: 'Rhythm', template: 'convergence',
  elements: [
    { id: 'a', slot: 'input', anchor: 'sceneStart', prim: 'box', text: 'A' },
    { id: 'b', slot: 'input', anchor: 'sceneStart', prim: 'box', text: 'B' },
    { id: 'c', slot: 'input', anchor: 'sceneStart', prim: 'box', text: 'C' },
    { id: 'out', slot: 'output', anchor: 'sceneStart', prim: 'box', text: 'Out' },
  ],
  edges: [{ from: 'a', to: 'out' }, { from: 'b', to: 'out' }, { from: 'c', to: 'out' }],
} as SceneSpec;

test('arrows into one node are staggered, never simultaneous, and stay causally ordered', () => {
  const laid = layoutScene(resolveScene(spec));
  const timeline = compileTimelineFull(laid, [], 0, 20_000);
  const edges = timeline.events.filter((event) => event.track === 'edge').sort((x, y) => x.t0 - y.t0);
  assert.equal(edges.length, 3);
  for (let i = 1; i < edges.length; i++) assert.ok(edges[i]!.t0 - edges[i - 1]!.t0 >= EDGE_STAGGER_MS, `gap ${edges[i]!.t0 - edges[i - 1]!.t0}`);
  const reveal = new Map(timeline.events.filter((event) => event.track !== 'edge').map((event) => [event.elementId, event]));
  for (const event of edges) assert.ok(event.t0 >= reveal.get(event.elementId.split('->')[0]!)!.t1 - 1, 'edge starts after its source finishes');
});

test('a scene whose board is complete only at the very end warns about the missing closing hold', () => {
  const laid = layoutScene(resolveScene(spec));
  const base = compileTimelineFull(laid, [], 0, 12_000);
  const late = { ...base, events: [...base.events, { elementId: 'a', track: 'object', t0: 8_000, t1: 8_700 } as unknown as (typeof base.events)[number]] };
  assert.ok(runClaudeGates(laid, { ...late, sceneEndMs: 10_000 }).warnings.some((warning) => warning.code === 'closing-freeze-short'));
  assert.ok(!runClaudeGates(laid, { ...late, sceneEndMs: 8_700 + CLOSING_FREEZE_MIN_MS + 500 }).warnings.some((warning) => warning.code === 'closing-freeze-short'));
});
