import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadModelRouter,taskOfLabel} from '../dist/src/model-router.js';

test('Model router: precedence MODEL_ROUTER JSON > per-task env > base',()=>{
  const base='base/model';
  const env1={OPENROUTER_OUTLINE_MODEL:'env-outline',OPENROUTER_CONTENT_MODEL:'env-content'};
  const r1=loadModelRouter(env1,base);
  assert.equal(r1.outline,'env-outline');
  assert.equal(r1.content,'env-content');
  assert.equal(r1.director,base,'unset tasks fall back to the base model');

  const env2={...env1,MODEL_ROUTER:JSON.stringify({outline:'json-outline',director:'json-director'})};
  const r2=loadModelRouter(env2,base);
  assert.equal(r2.outline,'json-outline','JSON config beats per-task env');
  assert.equal(r2.content,'env-content','tasks absent from JSON keep their env value');
  assert.equal(r2.director,'json-director');
});

test('Model router: malformed JSON is ignored, falls back to env/base',()=>{
  const r=loadModelRouter({MODEL_ROUTER:'{not json',OPENROUTER_CONTENT_MODEL:'env-content'},'base');
  assert.equal(r.content,'env-content');
  assert.equal(r.outline,'base');
});

test('Model router: ledger labels map to tasks',()=>{
  assert.equal(taskOfLabel('outline'),'outline');
  assert.equal(taskOfLabel('content-repair'),'content');
  assert.equal(taskOfLabel('director-repair'),'director');
  assert.equal(taskOfLabel('critic'),'critic');
  assert.equal(taskOfLabel('figure'),'vision');
});
