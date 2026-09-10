/** V3-6 benchmark: render V1 (clean style) vs V2 (sketch + domain templates) contact
 *  sheets for the shipped fixtures side by side, with the deterministic lints measured
 *  per scene. Writes SVG frames + a lint report under output/compare/ — the visual
 *  teaching-quality judgment happens on these artifacts, not in this script. */
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixtures} from '../src/fixtures.js';
import {compileScene,validatePlan,renderSVG} from '../src/engine.js';
import {progressionFrames,staticIntervalMs,connectorThroughNode} from '../src/progression.js';

const which=process.argv.includes('--v2')?'v2':'v1';
if(which==='v2')process.env.EXPLAIN_SKETCH='1';
const outRoot=join('output','compare',which);
const report:Array<Record<string,unknown>>=[];
for(const [name,fixture] of Object.entries(fixtures)){
  const plan=validatePlan({version:1,title:fixture.title,scenes:fixture.scenes});
  for(const raw of plan.scenes){
    const scene=compileScene(raw);
    const dir=join(outRoot,`${name}-${scene.id}`);
    await mkdir(dir,{recursive:true});
    const frames=progressionFrames(scene);
    for(let i=0;i<frames.length;i++)await writeFile(join(dir,`frame-${i}.svg`),frames[i].svg);
    const lints={staticIntervalMs:Math.round(staticIntervalMs(scene)),connectorHits:connectorThroughNode(scene).length};
    report.push({fixture:name,scene:scene.id,template:scene.template??null,variant:which,frames:frames.length,...lints});
  }
}
await mkdir(outRoot,{recursive:true});
await writeFile(join(outRoot,'lints.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({variant:which,dir:outRoot,scenes:report.length,over3500:report.filter(r=>(r.staticIntervalMs as number)>3500).length,withConnectorHits:report.filter(r=>(r.connectorHits as number)>0).length}));
