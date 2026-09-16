import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../dist/src/semantic/compiler/compile-scene.js';
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

      if (count <= 4) {
        test(`layered layout separates ${count} nodes: ${archetype} / ${labelKind} labels / chained ranks`, () => {
          assertSeparated(compileScene(scene(archetype, count, labels, {chain: true})), `${archetype} ${count} chain ${labelKind}`);
        });
      } else {
        test(`layered layout refuses a ${count}-deep chain instead of misplacing it: ${archetype}`, () => {
          assert.throws(() => compileScene(scene(archetype, count, labels, {chain: true})),
            /exceeds four readable layers/,
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
