import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileScene } from '../dist/src/semantic/compiler/compile-scene.js';
import { applyCompositionFallbacks } from '../dist/src/semantic/compiler/fallback.js';
import { fitLabel } from '../dist/src/semantic/compiler/text.js';
import { resolveRepresentation, resolveRepresentationRequest } from '../dist/src/semantic/identity/representation.js';
import { computeRunMetrics } from '../dist/eval/live/metrics.js';

const golden = () => JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json', 'utf8'));

const obj = (id, extra = {}) => {
  const o = {
    id,
    label: id,
    role: 'support',
    children: [],
    state: 'neutral',
    allowedStates: ['neutral', 'highlighted', 'activated'],
    importance: 'secondary',
    collisionPolicy: 'allow',
    primitiveRef: 'label',
    ...extra,
  };
  if (extra.assetRef) delete o.primitiveRef;
  return o;
};

const beat = (id, objectIds, relationIds = []) => ({
  id,
  narration: `Beat ${id} teaches the concept clearly and slowly.`,
  actions: [
    { id: `act_${id}_o`, type: 'reveal', objectIds, relationIds: [], durationMs: 800, leadMs: 0, easing: 'linear' },
    ...(relationIds.length
      ? [{ id: `act_${id}_r`, type: 'trace', objectIds: [], relationIds, durationMs: 900, leadMs: -180, easing: 'linear' }]
      : []),
  ],
});

const scene = (archetype, objects, relations = []) => ({
  version: 2,
  id: 'scene_test',
  title: 'Test scene',
  teachingGoal: 'Teach the concept.',
  mentalModel: 'A model.',
  archetype,
  objects,
  relations,
  beats: [beat('b1', objects.map(o => o.id), relations.map(r => r.id))],
  continuity: { keepFromPrevious: [], prepareForNext: [] },
});

const rel = (id, from, to, relationType = 'flows_to') => ({
  id,
  from: { objectId: from, anchor: 'output' },
  to: { objectId: to, anchor: 'input' },
  relationType,
  visualForm: 'flow',
});

test('resolver keeps strict curated candidates without fallback', () => {
  const d = resolveRepresentation(
    { id: 'plant', canonicalName: 'Plant', aliases: ['sapling'], semanticType: 'entity' },
    ['structural_diagram'],
  );
  assert.equal(d.fallback, null);
  assert.ok(d.candidates.some(c => c.id === 'biology.plant.sapling.v2'));
  assert.deepEqual(d.warnings, []);
});

test('resolver finds a dna asset for dna_molecule without throwing', () => {
  const d = resolveRepresentation(
    { id: 'dna_molecule', canonicalName: 'DNA molecule', aliases: [], semanticType: 'entity' },
    ['spatial_process', 'transformation'],
  );
  assert.ok(d.candidates.length > 0);
  assert.ok(d.candidates.every(c => c.id.includes('dna')));
});

test('resolver substring-matches double_helix to the helix asset', () => {
  const d = resolveRepresentation(
    { id: 'double_helix', canonicalName: 'Double helix', aliases: [], semanticType: 'entity' },
    ['spatial_process', 'transformation'],
  );
  assert.equal(d.fallback, 'asset');
  assert.equal(d.fallbackAssetId, 'biology.dna.helix.v2');
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /representation fallback/);
});

test('resolver degrades unknown concepts to a labeled primitive', () => {
  const d = resolveRepresentation(
    { id: 'web_browser', canonicalName: 'Web browser', aliases: [], semanticType: 'entity' },
    ['flow'],
  );
  assert.equal(d.fallback, 'primitive-label');
  assert.deepEqual(d.candidates, []);
  assert.match(d.warnings[0], /no curated asset for web_browser/);
});

test('flow cycle keeps flow composition with a direct return arc', () => {
  const s = scene(
    'flow',
    [obj('a'), obj('b'), obj('c')],
    [rel('r1', 'a', 'b'), rel('r2', 'b', 'c'), rel('r3', 'c', 'a')],
  );
  const { scene: out, warnings } = applyCompositionFallbacks(s);
  assert.equal(out.archetype, 'flow');
  assert.equal(out.relations.length, 3);
  const demoted = out.relations.filter(r => r.layoutFeedback);
  assert.equal(demoted.length, 1);
  assert.match(warnings[0], /contains a cycle/);
  const compiled = compileScene(s);
  assert.equal(compiled.scene.archetype, 'flow');
  assert.ok(compiled.diagnostics.some(d => d.includes('representation fallback')));
});

test('comparison with five primaries demotes the fifth to annotation', () => {
  const s = scene('comparison', [obj('a'), obj('b'), obj('c'), obj('d'), obj('e')]);
  const { scene: out, warnings } = applyCompositionFallbacks(s);
  const primaries = out.objects.filter(o => !o.parentId && o.role !== 'annotation');
  assert.equal(primaries.length, 4);
  assert.equal(out.objects.find(o => o.id === 'e').role, 'annotation');
  assert.match(warnings[0], /demoted/);
  const compiled = compileScene(s);
  assert.equal(compiled.scene.objects.filter(o => !o.parentId && o.role !== 'annotation').length, 4);
});

test('matrix scene without an operator token gets an injected equals token', () => {
  const s = scene('matrix_operation', [
    obj('m1', { assetRef: 'math.matrix.v2' }),
    obj('m2', { assetRef: 'math.vector.v2' }),
    obj('m3', { assetRef: 'math.vector.v2' }),
  ]);
  const compiled = compileScene(s);
  const injected = compiled.scene.objects.find(o => o.id === 'eq_fallback_scene_test');
  assert.ok(injected);
  assert.equal(injected.primitiveRef, 'equation');
  assert.ok(compiled.diagnostics.some(d => d.includes('injected "=" equation token')));
});

