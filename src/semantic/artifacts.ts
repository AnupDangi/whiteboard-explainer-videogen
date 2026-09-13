import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import type {CompiledSceneV2} from './types.js';
import {renderSVG} from './renderer/render-svg.js';
import {lintCompiledScene} from './evaluation.js';
/** Immutable per-scene review artifacts, rendered through the exact browser renderer. */
export async function writeV2Artifacts(scene:CompiledSceneV2,out:string,options:{video?:boolean;audio?:{data:Buffer;format:'wav'|'mp3'};signal?:AbortSignal}={}){
 const findings=lintCompiledScene(scene);if(findings.some(f=>f.severity==='hard'))throw new Error('Cannot export a scene that fails deterministic preflight');
 await mkdir(out);const sharp=(await import('sharp')).default;
 const eventTimes=[0,...scene.scene.beats.map(b=>Math.max(...scene.actions.filter(a=>a.beatId===b.id).map(a=>a.startMs+a.durationMs))),scene.durationMs],fixedTimes=[0,.25,.5,.75,1].map(p=>p*scene.durationMs);
 for(const [family,times] of Object.entries({events:eventTimes,fixed:fixedTimes})){
  const tiles=[];for(const [i,time] of times.entries()){options.signal?.throwIfAborted();const svg=renderSVG(scene,time,{cursor:true});await writeFile(join(out,`${family}-${i}.svg`),svg);const png=await sharp(Buffer.from(svg)).resize(640,360).png().toBuffer();await writeFile(join(out,`${family}-${i}.png`),png);tiles.push({input:png,left:i%2*640,top:Math.floor(i/2)*360});}
  await sharp({create:{width:1280,height:Math.ceil(times.length/2)*360,channels:4,background:'#faf9f3'}}).composite(tiles).png().toFile(join(out,`${family}-contact-sheet.png`));
 }
 const final=renderSVG(scene,scene.durationMs);await writeFile(join(out,'final.svg'),final);await sharp(Buffer.from(final)).png().toFile(join(out,'final.png'));
 await writeFile(join(out,'scene.json'),JSON.stringify(scene.scene,null,2));await writeFile(join(out,'compiled.json'),JSON.stringify(scene,null,2));
 const started=performance.now();if(options.video){const fps=12,encoder=spawn('ffmpeg',['-y','-v','error','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart',join(out,'silent.mp4')],{stdio:['pipe','inherit','inherit'],signal:options.signal});let failure:Error|undefined;encoder.on('error',e=>{failure=e;});encoder.stdin.on('error',e=>{failure=e;});const completion=new Promise<void>((resolve,reject)=>{encoder.on('error',reject);encoder.on('close',code=>code===0?resolve():reject(new Error(`FFmpeg exit ${code}`)));});completion.catch(()=>{});
  try{for(let frame=0;frame<Math.ceil(scene.durationMs*fps/1000);frame++){options.signal?.throwIfAborted();if(failure)throw failure;const png=await sharp(Buffer.from(renderSVG(scene,frame*1000/fps,{cursor:true}))).resize(960,540).png().toBuffer();if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');}encoder.stdin.end();await completion;}catch(e){encoder.kill();throw e;}
  if(options.audio){const audioPath=join(out,`speech.${options.audio.format}`);await writeFile(audioPath,options.audio.data);const mux=spawn('ffmpeg',['-y','-v','error','-i',join(out,'silent.mp4'),'-i',audioPath,'-map','0:v','-map','1:a','-af','apad','-t',String(scene.durationMs/1000),'-c:v','copy','-c:a','aac','-movflags','+faststart',join(out,'narrated.mp4')],{stdio:'inherit',signal:options.signal});await new Promise<void>((resolve,reject)=>{mux.on('error',reject);mux.on('close',code=>code===0?resolve():reject(new Error(`Audio mux exited ${code}`)));});}
 }
 const manifest={version:2,sceneHash:createHash('sha256').update(JSON.stringify(scene.scene)).digest('hex'),finalSvgHash:createHash('sha256').update(final).digest('hex'),timingKind:scene.timing.kind,audio:Boolean(options.audio),durationMs:scene.durationMs,eventTimes,fixedTimes,findings,exportMs:performance.now()-started};await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));return manifest;
}
