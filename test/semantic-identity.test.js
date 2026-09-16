import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { directionToScene } from '../dist/src/semantic/identity/intent-adapter.js';
import { compileScene } from '../dist/src/semantic/compiler/compile-scene.js';
import {
  SemanticIdentityRegistry,
  normalizeSemanticKey,
  SemanticReferenceError,
  resolveObjects,
  resolveRelations,
  resolveBeats,
  canonicalToPlan,
  canonicalizeVisualScene,
} from '../dist/src/semantic/identity/index.js';

describe('semantic identity', () => {
  it('normalizes keys to snake_case', () => {
    assert.equal(normalizeSemanticKey('Carbon Dioxide'), 'carbon_dioxide');
    assert.equal(normalizeSemanticKey('latentRepresentation'), 'latent_representation');
  });

  it('registry allocates deterministic object ids', () => {
    const reg = new SemanticIdentityRegistry();
    reg.advanceScene();
    reg.registerConcepts([
      { id: 'water', canonicalName: 'Water', aliases: ['h2o'], semanticType: 'material' },
      { id: 'plant', canonicalName: 'Plant', aliases: [], semanticType: 'entity' },
    ]);
    reg.registerHeroConcept('plant');
    const id1 = reg.allocateObject('plant', 'hero');
    const id2 = reg.allocateObject('water', 'support');
    assert.equal(id1, 'concept_1_plant_1');
    assert.equal(id2, 'concept_1_water_1');
  });

  it('resolves semantic objects from concepts', () => {
    const reg = new SemanticIdentityRegistry();
    reg.advanceScene();
    reg.registerConcepts([{ id: 'plant', canonicalName: 'Plant', aliases: [], semanticType: 'entity' }]);
    const objects = resolveObjects(
      { registry: reg, sceneKey: 'scene_photosynthesis', allowedArchetypes: ['structural_diagram'] },
      [{ conceptKey: 'plant', label: 'Plant', role: 'hero' }],
    );
    assert.equal(objects.length, 1);
    assert.equal(objects[0].conceptId, 'plant');
    assert.ok(objects[0].id.startsWith('concept_1_plant_'));
    assert.equal(objects[0].collisionPolicy, 'forbid');
  });

  it('resolves relations by concept keys', () => {
    const reg = new SemanticIdentityRegistry();
    reg.advanceScene();
    reg.registerConcepts([
      { id: 'water', canonicalName: 'Water', aliases: [], semanticType: 'material' },
      { id: 'plant', canonicalName: 'Plant', aliases: [], semanticType: 'entity' },
    ]);
    const objects = resolveObjects(
      { registry: reg, sceneKey: 's', allowedArchetypes: ['structural_diagram'] },
      [
        { conceptKey: 'plant', label: 'Plant', role: 'hero' },
        { conceptKey: 'water', label: 'Water', role: 'support' },
      ],
    );
    const relations = resolveRelations(
      { registry: reg, sceneKey: 's', allowedArchetypes: ['structural_diagram'] },
      objects,
      [{ fromConcept: 'water', relation: 'flows_to', toConcept: 'plant', targetPart: 'roots' }],
    );
    assert.equal(relations.length, 1);
    assert.equal(relations[0].relationType, 'flows_to');
    assert.equal(objects.find(o => o.id === relations[0].to.objectId).conceptId, 'plant');
  });

  it('allocates objects for unknown concept keys instead of failing', () => {
    const reg = new SemanticIdentityRegistry();
    reg.advanceScene();
    reg.registerConcepts([{ id: 'plant', canonicalName: 'Plant', aliases: [], semanticType: 'entity' }]);
    const objects = resolveObjects(
      { registry: reg, sceneKey: 's', allowedArchetypes: ['structural_diagram'] },
      [{ conceptKey: 'unknown_label', label: '?', role: 'support' }],
    );
    assert.equal(objects.length, 1);
    assert.equal(objects[0].conceptId, 'unknown_label');
  });

  it('canonicalizes a model-generated visual scene to runtime IDs', () => {
    const scene = {
      version: 2,
      id: 'scene_photosynthesis',
      title: 'Inputs',
      teachingGoal: 'Explain inputs',
      mentalModel: 'Inputs enter a plant',
      archetype: 'structural_diagram',
      objects: [
        { id: 'obj_model_plant', conceptId: 'plant', label: 'Plant', role: 'hero', children: [], state: 'neutral', allowedStates: ['neutral', 'highlighted', 'activated'], importance: 'primary', preferredZone: 'center', collisionPolicy: 'forbid' },
        { id: 'obj_model_water', conceptId: 'water', label: 'Water', role: 'support', children: [], state: 'neutral', allowedStates: ['neutral', 'highlighted', 'activated'], importance: 'secondary', preferredZone: 'upper_left', collisionPolicy: 'forbid' },
      ],
      relations: [
        { id: 'rel_model_1', from: { objectId: 'obj_model_plant', anchor: 'roots' }, to: { objectId: 'obj_model_water', anchor: 'center' }, relationType: 'flows_to', visualForm: 'flow' },
      ],
      beats: [
        {
          id: 'beat_intro',
          narration: 'Water enters the plant.',
          actions: [
            { id: 'act_model_1', type: 'draw', objectIds: ['obj_model_plant'], relationIds: [], durationMs: 1000, leadMs: 0, easing: 'linear' },
            { id: 'act_model_2', type: 'flow', objectIds: [], relationIds: ['rel_model_1'], durationMs: 1000, leadMs: 0, easing: 'linear' },
          ],
        },
      ],
      continuity: { keepFromPrevious: [], prepareForNext: [] },
    };
    const canonical = canonicalizeVisualScene(scene.id, scene, [
      { id: 'plant', canonicalName: 'Plant', aliases: [], semanticType: 'entity' },
      { id: 'water', canonicalName: 'Water', aliases: [], semanticType: 'material' },
    ]);
    assert.equal(canonical.objects.length, 2);
    assert.ok(canonical.objects[0].id.startsWith('concept_1_plant_'));
    assert.ok(canonical.objects[1].id.startsWith('concept_1_water_'));
    assert.ok(canonical.relations[0].id.startsWith('rel_scene_photosynthesis_'));
    assert.equal(canonical.relations[0].from.objectId, canonical.objects[0].id);
    assert.equal(canonical.relations[0].to.objectId, canonical.objects[1].id);
    assert.equal(canonical.beats[0].id, 'beat_intro');
    assert.equal(canonical.beats[0].actions[1].relationIds[0], canonical.relations[0].id);
  });

  describe('directionToScene archetype-aware parenting (run1 replay)', () => {
    const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'replay', 'run1-flow-direction.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    it('drops containment parenting for flow archetype and compiles without overlap', () => {
      const scene = directionToScene(structuredClone(fixture.direction), fixture.semantic);
      assert.equal(scene.objects.length, 7);
      for (const o of scene.objects) assert.equal(o.parentId, undefined, `${o.id} must be a root in flow archetype`);
      const prepared = structuredClone(scene);
      for (const o of prepared.objects) {
        if (fixture.semantic.requiredConceptIds.includes(o.conceptId)) {
          o.importance = 'primary';
          if (!o.assetRef && !o.primitiveRef) o.primitiveRef = 'rectangle';
        }
      }
      for (const beat of prepared.beats) {
        const anchors = beat.actions.map((a) => a.anchor?.text).filter(Boolean);
        if (beat.narration === '[REDACTED]' && anchors.length) beat.narration = anchors.join(' and ');
      }
      const compiled = compileScene(prepared);
      assert.equal(compiled.objects.length, 7);
    });

    it('preserves containment parenting for structural_diagram archetype', () => {
      const direction = structuredClone(fixture.direction);
      direction.archetype = 'structural_diagram';
      const scene = directionToScene(direction, fixture.semantic);
      const withParent = scene.objects.filter((o) => o.parentId);
      assert.ok(withParent.length >= 5, `expected parented children, got ${withParent.length}`);
      for (const key of ['refrigerant', 'compressor', 'condenser', 'expansion-valve', 'evaporator', 'heat']) {
        const o = scene.objects.find((x) => x.conceptId === key);
        assert.equal(o.parentId, 'object_refrigerator');
      }
    });
  });
});
