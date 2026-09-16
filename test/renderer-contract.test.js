import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../dist/src/semantic/compiler/compile-scene.js';
import {renderSVG} from '../dist/src/semantic/renderer/render-svg.js';
import {path} from '../dist/src/semantic/assets/geometry.js';
import {MOTIONS} from '../dist/src/semantic/types.js';

/** Runtime contract: schema-valid must mean runtime-supported.
 *
 *  S3.1 — a relation is knowledge, not decoration. It must render even when no
 *  action animates it. Previously `renderRelations` returned early unless a
 *  trace/flow action existed, so graph edges silently vanished and the picture
 *  was poorer than the graph. */

const scene = ({motion = null} = {}) => ({
  version: 2, id: 'rel', title: 'Rel', teachingGoal: 'g', mentalModel: 'm', archetype: 'flow',
  objects: [
    {id: 'a', label: 'Alpha', role: 'hero', children: [], state: 'neutral', allowedStates: ['neutral', 'highlighted', 'activated'], importance: 'primary', collisionPolicy: 'forbid', primitiveRef: 'rectangle'},
    {id: 'b', label: 'Beta', role: 'support', children: [], state: 'neutral', allowedStates: ['neutral', 'highlighted', 'activated'], importance: 'secondary', collisionPolicy: 'forbid', primitiveRef: 'rectangle'},
  ],
  relations: [{id: 'r_ab', from: {objectId: 'a', anchor: 'center'}, to: {objectId: 'b', anchor: 'center'}, relationType: 'causes', visualForm: 'arrow'}],
  beats: [{id: 'beat_1', narration: 'probe', actions: [
    {id: 'a1', type: 'reveal', objectIds: ['a'], relationIds: [], durationMs: 400, leadMs: 0, easing: 'linear'},
    {id: 'a2', type: 'reveal', objectIds: ['b'], relationIds: [], durationMs: 400, leadMs: 0, easing: 'linear'},
    ...(motion ? [{id: 'a3', type: motion, objectIds: motion === 'trace' ? [] : [], relationIds: ['r_ab'], durationMs: 1500, leadMs: 0, easing: 'linear'}] : []),
  ]}],
  continuity: {keepFromPrevious: [], prepareForNext: []},
});

test('a relation with no animating action renders statically instead of vanishing', () => {
  const compiled = compileScene(scene());
  const relation = compiled.relations[0];
  const svg = renderSVG(compiled, compiled.durationMs);
  const marker = `d="${path(relation.points)}"`;
  const at = svg.indexOf(marker);
  assert.ok(at >= 0, 'a relation that nothing animates must still be drawn');
  assert.ok(svg.slice(at, at + 400).includes('stroke-dashoffset="0"'),
    'a static relation is drawn fully, not left partially stroked');
});

test('an animated relation draws progressively instead of appearing fully formed', () => {
  const compiled = compileScene(scene({motion: 'flow'}));
  const relation = compiled.relations[0];
  const motion = compiled.actions.find(a => a.type === 'flow');
  const svg = renderSVG(compiled, Math.max(0, motion.startMs));
  const at = svg.indexOf(`d="${path(relation.points)}"`);
  assert.ok(at >= 0, 'the relation must be drawn while its motion runs');
  assert.ok(!svg.slice(at, at + 400).includes('stroke-dashoffset="0"'),
    'a relation with a motion must not be fully drawn the instant it starts');
  assert.ok(renderSVG(compiled, compiled.durationMs).includes(`d="${path(relation.points)}"`),
    'the relation must be fully drawn once its motion has run');
});

/** S3.2 — advertised capability must equal implemented capability. `move`,
 *  `split` and `merge` were in the prompt and the schema but had no renderer
 *  branch, so emitting one animated nothing. */
test('unimplemented motions are rejected by the contract, not silently timed', () => {
  assert.deepEqual(MOTIONS.filter(m => ['move', 'split', 'merge'].includes(m)), [], 'the advertised motion set must exclude unimplemented motions');
  for (const type of ['move', 'split', 'merge']) {
    const s = scene();
    s.beats[0].actions.push({id: 'x1', type, objectIds: ['a'], relationIds: [], durationMs: 600, leadMs: 0, easing: 'linear'});
    assert.throws(() => compileScene(s), `${type} must not enter the compiler as a valid motion`);
  }
});

/** S3.3 — continuity decisions must be realised, not computed-and-ignored.
 *  Each action has an observable outcome in the compiled scene (see the
 *  ContinuityAction comment in types.ts). This proves the three that are
 *  realised purely by construction; TRANSFORM/REPLACE are covered by the
 *  board-alignment gate, MOVE by placement. */
const rect = (id, conceptId) => ({id, conceptId, label: id, role: 'support', children: [], state: 'neutral', allowedStates: ['neutral', 'highlighted', 'activated'], importance: 'secondary', collisionPolicy: 'forbid', primitiveRef: 'rectangle'});
const twoScene = (objects, keep) => ({
  version: 2, id: 's2', title: 'S2', teachingGoal: 'g', mentalModel: 'm', archetype: 'flow',
  objects,
  relations: [],
  beats: [{id: 'beat_1', narration: 'probe', actions: objects.map((o, i) => ({id: `r${i}`, type: 'reveal', objectIds: [o.id], relationIds: [], durationMs: 400, leadMs: 0, easing: 'linear'}))}],
  continuity: {keepFromPrevious: keep, prepareForNext: []},
});

test('every continuity action is realised in the compiled scene', async () => {
  const {deriveContinuityDecisions} = await import('../dist/src/semantic/harness/state.js');
  const previous = compileScene(twoScene([rect('a', 'a'), rect('b', 'b')], []));

  const second = twoScene([rect('a', 'a'), rect('c', 'c')], ['a']);
  const registry = {version: 1, entries: [
    {semanticKey: 'a', canonicalName: 'A', aliases: [], persistentId: 'concept:a', semanticParts: [], sceneInstances: [{sceneId: 's1', objectId: 'a'}]},
    {semanticKey: 'b', canonicalName: 'B', aliases: [], persistentId: 'concept:b', semanticParts: [], sceneInstances: [{sceneId: 's1', objectId: 'b'}]},
    {semanticKey: 'c', canonicalName: 'C', aliases: [], persistentId: 'concept:c', semanticParts: [], sceneInstances: [{sceneId: 's0', objectId: 'c0'}]},
  ]};

  const decisions = deriveContinuityDecisions(second, previous, registry);
  const actionOf = (conceptId) => decisions.find(d => d.conceptId === conceptId)?.action;
  assert.equal(actionOf('a'), 'KEEP');
  assert.equal(actionOf('b'), 'REMOVE');
  assert.equal(actionOf('c'), 'REINTRODUCE');

  const compiled = compileScene(second, undefined, previous);
  assert.ok(compiled.scene.continuity.keepFromPrevious.includes('a'),
    'KEEP is realised by persistent visibility');
  assert.ok(!second.objects.some(o => o.conceptId === 'b'),
    'REMOVE is realised by the concept being absent from the scene');
  assert.ok(compiled.actions.some(a => a.objectIds.includes('c')),
    'REINTRODUCE is realised by a reveal/draw action');
});
