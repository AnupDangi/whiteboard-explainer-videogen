import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_EXEMPLARS, EXAMPLE_BANK_VERSION } from '../planner/exemplars.js';
import { TEMPLATE_SLOTS } from '../planner/prompt.js';
import { loadStreamlineCatalog } from '../catalog/streamline.js';
import { resolveObject } from '../catalog/ladder.js';

const TOPIC_WORDS = /\b(attention|query|keys?|request|zero[- ]trust|gradient|induction|photosynthe\w*|leaf|immune|catalyst|inflation|bill|law|tides?|ocean|moon|bicycle|bike|compost\w*|rainbow|prism|mirror)\b/i;

test('bank v4 covers every template', () => {
  assert.equal(EXAMPLE_BANK_VERSION, 'mechanism-bank/v4');
  const covered = new Set(SCENE_EXEMPLARS.map((e) => e.sceneSpec.template));
  for (const template of Object.keys(TEMPLATE_SLOTS)) assert.ok(covered.has(template as never), `missing template ${template}`);
});

test('bank v4 contains icon, plot, and formula demonstrations', () => {
  const prims = new Set(SCENE_EXEMPLARS.flatMap((e) => e.sceneSpec.elements.map((el) => el.prim)));
  for (const prim of ['object', 'plot', 'formula', 'meter', 'tokenStrip', 'operator']) assert.ok(prims.has(prim as never), prim);
});

test('every object exemplar concept is an exact name in the catalog the v1 bank was authored against (Streamline) and resolves at rung 2 there', () => {
  const streamline = loadStreamlineCatalog().entries;
  const names = new Set(streamline.flatMap((e) => e.names.map((n) => n.toLowerCase())));
  for (const exemplar of SCENE_EXEMPLARS) for (const el of exemplar.sceneSpec.elements) {
    if (el.prim !== 'object') continue;
    assert.ok(names.has(el.concept.toLowerCase()), `${exemplar.id}: ${el.concept}`);
    assert.equal(resolveObject(el.concept, { size: { w: 200, h: 260 } }, streamline).resolution.rung, 2, `${exemplar.id}: ${el.concept}`);
  }
});

test('bank v4 text is disjoint from golden and calibration topics', () => {
  for (const exemplar of SCENE_EXEMPLARS) assert.doesNotMatch(JSON.stringify(exemplar.sceneSpec) + exemplar.inputIntent.learningDelta, TOPIC_WORDS, exemplar.id);
});

test('no bank v4 entry is promoted', () => {
  for (const exemplar of SCENE_EXEMPLARS) {
    assert.equal(exemplar.reviewStatus, 'experimental', exemplar.id);
    assert.ok(Object.values(exemplar.review).every((v) => v === 'pending' || v === undefined), exemplar.id);
  }
});
