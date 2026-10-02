import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResolvedMention, SceneSpec } from '../shared/types.js';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimeline, compileTimelineFull } from '../timeline/compile.js';
import { runClaudeGates } from '../validate/gates.js';

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

test('timeline-compressed: a squeezed scene emits a soft warning naming the scene, not a hard failure', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  // Heavy contention in a 1500 ms window forces proportional (k < 1) compression.
  const timeline = compileTimeline(laidOut, [mention('a', 0, 0), mention('b', 0, 0), mention('c', 0, 0)], 0, 1500);
  const { failures, warnings } = runClaudeGates(laidOut, timeline);
  const found = warnings.filter((w) => w.code === 'timeline-compressed');
  assert.equal(found.length, 1, `expected one timeline-compressed warning, got: ${warnings.map((w) => w.code).join(',')}`);
  assert.equal(found[0]!.hard, false);
  assert.match(found[0]!.message, /sped up/);
  assert.equal(failures.some((f) => f.code === 'timeline-compressed'), false);
});

test('timeline-idle-filled: a long quiet tail filled with emphasis rings emits a soft warning', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  const timeline = compileTimelineFull(laidOut, [mention('a', 100, 200), mention('b', 300, 400), mention('c', 500, 600)], 0, 15000);
  const { failures, warnings } = runClaudeGates(laidOut, timeline);
  // Donor renamed the code to 'idle' (gates.ts): emphasis rings are filler
  // and are reported, not counted, in the longest no-new-content window.
  const found = warnings.filter((w) => w.code === 'idle');
  assert.equal(found.length, 1, `expected one idle warning, got: ${warnings.map((w) => w.code).join(',')}`);
  assert.equal(found[0]!.hard, false);
  assert.match(found[0]!.message, /without new content/);
  assert.equal(failures.some((f) => f.code === 'idle'), false);
});

test('timeline: a roomy scene with no squeeze and no idle fills emits neither warning', () => {
  const laidOut = layoutScene(resolveScene(chainSpec));
  // Dense mentions, tight end: reveals fit uncompressed and every quiet
  // window stays under maxIdleMs. Full compile proves the closing focus
  // emphasis alone does not count as an idle fill.
  const timeline = compileTimelineFull(laidOut, [mention('a', 1000, 1100), mention('b', 3000, 3100), mention('c', 5000, 5100)], 0, 7500);
  const { warnings } = runClaudeGates(laidOut, timeline);
  assert.deepEqual(warnings.filter((w) => w.code === 'timeline-compressed'), []);
  assert.deepEqual(warnings.filter((w) => w.code === 'idle'), []);
});
