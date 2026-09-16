import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../dist/src/semantic/compiler/compile-scene.js';
import {renderSVG} from '../dist/src/semantic/renderer/render-svg.js';
import {path} from '../dist/src/semantic/assets/geometry.js';
import {MOTIONS} from '../dist/src/semantic/types.js';
import {SUPPORTED_ARCHETYPES} from '../dist/src/semantic/compiler/zones.js';
import {classifyFailure, stageFailure} from '../dist/src/semantic/repair.js';

/** X2 — named cross-cutting production invariants, each delegating to the real
 *  modules. A fixture that passes here proves the rule is enforced by code, not
 *  only by convention. */

const obj = (id, role = 'support', extra = {}) => ({
  id, conceptId: id, label: id, role, children: [], state: 'neutral',
  allowedStates: ['neutral'], importance: role === 'hero' ? 'primary' : 'secondary',
  collisionPolicy: 'forbid', primitiveRef: 'rectangle', ...extra,
});
const relation = (id, from, to, relationType = 'causes', visualForm = 'arrow') => ({
  id, from: {objectId: from, anchor: 'center'}, to: {objectId: to, anchor: 'center'}, relationType, visualForm,
});
const scene = (archetype, objects, relations = []) => ({
  version: 2, id: 'probe', title: 'Probe', teachingGoal: 'exercise', mentalModel: 'm', archetype,
  objects, relations,
  beats: [{id: 'beat_1', narration: 'probe', actions: objects.map((o, i) => ({
    id: `a${i}`, type: 'reveal', objectIds: [o.id], relationIds: [], durationMs: 600, leadMs: 0, easing: 'linear',
  }))}],
  continuity: {keepFromPrevious: [], prepareForNext: []},
});

// One minimal, compiling scene per supported archetype. Kept explicit so a new
// archetype added to SUPPORTED_ARCHETYPES fails here until it is buildable.
const builders = {
  flow: () => scene('flow', [obj('a', 'hero'), obj('b')]),
  cycle: () => scene('cycle', [obj('a', 'hero'), obj('b'), obj('c')],
    [relation('r1', 'a', 'b'), relation('r2', 'b', 'c'), relation('r3', 'c', 'a')]),
  structural_diagram: () => scene('structural_diagram', [obj('a', 'hero')]),
  convergence: () => scene('convergence', [obj('a', 'hero')]),
  transformation: () => scene('transformation', [obj('a', 'hero'), obj('b')]),
  comparison: () => scene('comparison', [obj('a', 'hero'), obj('b')]),
  cross_section: () => scene('cross_section', [obj('a', 'hero')]),
  spatial_process: () => scene('spatial_process', [obj('a', 'hero')]),
  numbered_steps: () => scene('numbered_steps', [obj('a', 'hero', {primitiveRef: 'label'}), obj('b', 'support', {primitiveRef: 'label'})]),
  equation_walkthrough: () => scene('equation_walkthrough', [obj('a', 'hero', {primitiveRef: 'equation'}), obj('b', 'support', {primitiveRef: 'equation'})]),
  matrix_operation: () => scene('matrix_operation', [
    {id: 'a', conceptId: 'a', label: 'matrix', role: 'hero', children: [], state: 'neutral', allowedStates: ['neutral'], importance: 'primary', collisionPolicy: 'forbid', assetRef: 'math.matrix.v2'},
    obj('op', 'support', {primitiveRef: 'equation'}),
    {id: 'b', conceptId: 'b', label: 'vector', role: 'support', children: [], state: 'neutral', allowedStates: ['neutral'], importance: 'secondary', collisionPolicy: 'forbid', assetRef: 'math.vector.v2'},
  ]),
  hierarchy: () => scene('hierarchy', [obj('a', 'hero'), obj('b')], [relation('r1', 'a', 'b', 'contains')]),
  timeline: () => scene('timeline', [obj('a', 'hero', {primitiveRef: 'label'}), obj('b', 'support', {primitiveRef: 'label'})]),
  trajectory: () => scene('trajectory', [obj('a', 'hero', {primitiveRef: 'label'}), obj('b', 'support', {primitiveRef: 'label'}), obj('c', 'support', {primitiveRef: 'label'})]),
  branch: () => scene('branch', [obj('a', 'hero'), obj('b')]),
  cause_effect: () => scene('cause_effect', [obj('a', 'hero'), obj('b')]),
  state_machine: () => scene('state_machine', [obj('a', 'hero'), obj('b')]),
};

test('every SUPPORTED_ARCHETYPES entry compiles a minimal scene', () => {
  for (const archetype of SUPPORTED_ARCHETYPES) {
    assert.equal(typeof builders[archetype], 'function', `no minimal scene exists for supported archetype "${archetype}"`);
    assert.doesNotThrow(() => compileScene(builders[archetype]()), `supported archetype "${archetype}" must compile`);
  }
  // Declared in ARCHETYPES but not executable: they must never be selectable.
  assert.ok(!SUPPORTED_ARCHETYPES.includes('simple_explanation'), 'simple_explanation is declared but unsupported');
  assert.ok(!SUPPORTED_ARCHETYPES.includes('chart'), 'chart is declared but unsupported');
});

test('MOTIONS excludes motions with no renderer branch', () => {
  assert.deepEqual(MOTIONS.filter(m => ['move', 'split', 'merge'].includes(m)), [],
    'the advertised motion set must exclude motions the renderer cannot animate');
});

test('a relation with no animating action still renders statically', () => {
  const compiled = compileScene(scene('flow',
    [obj('a', 'hero'), obj('b')],
    [relation('r_ab', 'a', 'b')]));
  const routed = compiled.relations[0];
  const svg = renderSVG(compiled, compiled.durationMs);
  const marker = `d="${path(routed.points)}"`;
  const at = svg.indexOf(marker);
  assert.ok(at >= 0, 'a relation that nothing animates must still be drawn');
  assert.ok(svg.slice(at, at + 400).includes('stroke-dashoffset="0"'),
    'a static relation is drawn fully, not left partially stroked');
});

test('renderSVG is deterministic and does not mutate the compiled scene', () => {
  const compiled = compileScene(scene('flow', [obj('a', 'hero'), obj('b')]));
  const before = JSON.stringify(compiled);
  const first = renderSVG(compiled, 0);
  const second = renderSVG(compiled, 0);
  assert.equal(first, second, 'the same scene and time must render the same string');
  assert.equal(JSON.stringify(compiled), before, 'renderSVG must not mutate its input scene');
});

test('a compiler geometry failure is owned by the compiler, not the model call', () => {
  const failure = stageFailure(new Error('Illegal overlap'), 'compile');
  const classification = classifyFailure(failure, 'visual-director');
  assert.equal(classification.owner, 'compiler',
    'a geometry failure must route to the compiler instead of triggering another model call');
});
