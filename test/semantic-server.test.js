import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
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
test('job library lists saved videos as metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-server-')),{server,store}=makeServer({dataRoot:root});
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base=`http://127.0.0.1:${server.address().port}`;
  const empty=await (await fetch(base+'/api/jobs')).json();assert.deepEqual(empty.jobs,[]);
  assert.equal(await (await fetch(base+'/api/semantic/jobs/00000000-0000-4000-8000-000000000000/export')).status,404);
 }finally{await store.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
test('semantic scene snapshots load through the versioned media route',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-server-')),{server,store}=makeServer({dataRoot:root});
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base=`http://127.0.0.1:${server.address().port}`;
  const id='11111111-1111-4111-8111-111111111111';await mkdir(join(root,'semantic',id),{recursive:true});
  await writeFile(join(root,'semantic',id,'scene-one.json'),JSON.stringify({version:2,id:'scene-one'}));
  const ok=await fetch(`${base}/media/semantic/${id}/scene-one.json`);assert.equal(ok.status,200);assert.match(ok.headers.get('content-type')||'',/application\/json/);assert.equal((await ok.json()).id,'scene-one');
  assert.equal((await fetch(`${base}/media/semantic/${id}/missing.json`)).status,404);
  const viewer=await (await fetch(base+'/semantic-viewer.js')).text();
  assert.ok(viewer.includes('/media/semantic/'));assert.ok(!viewer.includes('compile-from-job'));assert.ok(!viewer.includes('semantic-jobs/'));
 }finally{await store.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
test('every browser runtime shared import is served (no 404 drift)',async()=>{
 const root=await mkdtemp(join(tmpdir(),'semantic-server-')),{server,store}=makeServer({dataRoot:root});
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base=`http://127.0.0.1:${server.address().port}`;
  // Runtime imports in the compiled browser-served trees. Type-only imports are
  // erased by tsc, so anything matching here must load in the browser.
  const urls=new Set();
  async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory()){await walk(p);continue;}if(!p.endsWith('.js'))continue;
   const text=await readFile(p,'utf8');for(const m of text.matchAll(/from\s*["'](\.\.\/shared\/[a-z0-9-]+\.js)["']/g))urls.add('/src/shared/'+m[1].slice('../shared/'.length));}}
  for(const dir of ['dist/src/explainer','dist/src/shared','dist/public'])await walk(dir);
  assert.ok(urls.has('/src/shared/language.js'),'expected the language runtime import in the scan');
  for(const url of [...urls].sort())assert.equal((await fetch(base+url)).status,200,url);
 }finally{await store.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