test('non-matrix scene forced into matrix_operation still fails closed', () => {
  assert.throws(() => compileScene({ ...golden(), archetype: 'matrix_operation' }), /operator/);
});

test('long label tokens fit instead of failing the scene', () => {
  const s = scene('flow', [obj('a', { label: 'Row-Column CombinationEntry' }), obj('b', { label: 'Result value' })], [rel('r1', 'a', 'b')]);
  const compiled = compileScene(s);
  assert.ok(compiled.diagnostics.some(d => d.includes('representation fallback: label')));
  const fitted = fitLabel('Row-Column CombinationEntry', 130, 20);
  assert.ok(fitted.fitted || fitted.truncated);
});

test('stripped asset anchors degrade to center on surviving relations', () => {
  const s = scene('spatial_process', [
    obj('dna', { assetRef: 'biology.dna.fork.v2', role: 'hero' }),
    obj('strand', { assetRef: 'biology.dna.helix.v2' }),
  ]);
  s.relations = [{ id: 'r_unwind', from: { objectId: 'strand', anchor: 'center' }, to: { objectId: 'dna', anchor: 'fork' }, relationType: 'transforms_to', visualForm: 'arrow' }];
  s.beats = [beat('b1', ['dna', 'strand'], ['r_unwind'])];
  const compiled = compileScene(s);
  const unwound = compiled.scene.relations.find(r => r.id === 'r_unwind');
  assert.equal(unwound.to.anchor, 'center');
  assert.ok(compiled.diagnostics.some(d => d.includes('degraded to center')));
});

test('unroutable connector degrades to a direct line instead of failing', () => {
  const s = scene('flow', [obj('a'), obj('b')], [
    { id: 'r_bad', from: { objectId: 'a', anchor: 'nonexistent' }, to: { objectId: 'b', anchor: 'also_missing' }, relationType: 'flows_to', visualForm: 'flow' },
  ]);
  s.beats = [beat('b1', ['a', 'b'], ['r_bad'])];
  const compiled = compileScene(s);
  assert.equal(compiled.relations.find(r => r.id === 'r_bad').points.length, 2);
  assert.ok(compiled.diagnostics.some(d => d.includes('no safe connector route for r_bad')));
});

test('incompatible asset under final archetype converts to label', () => {
  const s = scene('spatial_process', [
    obj('dna', { assetRef: 'biology.dna.fork.v2', role: 'hero' }),
    obj('strand', { assetRef: 'biology.dna.helix.v2' }),
  ]);
  const compiled = compileScene(s);
  const dna = compiled.scene.objects.find(o => o.id === 'dna');
  assert.equal(dna.assetRef, undefined);
  assert.equal(dna.primitiveRef, 'label');
  assert.ok(compiled.diagnostics.some(d => d.includes('does not support spatial_process')));
});

test('spatial scene without a hero promotes one deterministically', () => {
  const s = scene('spatial_process', [obj('a'), obj('b')]);
  const compiled = compileScene(s);
  assert.equal(compiled.scene.objects.filter(o => o.role === 'hero').length, 1);
  assert.ok(compiled.diagnostics.some(d => d.includes('promoted')));
});

test('metrics count representation fallbacks from diagnostics and telemetry', () => {
  const telemetry = [
    { stage: 'teaching', status: 'success', elapsedMs: 10 },
    { stage: 'visual-model', status: 'success', elapsedMs: 5 },
    { stage: 'representation', status: 'success', elapsedMs: 1, details: { warnings: ['w1'], fallbackCount: 1 } },
    { stage: 'director', status: 'success', elapsedMs: 20 },
    { stage: 'compile', status: 'success', elapsedMs: 3 },
  ];
  const scenes = [{
    sceneId: 's1',
    stageMetrics: {},
    diagnostics: ['representation fallback: contains a cycle; using structural_diagram composition'],
    compileFindings: [],
    objects: [],
    relations: [],
    timingKind: 'estimated',
    durationMs: 1000,
    archetype: 'structural_diagram',
  }];
  const m = computeRunMetrics(telemetry, [], [], scenes, 'complete');
  assert.equal(m.representationResolutionSuccess, true);
  assert.equal(m.representationFallbackCount, 2);
});

test('typed representation requests select feasible assets and expose provenance', () => {
  const resolved = resolveRepresentationRequest({
    conceptKey: 'plant', semanticType: 'entity', role: 'hero', mentalModel: 'plant receives inputs',
    archetype: 'structural_diagram', requiredAnchors: ['roots', 'leaf.top'], requiredStates: ['highlighted'], styleFamily: 'chalk-ink-v2'
  });
  assert.equal(resolved.selected?.source, 'asset');
  assert.equal(resolved.selected?.ref, 'biology.plant.sapling.v2');
  assert.ok(resolved.selected?.anchors.includes('roots'));
  assert.ok(resolved.selected?.states.includes('highlighted'));
});

test('typed representation requests use safe synthesis before semantic abstraction', () => {
  const resolved = resolveRepresentationRequest({
    conceptKey: 'unseen_process', semanticType: 'process', role: 'support', mentalModel: 'unknown',
    archetype: 'structural_diagram', requiredAnchors: ['missing_part'], styleFamily: 'chalk-ink-v2'
  });
  assert.equal(resolved.selected?.source, 'composition');
  assert.match(resolved.selected?.ref, /^composition:/);
  assert.match(resolved.warnings.join(' '), /representation fallback/);
});
