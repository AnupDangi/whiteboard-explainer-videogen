import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtures} from '../dist/src/explainer/fixtures.js';
import {validatePlan,compileScene,renderSVG} from '../dist/src/explainer/engine.js';
import {writeSceneArtifacts} from '../dist/src/explainer/scene-output.js';

test('scene artifacts: every scene saved scene-by-scene with manifest',async t=>{
  const root=await mkdtemp(join(tmpdir(),'canvas-scenes-'));
  t.after(async()=>{await rm(root,{recursive:true,force:true});});
  const plan=validatePlan({version:1,title:fixtures.attention.title,scenes:fixtures.attention.scenes});
  const scenes=plan.scenes.map(s=>compileScene(s));
  const outDir=join(root,'attention.scenes');
  const first=await writeSceneArtifacts(scenes,{title:plan.title,manifestVersion:'v1-test',timingMode:'estimated'},outDir);
  assert.equal(first.files.length,scenes.length+1);
  assert.equal(first.files.at(-1),'manifest.json');
  const onDisk=(await readdir(outDir)).sort();
  assert.deepEqual(onDisk,[...first.files].sort());
  for(let i=0;i<scenes.length;i++){
    const svg=await readFile(join(outDir,first.files[i]),'utf8');
    assert.equal(svg,renderSVG(scenes[i],scenes[i].durationMs));
  }
  const manifest=JSON.parse(await readFile(join(outDir,'manifest.json'),'utf8'));
  assert.equal(manifest.title,plan.title);
  assert.equal(manifest.manifestVersion,'v1-test');
  assert.equal(manifest.timingMode,'estimated');
  assert.equal(manifest.sceneCount,scenes.length);
  assert.deepEqual(manifest.scenes.map(s=>s.id),scenes.map(s=>s.id));
  assert.deepEqual(manifest.scenes.map(s=>s.durationMs),scenes.map(s=>s.durationMs));
  // Deterministic: rewriting same scenes yields identical bytes.
  const second=await writeSceneArtifacts(scenes,{title:plan.title,manifestVersion:'v1-test',timingMode:'estimated'},join(root,'rerun.scenes'));
  for(const f of second.files){
    assert.equal(await readFile(join(root,'rerun.scenes',f),'utf8'),await readFile(join(outDir,f),'utf8'));
  }
});
