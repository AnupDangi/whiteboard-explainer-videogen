import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {compileScene} from '../src/v2/compiler/compile-scene.js';
import {writeV2Artifacts} from '../src/v2/artifacts.js';
const out=process.argv[2]??'output/v2-archetypes';await mkdir(out);const report=[];
for(const file of (await readdir('eval/v2/cases')).filter(f=>f.endsWith('.json')).sort()){
 const c=JSON.parse(await readFile(join('eval/v2/cases',file),'utf8')),raw=JSON.parse(await readFile(c.sceneFile,'utf8')),start=performance.now();
 try{const scene=compileScene(raw),compileMs=performance.now()-start;const manifest=await writeV2Artifacts(scene,join(out,c.id),{video:true});report.push({case:c.id,archetype:scene.scene.archetype,compileMs,diagnostics:scene.diagnostics,...manifest});}catch(e){report.push({case:c.id,error:e instanceof Error?e.message:String(e)});}
}
await writeFile(join(out,'report.json'),JSON.stringify({mode:'manual archetype fixtures; estimated silent timing; no model calls',cases:report},null,2));console.log(JSON.stringify(report.map(r=>({case:r.case,error:'error' in r?r.error:null}))));if(report.some(r=>'error' in r))process.exitCode=1;
