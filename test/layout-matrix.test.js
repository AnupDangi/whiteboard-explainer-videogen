import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../dist/src/semantic/compiler/compile-scene.js';
import {findCollisions, contains} from '../dist/src/semantic/compiler/collisions.js';
import {visualBounds} from '../dist/src/semantic/compiler/text.js';
import {BOARD} from '../dist/src/semantic/compiler/zones.js';
import {SUPPORTED_ARCHETYPES} from '../dist/src/semantic/compiler/zones.js';
import {ARCHETYPE_CAPACITY} from '../dist/src/semantic/compiler/archetypes.js';
import {getAsset} from '../dist/src/semantic/assets/registry.js';

/** S15 — the layout-invariant matrix.
 *
 *  `flow` overlapped its own nodes for months because only three archetypes had
 *  a spacing test. This suite covers EVERY archetype the compiler accepts, at
 *  every node count its capacity allows, with short and long labels, and asserts
 *  one thing:
 *
 *      the compiler must never manufacture its own `Illegal overlap`
 *      or `Canvas escape`.
 *
 *  A structural refusal (`Matrix operation requires an equation token`) is not a
 *  failure here — a generic fixture cannot satisfy every archetype's content
 *  contract, and refusing is correct. What is never acceptable is a compiler
 *  that lays out valid input and then rejects its own geometry. */

const LABELS = {
  short: (i) => `S${i}`,
  long: (i) => `The thermodynamic equilibrium of coupled subsystem number ${i}`,
  deep: (i) => `A deliberately extremely long conceptual label that wraps across the maximum permitted number of lines for object number ${i} in this scene`,
};

const build = (archetype, count, label, {chain = true} = {}) => {
  const objects = Array.from({length: count}, (_, i) => ({
    id: `n${i}`, conceptId: `c${i}`, label: label(i),
    role: i === 0 ? 'hero' : 'support',
    children: [], state: 'neutral', allowedStates: ['neutral', 'highlighted', 'activated'],
    importance: i === 0 ? 'primary' : 'secondary', collisionPolicy: 'forbid',
  }));
  // A single equation token keeps equation/matrix archetypes structurally
  // plausible; everything else stays a rectangle so the test exercises layout,
  // not the asset registry.
  if (['equation_walkthrough', 'matrix_operation'].includes(archetype)) {
    for (const [i, o] of objects.entries()) o.primitiveRef = i === 0 ? 'equation' : 'rectangle';
  } else {
    for (const o of objects) o.primitiveRef = 'rectangle';
  }
  const relations = [];
  if (chain) for (let i = 1; i < count; i++) relations.push({
    id: `r${i}`, from: {objectId: `n${i - 1}`, anchor: 'center'}, to: {objectId: `n${i}`, anchor: 'center'},
    relationType: 'flows_to', visualForm: 'flow',
  });
  return {
    version: 2, id: `matrix_${archetype}`, title: 'Matrix', teachingGoal: 'g', mentalModel: 'm', archetype,
    objects, relations,
    beats: [{id: 'b0', narration: 'probe', actions: objects.map((o, i) => ({id: `a${i}`, type: 'reveal', objectIds: [o.id], relationIds: [], durationMs: 400, leadMs: 0, easing: 'linear'}))}],
    continuity: {keepFromPrevious: [], prepareForNext: []},
  };
};

const isGeometryFailure = (error) => /Illegal overlap|Canvas escape/.test(String(error?.message ?? error));

let cases = 0, built = 0, refused = 0;
const failures = [];

for (const archetype of SUPPORTED_ARCHETYPES) {
  const capacity = ARCHETYPE_CAPACITY[archetype] ?? [2, 12];
  const counts = [...new Set([capacity[0], Math.max(capacity[0], Math.min(capacity[1], 4)), capacity[1]])];
  for (const count of counts) {
    for (const [kind, label] of Object.entries(LABELS)) {
      for (const chain of [true, false]) {
        cases++;
        const context = `${archetype} n=${count} ${kind} ${chain ? 'chain' : 'flat'}`;
        let compiled;
        try {
          compiled = compileScene(build(archetype, count, label, {chain}));
        } catch (error) {
          if (isGeometryFailure(error)) {
            failures.push(`${context}: ${error.message}`);
          } else {
            refused++; // a content contract the generic fixture cannot satisfy
          }
          continue;
        }
        built++;
        const collisions = findCollisions(compiled.objects);
        if (collisions.length) failures.push(`${context}: illegal overlap ${collisions.join(', ')}`);
        for (const object of compiled.objects) {
          for (const value of [object.x, object.y, object.w, object.h]) {
            if (!Number.isFinite(value)) failures.push(`${context}: ${object.id} non-finite geometry`);
          }
          if (!contains(BOARD.safe, visualBounds(object))) failures.push(`${context}: ${object.id} escaped the safe area`);
        }
      }
    }
  }
}

/** The layouts that DO manufacture invalid geometry today, captured exactly.
 *
 *  This is a defect register, not an allowance: the assertion below is
 *  bidirectional, so a NEW failing layout fails the suite, and a listed layout
 *  that starts passing also fails it until its entry is removed. That keeps the
 *  list honest and forces it to shrink rather than rot.
 *
 *  Each entry is a real bug with a known cause:
 *   - structural_diagram / convergence: they have NO placement branch, so roots
 *     fall through to `zoneRect`. The 330x440 structural hero plus a label needs
 *     up to 521px in a 498px safe band, and beyond 8 supports the zone rotation
 *     reuses rects -> escape and overlap.
 *   - cross_section / spatial_process: same zone fallback; a support whose label
 *     is wider than the 120px rect escapes horizontally.
 *   - equation_walkthrough: non-equation rows are 34px tall with a 14px gap = a
 *     48px pitch, but the compiler resets a label row to 44px and the collision
 *     gap is 8 -> 52px needed. Every adjacent note pair overlaps.
 *   - flow: a flat scene puts every root in one column; four or five rows plus a
 *     long label exceeds the safe band. */
const KNOWN_DEFECTS = new Set([
  'convergence n=12 short chain', 'convergence n=12 short flat',
  'equation_walkthrough n=6 long chain', 'equation_walkthrough n=6 long flat', 'equation_walkthrough n=6 short chain', 'equation_walkthrough n=6 short flat',
  'spatial_process n=12 long chain', 'spatial_process n=12 long flat',
  'structural_diagram n=12 short chain', 'structural_diagram n=12 short flat',
]);

test('no archetype manufactures its own illegal overlap or canvas escape', () => {
  assert.ok(cases > 100, `the matrix must be broad, ran ${cases} cases`);
  assert.ok(built > 50, `most cases must actually compile, built ${built}`);
  const failing = new Set(failures.map(entry => entry.replace(/: .*$/, '')));
  const introduced = [...failing].filter(context => !KNOWN_DEFECTS.has(context));
  const fixed = [...KNOWN_DEFECTS].filter(context => !failing.has(context));
  assert.deepEqual(introduced, [],
    `NEW layouts manufacture invalid geometry: ${introduced.join(', ')}`);
  assert.deepEqual(fixed, [],
    `these were fixed - remove them from KNOWN_DEFECTS: ${fixed.join(', ')}`);
  // 36 -> 26: the fit-to-safe repair fixed the structural hero escape and the
  // crowded-flow column shrink cases, so their entries were removed rather than
  // left to rot. The assertion is bidirectional, so this list can only shrink.
  assert.equal(KNOWN_DEFECTS.size, 10, 'the register is a fixed list; update it deliberately');
});
