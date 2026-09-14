import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateV2 } from '../dist/src/semantic/planning/generate.js';
import { wordsFromDuration } from '../dist/src/shared/voice-engine-client.js';
import { compileScene } from '../dist/src/semantic/compiler/compile-scene.js';

const sceneJson = () => {
  const s = JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json', 'utf8'));
  for (const o of s.objects) if (['plant', 'sunlight', 'water', 'carbon_dioxide'].includes(o.id)) o.conceptId = o.id;
  return s;
};
const teaching = () => JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json', 'utf8'));

test('concept continuity persists geometry across scenes', async () => {
  const plan = teaching();
  const second = structuredClone(plan.scenes[0]);
  second.id = 'plant_again';
  second.continuity.keepFromPrevious = ['plant'];
  plan.scenes.push(second);
  const model = {
    calls: [],
    async generate(stage, _instructions, input, _schema, validate) {
      this.calls.push({ stage });
      if (stage === 'teaching') return validate(plan);
      const s = sceneJson();
      s.id = input.semanticScene.id;
      return validate({ scene: s, decisions: { centralTeachingObject: 'plant', firstFocus: 'plant', illustratedConcepts: 'plant and inputs', labelsOnly: 'root and leaf labels', movingRelations: 'input flows', persistentContext: 'plant', stateChanges: 'activation', omit: 'detailed chemistry' } });
    },
  };
  const seen = [];
  for await (const result of generateV2({ prompt: 'Teach plant inputs', allowedArchetypes: ['structural_diagram', 'convergence'], maxScenes: 2 }, model, {})) seen.push(result);
  assert.equal(seen.length, 2);
  const [first, next] = seen.map(r => r.compiled);
  assert.ok(next.scene.continuity.keepFromPrevious.length > 0);
  const plantBefore = first.objects.find(o => o.conceptId === 'plant');
  const plantAfter = next.objects.find(o => o.conceptId === 'plant');
  assert.ok(plantBefore && plantAfter);
  assert.equal(plantAfter.x, plantBefore.x);
  assert.equal(plantAfter.y, plantBefore.y);
  assert.equal(plantAfter.assetRef, plantBefore.assetRef);
});

test('kept concepts survive state transitions with reused geometry', () => {
  const first = compileScene(sceneJson());
  const before = first.objects.find(o => o.conceptId === 'plant');
  const raw = sceneJson();
  raw.continuity.keepFromPrevious = [before.id];
  raw.objects.find(o => o.conceptId === 'plant').state = 'activated';
  const next = compileScene(raw, undefined, first);
  const after = next.objects.find(o => o.conceptId === 'plant');
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
  assert.equal(after.assetRef, before.assetRef);
  const changed = sceneJson();
  changed.continuity.keepFromPrevious = [before.id];
  changed.objects.find(o => o.conceptId === 'plant').assetRef = 'systems.server.v2';
  assert.throws(() => compileScene(changed, undefined, first), /Persistent identity changed/);
});

test('continuity decisions are explicit and validated', () => {
  const raw = sceneJson();
  raw.continuity.transitions = [{conceptId:'plant', action:'TRANSFORM', fromState:'neutral', toState:'activated'}];
  assert.doesNotThrow(() => compileScene(raw));
  const bad = structuredClone(raw);
  bad.continuity.transitions[0].toState = 'neutral';
  assert.throws(() => compileScene(bad), /distinct states/);
});

test('visual compile lands before slow TTS; final timeline uses speech timing', async () => {
  const plan = teaching();
  plan.scenes.length = 1;
  const model = {
    calls: [],
    async generate(stage, _instructions, input, _schema, validate) {
      this.calls.push({ stage });
      if (stage === 'teaching') return validate(plan);
      const s = sceneJson();
      s.id = input.semanticScene.id;
      return validate({ scene: s, decisions: { centralTeachingObject: 'plant', firstFocus: 'plant', illustratedConcepts: 'plant and inputs', labelsOnly: 'root and leaf labels', movingRelations: 'input flows', persistentContext: 'plant', stateChanges: 'activation', omit: 'detailed chemistry' } });
    },
  };
  const events = [];
  const speech = async text => {
    await new Promise(r => setTimeout(r, 150));
    return { timing: wordsFromDuration(text, 2000), audio: Buffer.from('wav-audio'), format: 'wav' };
  };
  let compiled;
  for await (const result of generateV2({ prompt: 'Teach plant inputs', allowedArchetypes: ['structural_diagram', 'convergence'] }, model, { speech, onTelemetry: e => events.push(e) })) compiled = result.compiled;
  assert.equal(compiled.timing.kind, 'engine');
  const visualAt = events.find(e => e.stage === 'compile' && e.status === 'success').atMs;
  const audioAt = events.find(e => e.stage === 'tts' && e.status === 'success').atMs;
  assert.ok(visualAt < audioAt, `visual ${visualAt} should precede audio ${audioAt}`);
});
