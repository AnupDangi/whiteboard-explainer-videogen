import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../dist/src/semantic/compiler/compile-scene.js';
import {directionToScene} from '../dist/src/semantic/identity/intent-adapter.js';
import {renderSVG} from '../dist/src/semantic/renderer/render-svg.js';
import {findCollisions, contains} from '../dist/src/semantic/compiler/collisions.js';
import {visualBounds} from '../dist/src/semantic/compiler/text.js';
import {BOARD} from '../dist/src/semantic/compiler/zones.js';

/** Regression for the layered-layout overlap.
 *
 *  `branch`/`cause_effect`/`state_machine` used to pitch rows at
 *  `400/group.length` — 100px for a 4-node rank — while a node's rect plus its
 *  label block is ~166px tall. The layout itself therefore produced the
 *  geometry the compiler rejected as `Illegal overlap`, and the bounded repair
 *  pass could not fix it (the hero is immovable and the 0.8 scale floor is
 *  above what was needed). That is the wall that made live jobs unfinishable.
 *
 *  These tests are compiler-only: no model, no fixtures. The two remaining
 *  hard limits (a label that cannot fit a node, and chains deeper than the
 *  four-rank readability cap) are pinned explicitly rather than silently
 *  passing, so a later wave has to change them deliberately. */

const LAYERED = ['branch', 'cause_effect', 'state_machine'];
const COUNTS = [2, 3, 4, 6, 10];
const FITTABLE = {
  short: ['Sun', 'Rain', 'Soil', 'Root', 'Leaf', 'Air', 'Heat', 'Wind', 'Salt', 'Rock'],
  mixed: [
    'Sun', 'Photosynthetic carbon fixation', 'Soil', 'Conservation of momentum',
    'Leaf', 'Electromagnetic induction', 'Heat', 'Diffusive momentum transport',
    'Salt', 'Phase transition dynamics',
  ],
};
const LONG_HERO_LABEL = ['The thermodynamic equilibrium of the coupled atmospheric system'];

function scene(archetype, count, labels, {chain = false} = {}) {
  const objects = Array.from({length: count}, (_, i) => ({
    id: `obj_${i}`,
    label: labels[i % labels.length],
    role: i === 0 ? 'hero' : 'support',
    children: [],
    state: 'neutral',
    allowedStates: ['neutral', 'highlighted', 'activated'],
    importance: i === 0 ? 'primary' : 'secondary',
    collisionPolicy: 'forbid',
    primitiveRef: 'rectangle',
  }));
  const relations = [];
  if (chain) {
    for (let i = 1; i < count; i++) relations.push({
      id: `rel_${i}`,
      from: {objectId: `obj_${i - 1}`, anchor: 'center'},
      to: {objectId: `obj_${i}`, anchor: 'center'},
      relationType: 'causes',
      visualForm: 'arrow',
    });
  }
  const actions = objects.map((o, i) => ({
    id: `act_${i}`,
    type: 'reveal',
    objectIds: [o.id],
    relationIds: [],
    durationMs: 600,
    leadMs: 0,
    easing: 'linear',
  }));
  return {
    version: 2,
    id: 'layout_probe',
    title: 'Layout probe',
    teachingGoal: 'exercise the layered layout',
    mentalModel: 'cause and effect',
    archetype,
    objects,
    relations,
    beats: [{id: 'beat_1', narration: 'probe', actions}],
    continuity: {keepFromPrevious: [], prepareForNext: []},
  };
}

const assertSeparated = (compiled, context) => {
  assert.equal(findCollisions(compiled.objects).length, 0, `${context}: illegal overlap`);
  for (const o of compiled.objects) {
    for (const value of [o.x, o.y, o.w, o.h]) {
      assert.ok(Number.isFinite(value), `${context}: ${o.id} has non-finite geometry`);
    }
    assert.ok(contains(BOARD.safe, visualBounds(o)),
      `${context}: ${o.id} escaped the safe area`);
  }
  const svg = renderSVG(compiled, compiled.durationMs);
  assert.ok(!/NaN|Infinity/.test(svg), `${context}: SVG contains non-finite geometry`);
  assert.equal(svg, renderSVG(JSON.parse(JSON.stringify(compiled)), compiled.durationMs),
    `${context}: rendering is not deterministic`);
};

for (const archetype of LAYERED) {
  for (const count of COUNTS) {
    for (const [labelKind, labels] of Object.entries(FITTABLE)) {
      test(`layered layout separates ${count} nodes: ${archetype} / ${labelKind} labels / one rank`, () => {
        assertSeparated(compileScene(scene(archetype, count, labels)), `${archetype} ${count} flat ${labelKind}`);
      });

      if (count <= 6) {
        test(`layered layout separates ${count} nodes: ${archetype} / ${labelKind} labels / chained ranks`, () => {
          assertSeparated(compileScene(scene(archetype, count, labels, {chain: true})), `${archetype} ${count} chain ${labelKind}`);
        });
      } else {
        test(`layered layout refuses a ${count}-deep chain instead of misplacing it: ${archetype}`, () => {
          assert.throws(() => compileScene(scene(archetype, count, labels, {chain: true})),
            /exceeds \d+ readable layers/,
            'a chain deeper than the readability cap must fail loudly, not silently overlap');
        });
      }
    }
  }

  test(`layered layout refuses a hero label it cannot fit: ${archetype}`, () => {
    assert.throws(() => compileScene(scene(archetype, 4, LONG_HERO_LABEL)),
      /Critical label would be truncated/,
      'an unrenderable hero label must fail loudly rather than ship a truncated hero');
  });
}

