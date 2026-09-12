import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeServer} from '../dist/src/server.js';
import {visualPipeline} from '../dist/src/v2/pipeline.js';
test('V2 flag preserves V1 default and rejects invalid configuration',()=>{assert.equal(visualPipeline({}),'v1');assert.equal(visualPipeline({VISUAL_PIPELINE:'v2'}),'v2');assert.throws(()=>visualPipeline({VISUAL_PIPELINE:'bogus'}));});
test('V2 preview serves the canonical browser renderer and validates compile requests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'v2-server-')),old=process.env.VISUAL_PIPELINE;process.env.VISUAL_PIPELINE='v2';const {server,store}=makeServer({dataRoot:root});if(old===undefined)delete process.env.VISUAL_PIPELINE;else process.env.VISUAL_PIPELINE=old;
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base=`http://127.0.0.1:${server.address().port}`;
  const html=await(await fetch(base)).text();assert.ok(html.includes('V2 visual teaching lab'));
  const result=await fetch(base+'/api/v2/golden'),scene=await result.json();assert.equal(result.status,200);assert.equal(scene.version,2);assert.equal(scene.objects.length,6);
  for(const path of ['/v2-viewer.js','/src/v2/renderer/render-svg.js','/src/v2/assets/registry.js','/src/v2/assets/illustrations/plant.js'])assert.equal((await fetch(base+path)).status,200);
  assert.equal((await fetch(base+'/api/config').then(r=>r.json())).visualPipeline,'v2');
  assert.equal((await fetch(base+'/api/v2/compile',{method:'POST',body:JSON.stringify(scene.scene)})).status,200);
  assert.equal((await fetch(base+'/api/v2/compile',{method:'POST',body:JSON.stringify({...scene.scene,rawSVG:'<script/>'})})).status,400);
  assert.equal((await fetch(base+'/api/v2/compile',{method:'POST',headers:{origin:'https://bad.test'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base+'/src/v2/planning/model-adapter.js')).status,404);
 }finally{await store.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
