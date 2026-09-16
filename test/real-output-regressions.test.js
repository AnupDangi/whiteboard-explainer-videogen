import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {healSchema} from '../dist/src/semantic/schemas.js';
import {directorResponseSchema} from '../dist/src/semantic/planning/visual-director.js';
import {directionToScene} from '../dist/src/semantic/identity/intent-adapter.js';
import {validateVisualScene} from '../dist/src/semantic/planning/validate.js';
import {applyCompositionFallbacks} from '../dist/src/semantic/compiler/fallback.js';

/** S9 — a contract-drift corpus built from REAL model output.
 *
 *  These are verbatim `{direction, decisions}` responses a live model returned,
 *  captured from the run logs. They are not hand-authored. Of the 42 distinct
 *  director outputs collected, every single one carried actions with
 *  `relationRefs` and no `conceptKeys`, which the validator used to reject as
 *  "Object action requires object targets only" — the defect that killed whole
 *  jobs before the target-kind heal existed.
 *
 *  Replay mirrors the real path: the adapter heals the raw response against
 *  the director response schema before the director's validate callback converts
 *  it. A fixture failing here is a real regression, not a fixture to relax. */

const DIR = 'test/real-output-regressions';
const fixtures = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

/** The direction names concepts and beats by key; this is the smallest plan
 *  satisfying those references, with the direction's own narration so spoken
 *  anchors are resolvable exactly as the planner's draft would make them. */
const planFor = (direction) => ({
  version: 2,
  id: 'regression',
  centralConceptId: direction.objects[0].conceptKey,
  teachingGoal: 'g',
  learnerShouldUnderstand: 'u',
  mentalModel: direction.mentalModel ?? 'm',
  beats: direction.beats.map(beat => ({id: beat.key, narrationDraft: beat.narration, transform: []})),
  requiredConceptIds: direction.objects.map(object => object.conceptKey),
  requiredRelations: [],
  candidateArchetypes: [direction.archetype],
  continuity: {keepFromPrevious: [], prepareForNext: []},
});

const convert = (file) => {
  const fixture = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  const healed = healSchema(fixture.response, directorResponseSchema);
  const direction = healed.direction;
  return {fixture, direction, scene: directionToScene(direction, planFor(direction))};
};

test('the corpus is present, non-empty and self-describing', () => {
  assert.ok(fixtures.length >= 5, `expected the captured fixtures, found ${fixtures.length}`);
  for (const file of fixtures) {
    const fixture = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    assert.ok(fixture.response?.direction, `${file} must carry the raw response`);
    assert.ok(fixture.capturedFrom, `${file} must record the run it came from`);
    assert.ok(fixture.note, `${file} must record what went wrong`);
  }
});

test('every real action addresses exactly one target kind', () => {
  let actions = 0;
  for (const file of fixtures) {
    const {scene} = convert(file);
    for (const beat of scene.beats) {
      for (const action of beat.actions) {
        actions++;
        assert.ok(action.objectIds.length > 0 || action.relationIds.length > 0,
          `${file}: ${action.id} has no target`);
        if (['draw', 'reveal', 'fill'].includes(action.type)) {
          assert.ok(action.objectIds.length > 0 && action.relationIds.length === 0,
            `${file}: ${action.id} (${action.type}) must carry object targets only`);
        }
        if (['trace', 'flow'].includes(action.type)) {
          assert.ok(action.relationIds.length > 0 && action.objectIds.length === 0,
            `${file}: ${action.id} (${action.type}) must carry relation targets only`);
        }
      }
    }
  }
  assert.ok(actions > 20, `expected the corpus to exercise many actions, saw ${actions}`);
});

test('every converted scene passes structural validation', () => {
  for (const file of fixtures) {
    const {scene} = convert(file);
    assert.doesNotThrow(() => validateVisualScene(scene), `${file} must convert to a valid scene`);
  }
});

/** The logger redacts narration before it reaches the log, so a capture taken
 *  from a log cannot be compiled: spoken anchors can never be found in
 *  `"[REDACTED]"`. That is a property of the CAPTURE, not of the pipeline, and
 *  it is asserted here so nobody reads a skipped fixture as a passing one.
 *  Future captures should set `V2_REPLAY_DIR`, which writes the raw response to
 *  disk before redaction. */
const isRedacted = (direction) => direction.beats.some(beat => String(beat.narration ?? '').includes('[REDACTED]'));

test('nothing in the corpus is silently skipped: redacted captures are declared', () => {
  const redacted = fixtures.filter(f => isRedacted(convert(f).direction));
  assert.equal(redacted.length, fixtures.length,
    `expected every logged capture to be redacted, but these are complete: ${fixtures.filter(f => !isRedacted(convert(f).direction)).join(', ')}`);
  for (const file of fixtures) {
    assert.ok(convert(file).direction.beats.length > 0, `${file} must carry beats`);
  }
});

test('what the corpus can prove: every real output converts and survives composition repair', () => {
  let checked = 0;
  for (const file of fixtures) {
    const {scene} = convert(file);
    // Compilation is deliberately not asserted: spoken anchors need the beat
    // narration, and a log capture has it redacted. What IS proven here is that
    // the real bytes convert into a valid scene and survive the model-free
    // composition repairs, which is where the action-target defect lived.
    const {scene: repaired} = applyCompositionFallbacks(validateVisualScene(scene));
    checked++;
    assert.ok(repaired.objects.length > 0, `${file} must produce objects`);
    assert.ok(repaired.beats.length > 0, `${file} must produce beats`);
    for (const beat of repaired.beats) {
      for (const action of beat.actions) {
        assert.ok(action.objectIds.length > 0 || action.relationIds.length > 0, `${file}: ${action.id} lost its target`);
      }
    }
  }
  assert.equal(checked, fixtures.length);
  assert.ok(checked >= 5, `expected the corpus to exercise several real outputs, saw ${checked}`);
});

test('a flat text archetype in the corpus is flattened to labels', () => {
  const file = fixtures.find(f => f.includes('numbered-steps'));
  assert.ok(file, 'the corpus must contain the numbered_steps capture');
  const {scene} = convert(file);
  assert.equal(scene.archetype, 'numbered_steps', 'the captured archetype must survive the heal');
  // The flattening is a composition repair, so assert it directly rather than
  // through the timeline, which can fail later on the unrelated anchor defect.
  const {scene: flattened} = applyCompositionFallbacks(validateVisualScene(scene));
  assert.ok(flattened.objects.every(o => o.primitiveRef === 'label'),
    'a flat text archetype must accept whatever the resolver produced');
});
