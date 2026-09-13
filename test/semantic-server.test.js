import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeServer} from '../dist/src/server.js';
import {visualPipeline} from '../dist/src/semantic/pipeline.js';
test('explainer is the default; semantic flag is accepted with aliases',()=>{assert.equal(visualPipeline({}),'explainer');assert.equal(visualPipeline({VISUAL_PIPELINE:'semantic'}),'semantic');assert.equal(visualPipeline({VISUAL_PIPELINE:'v2'}),'semantic');assert.equal(visualPipeline({VISUAL_PIPELINE:'classic'}),'explainer');assert.equal(visualPipeline({VISUAL_PIPELINE:'v1'}),'explainer');assert.throws(()=>visualPipeline({VISUAL_PIPELINE:'bogus'}));});
test('semantic preview serves the canonical browser renderer and validates compile requests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-server-')),old=process.env.VISUAL_PIPELINE;process.env.VISUAL_PIPELINE='semantic';const {server,store}=makeServer({dataRoot:root});if(old===undefined)delete process.env.VISUAL_PIPELINE;else process.env.VISUAL_PIPELINE=old;
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base=`http://127.0.0.1:${server.address().port}`;
  const html=await(await fetch(base)).text();assert.ok(html.includes('Semantic visual teaching lab'));
  const result=await fetch(base+'/api/semantic/golden'),scene=await result.json();assert.equal(result.status,200);assert.equal(scene.version,2);assert.equal(scene.objects.length,6);
  for(const path of ['/semantic-viewer.js','/src/semantic/renderer/render-svg.js','/src/semantic/assets/registry.js','/src/semantic/assets/illustrations/plant.js'])assert.equal((await fetch(base+path)).status,200);
  assert.equal((await fetch(base+'/api/config').then(r=>r.json())).visualPipeline,'semantic');
  assert.equal((await fetch(base+'/api/semantic/compile',{method:'POST',body:JSON.stringify(scene.scene)})).status,200);
  assert.equal((await fetch(base+'/api/semantic/compile',{method:'POST',body:JSON.stringify({...scene.scene,rawSVG:'<script/>'})})).status,400);
  assert.equal((await fetch(base+'/api/semantic/compile',{method:'POST',headers:{origin:'https://bad.test'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base+'/src/semantic/planning/model-adapter.js')).status,404);
 }finally{await store.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
