import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixtures} from '../src/fixtures.js';
import {validatePlan,compileScene,renderSVG,durationOf} from '../src/engine.js';
const plan=validatePlan(fixtures.attention),scenes=plan.scenes.map(s=>compileScene(s));
for(let i=0;i<100;i++)renderSVG(scenes[i%scenes.length],i*100);
const samples=[],count=5000;let bytes=0;
for(let i=0;i<count;i++){const start=performance.now();bytes+=renderSVG(scenes[i%scenes.length],(i*97)%scenes[i%scenes.length].durationMs).length;samples.push(performance.now()-start);}
samples.sort((a,b)=>a-b);
const report={date:new Date().toISOString(),runtime:process.version,platform:process.platform,arch:process.arch,operation:'SVG string construction only; excludes rasterization, encoding, model and speech',frames:count,meanMs:samples.reduce((a,b)=>a+b,0)/count,p50Ms:samples[Math.floor(count*.5)],p95Ms:samples[Math.floor(count*.95)],svgBytesTotal:bytes,fixtureDurationMs:durationOf(scenes)};
await mkdir('output',{recursive:true});await writeFile('output/benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
