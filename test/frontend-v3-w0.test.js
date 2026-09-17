import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join,relative} from 'node:path';
import {visualPipeline} from '../dist/src/semantic/pipeline.js';
import {loadV3ModelRouter,PLAN_MODEL_DEFAULTS} from '../dist/src/shared/model-router.js';
import {sourceCacheKey,lessonCacheKey,sceneCacheKey,CACHE_VERSIONS} from '../dist/src/semantic/cache/keys.js';
import {createMemoryCache} from '../dist/src/semantic/cache/store.js';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');

test('W0 pipeline: semantic-v3 is selectable and never the default',()=>{
  assert.equal(visualPipeline({}),'semantic','the default is still V2');
  assert.equal(visualPipeline({VISUAL_PIPELINE:'semantic-v3'}),'semantic-v3');
  assert.equal(visualPipeline({VISUAL_PIPELINE:'v3'}),'semantic-v3');
  assert.equal(visualPipeline({VISUAL_PIPELINE:'v2'}),'semantic');
  assert.equal(visualPipeline({VISUAL_PIPELINE:'explainer'}),'explainer');
  assert.throws(()=>visualPipeline({VISUAL_PIPELINE:'manim'}),/VISUAL_PIPELINE/);
});

test('W0 routing: v3 stages default to the architecture plan models and stay overridable',()=>{
  const base=loadV3ModelRouter({});
  assert.equal(base.graphMap,PLAN_MODEL_DEFAULTS.graphMap);
  assert.equal(base.graphReduce,PLAN_MODEL_DEFAULTS.graphReduce);
  assert.equal(base.teacherPlanner,PLAN_MODEL_DEFAULTS.teacherPlanner);
  assert.equal(base.sceneWorker,PLAN_MODEL_DEFAULTS.sceneWorker);
  assert.equal(base.rescue,PLAN_MODEL_DEFAULTS.rescue);
  const overridden=loadV3ModelRouter({OPENROUTER_SCENE_WORKER_MODEL:'vendor/scene',OPENROUTER_V3_FALLBACKS:'vendor/a, vendor/b'});
  assert.equal(overridden.sceneWorker,'vendor/scene');
  assert.deepEqual(overridden.fallbacks,['vendor/a','vendor/b']);
  const json=loadV3ModelRouter({MODEL_ROUTER:JSON.stringify({teacherPlanner:'json/teacher'})});
  assert.equal(json.teacherPlanner,'json/teacher');
});

test('W0 cache keys are deterministic, version-sensitive and tier-distinct',()=>{
  const a=sourceCacheKey('src-abc');
  assert.equal(a,sourceCacheKey('src-abc'),'same inputs, same key');
  assert.notEqual(a,sourceCacheKey('src-def'));
  assert.notEqual(a,sourceCacheKey('src-abc',{...CACHE_VERSIONS,chunker:'chunker-v2'}),'bumping a version invalidates the key');
  assert.notEqual(lessonCacheKey({baseGraphHash:'g',userPromptHash:'p',targetDurationSec:60,audienceHash:'a',language:'en'}),sceneCacheKey({lessonGraphHash:'g',sceneContractHash:'s'}));
});

test('W0 cache store refuses to persist an unvalidated artifact',async()=>{
  const store=createMemoryCache();
  await store.put('k',{value:1},{validated:true,kind:'source'});
  assert.deepEqual(await store.get('k'),{value:1});
  await assert.rejects(store.put('k2',{value:2},{validated:false,kind:'source'}),/unvalidated/);
  assert.equal(await store.has('k2'),false);
});

test('W0 layering: pipelines never import across each other and shared never imports a pipeline',()=>{
  const files=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(dir,entry.name)):entry.name.endsWith('.ts')?[join(dir,entry.name)]:[]);
  const violations=[];
  for(const file of files(join(ROOT,'src'))){
    const rel=relative(ROOT,file);
    const text=readFileSync(file,'utf8');
    const imports=[...text.matchAll(/from\s+'([^']+)'/g)].map(m=>m[1]);
    if(rel.includes('/semantic/')&&imports.some(spec=>/^(\.\.\/)+explainer\//.test(spec)))violations.push(`${rel}: semantic imports explainer`);
    if(rel.includes('/explainer/')&&imports.some(spec=>/^(\.\.\/)+semantic\//.test(spec)))violations.push(`${rel}: explainer imports semantic`);
    if(rel.includes('/shared/')&&imports.some(spec=>/^(\.\.\/)+(semantic|explainer)\//.test(spec)))violations.push(`${rel}: shared imports a pipeline`);
  }
  assert.deepEqual(violations,[],`layering violated:\n${violations.join('\n')}`);
});
