/** Manual capability gate: original scene data, pure renderer, silent estimated timing. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {compileScene} from '../src/v2/compiler/compile-scene.js';
import {renderSVG} from '../src/v2/renderer/render-svg.js';
import {staticIntervals} from '../src/v2/compiler/timeline.js';
import {occupancy} from '../src/v2/compiler/occupancy.js';
const out=process.argv[2]??'output/v2-plant';await mkdir(out,{recursive:true});
const json=await readFile('examples/v2/photosynthesis-plant.scene.json','utf8'),input=JSON.parse(json),start=performance.now(),scene=compileScene(input),compileMs=performance.now()-start;
const sharp=(await import('sharp')).default;
const eventTimes=[0,...scene.scene.beats.map(b=>Math.max(...scene.actions.filter(a=>a.beatId===b.id).map(a=>a.startMs+a.durationMs))),scene.durationMs];
const fixedTimes=[0,.25,.5,.75,1].map(p=>scene.durationMs*p);
for(const [family,times] of Object.entries({events:eventTimes,fixed:fixedTimes})){
 const tiles=[];for(const [i,t] of times.entries()){const svg=renderSVG(scene,t,{cursor:true});await writeFile(join(out,`${family}-${i}.svg`),svg);const png=await sharp(Buffer.from(svg)).resize(640,360).png().toBuffer();await writeFile(join(out,`${family}-${i}.png`),png);tiles.push({input:png,left:i%2*640,top:Math.floor(i/2)*360});}
 await sharp({create:{width:1280,height:Math.ceil(times.length/2)*360,channels:4,background:'#faf9f3'}}).composite(tiles).png().toFile(join(out,`${family}-contact-sheet.png`));
}
await sharp(Buffer.from(renderSVG(scene,scene.durationMs))).png().toFile(join(out,'final.png'));
const svgHash=createHash('sha256').update(renderSVG(scene,scene.durationMs)).digest('hex');
const renderStart=performance.now();let bytes=0;for(let i=0;i<100;i++)bytes+=renderSVG(scene,scene.durationMs*i/100).length;const render100Ms=performance.now()-renderStart;
const video=join(out,'photosynthesis-plant.mp4'),fps=12,encoder=spawn('ffmpeg',['-y','-v','error','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart',video],{stdio:['pipe','inherit','inherit']});
let failure:Error|undefined;encoder.on('error',e=>{failure=e;});encoder.stdin.on('error',e=>{failure=e;});
const completion=new Promise<void>((resolve,reject)=>{encoder.on('error',reject);encoder.on('close',code=>code===0?resolve():reject(new Error(`FFmpeg exit ${code}`)));});completion.catch(()=>{});
const exportStart=performance.now();try{for(let frame=0;frame<Math.ceil(scene.durationMs*fps/1000);frame++){if(failure)throw failure;const png=await sharp(Buffer.from(renderSVG(scene,frame*1000/fps,{cursor:true}))).resize(960,540).png().toBuffer();if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');}encoder.stdin.end();await completion;}catch(error){encoder.kill();throw error;}
const exportMs=performance.now()-exportStart;
const intervals=staticIntervals(scene.scene,scene.timing,scene.actions),longestStaticMs=Math.max(0,...intervals.map(i=>i.endMs-i.startMs));
const report={mode:'manual golden; silent estimated timing; no planner or TTS calls',sceneHash:createHash('sha256').update(json).digest('hex'),finalSvgHash:svgHash,compileMs,render100Ms,renderBytes:bytes,exportMs,costUsd:0,providerCalls:0,firstPlayableMs:null,longestStaticMs,occupancy:occupancy(scene.objects),diagnostics:scene.diagnostics,relations:scene.relations.map(r=>({id:r.id,from:r.from,to:r.to})),actionCount:scene.actions.length,sceneDurationMs:scene.durationMs,eventTimes,fixedTimes,releaseGate:'pending visual inspection, automatic plant, human pairwise and live timing'};
await writeFile(join(out,'scene.json'),json);await writeFile(join(out,'compiled.json'),JSON.stringify(scene,null,2));await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