/** A child is placed INSIDE its parent's rect, so a child left on the default
 *  `forbid` collision policy is an unconditional illegal overlap: only
 *  contain/overlay/allow/touch short-circuit the collision check. Containment
 *  parenting is implicit in the direction contract, so the policy is normalised
 *  when the parent is assigned. Measured on a live run: `object_axiom` was a
 *  child of the hero with `forbid`, which failed a structural_diagram scene. */
test('a parented child is normalised to a relative collision policy and never overlaps its parent', () => {
  const direction = {
    archetype: 'structural_diagram', title: 'Grounding', teachingGoal: 'g', mentalModel: 'm',
    objects: [
      {conceptKey: 'world-model', label: 'World Model', role: 'hero', state: 'neutral', allowedStates: ['neutral'], importance: 'primary', collisionPolicy: 'forbid', children: ['axiom']},
      {conceptKey: 'axiom', label: 'Axiom', role: 'support', state: 'neutral', allowedStates: ['neutral'], importance: 'secondary', collisionPolicy: 'forbid', children: []},
      {conceptKey: 'induction', label: 'Induction', role: 'support', state: 'neutral', allowedStates: ['neutral'], importance: 'secondary', collisionPolicy: 'forbid', preferredZone: 'lower_right', children: []},
    ],
    relations: [
      {fromConcept: 'world-model', relation: 'contains', toConcept: 'axiom'},
      {fromConcept: 'world-model', relation: 'activates', toConcept: 'induction'},
    ],
    beats: [{key: 'beat_1', narration: 'probe', actions: [
      {type: 'reveal', durationMs: 600, leadMs: 0, easing: 'linear', conceptKeys: ['world-model'], relationRefs: []},
      {type: 'reveal', durationMs: 600, leadMs: 0, easing: 'linear', conceptKeys: ['axiom'], relationRefs: []},
      {type: 'reveal', durationMs: 600, leadMs: 0, easing: 'linear', conceptKeys: ['induction'], relationRefs: []},
    ]}],
  };
  const semantic = {id: 'grounding', beats: [{id: 'beat_1', transform: []}], requiredRelations: []};
  const scene = directionToScene(direction, semantic);
  const child = scene.objects.find(o => o.conceptId === 'axiom');
  assert.equal(child.parentId, 'object_world-model');
  assert.equal(child.collisionPolicy, 'contain', 'a parented child must not stay on forbid');
  assertSeparated(compileScene(scene), 'containment child');
});

/** Continuity reuses a root's previous geometry verbatim, but a child's geometry
 *  is derived from its parent. Reusing a child's rect places it outside a parent
 *  that moved or resized, and children are excluded from every repair pass, so
 *  the scene failed with an unrepairable containment violation. Measured on
 *  scene 2 of a narrated run. */
test('a kept child is re-derived from its parent instead of reusing moved geometry', () => {
  const build = (parentZone, keep = []) => ({
    version: 2, id: 'cont', title: 'Continuity', teachingGoal: 'g', mentalModel: 'm',
    archetype: 'structural_diagram',
    objects: [
      {id: 'p', label: 'Parent', role: 'hero', children: ['c'], state: 'neutral', allowedStates: ['neutral'], importance: 'primary', preferredZone: parentZone, collisionPolicy: 'forbid', primitiveRef: 'rectangle'},
      {id: 'c', label: 'Child', role: 'support', parentId: 'p', children: [], state: 'neutral', allowedStates: ['neutral'], importance: 'secondary', collisionPolicy: 'contain', primitiveRef: 'label'},
    ],
    relations: [{id: 'r', from: {objectId: 'p', anchor: 'center'}, to: {objectId: 'c', anchor: 'center'}, relationType: 'contains', visualForm: 'containment'}],
    beats: [{id: 'b', narration: 'probe', actions: [
      {id: 'a1', type: 'reveal', objectIds: ['p'], relationIds: [], durationMs: 600, leadMs: 0, easing: 'linear'},
      {id: 'a2', type: 'reveal', objectIds: ['c'], relationIds: [], durationMs: 600, leadMs: 0, easing: 'linear'},
    ]}],
    continuity: {keepFromPrevious: keep, prepareForNext: []},
  });
  const previous = compileScene(build('center'));
  // Simulate the parent having moved/resized: the previous child rect is now
  // outside its parent, which is exactly what verbatim reuse would restore.
  const stale = previous.objects.find(o => o.id === 'c');
  stale.x = 1200; stale.y = 100;
  const compiled = compileScene(build('center', ['c']), undefined, previous);
  assert.equal(findCollisions(compiled.objects).length, 0, 'a kept child must not overlap its parent');
  const parent = compiled.objects.find(o => o.id === 'p');
  const child = compiled.objects.find(o => o.id === 'c');
  assert.ok(contains(parent, child), 'the child must remain inside its parent');
  assert.ok(compiled.diagnostics.some(d => d.includes('re-derived child c')),
    'dropping the reused child geometry must be recorded');
});
