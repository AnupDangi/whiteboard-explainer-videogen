import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSceneBoard } from '../visual-v2/ops-plan/fallback.js';
import { validateSceneBoard, type BoardContext } from '../visual-v2/ops-plan/validate.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';

const beat = (n: number, concepts: string[], over: Partial<TeachingBeat> = {}): TeachingBeat => ({
  beatId: `sc.b${n}`, sceneId: 'sc', order: n, claimIds: [`c${n}`], learnerDelta: 'd', beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'process',
  entities: concepts.map((conceptId) => ({ conceptId })), relationships: [], misconceptionIds: [], narrationGoal: 'g', visualInvariant: 'v', mutedMeaning: 'm',
  narrationOnly: false, persistence: 'scene', pauseIntent: 'micro', evidenceSpanIds: ['s1'], ...over,
});
const contextFor = (labels: [string, string, string]): BoardContext => ({
  sceneId: 'sc', title: 'Any scene',
  beats: [beat(1, ['a', 'b']), beat(2, ['b', 'c']), beat(3, [], { narrationOnly: true })],
  narration: [{ beatId: 'sc.b1', sentences: ['One.'] }, { beatId: 'sc.b2', sentences: ['Two.'] }, { beatId: 'sc.b3', sentences: ['Three.'] }],
  concepts: [{ id: 'a', label: labels[0] }, { id: 'b', label: labels[1] }, { id: 'c', label: labels[2] }],
  initial: emptyBoardState(),
});

test('the fallback board is valid, draws each concept once, and changes the board at every visual beat', () => {
  const ctx = contextFor(['Alpha thing', 'Beta thing', 'Gamma thing']);
  const draft = fallbackSceneBoard(ctx);
  assert.ok(draft);
  assert.deepEqual(validateSceneBoard(draft, ctx), []);
  assert.equal(draft.transition.mode, 'clean');
  assert.equal(draft.ops.filter((o) => o.op === 'add').length, 3);
  for (const id of ['sc.b1', 'sc.b2']) assert.ok(draft.ops.some((o) => o.beatId === id), id);
  assert.equal(draft.ops.some((o) => o.beatId === 'sc.b3'), false, 'a narration-only beat needs no op');
});

test('the fallback carries only what the scene data says: other labels give other boards from the same code, and no relations or claims are invented', () => {
  const one = fallbackSceneBoard(contextFor(['Alpha thing', 'Beta thing', 'Gamma thing']))!;
  const two = fallbackSceneBoard(contextFor(['Voltage', 'Current', 'Resistance']))!;
  const labels = (draft: typeof one) => draft.ops.flatMap((o) => (o.op === 'add' && o.element.type === 'entity' ? [o.element.label] : []));
  assert.deepEqual(labels(one), ['Alpha thing', 'Beta thing', 'Gamma thing']);
  assert.deepEqual(labels(two), ['Voltage', 'Current', 'Resistance']);
  assert.equal(one.ops.some((o) => o.op === 'connect' || o.op === 'updateValue' || o.op === 'equationStep'), false);
  assert.ok(one.ops.every((o) => o.op !== 'add' || (o.element.provenance === 'illustrative' && o.element.bindings?.claimIds.length)), 'ungrounded labels are illustrative and bound to claims');
});
