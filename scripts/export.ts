import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,readFile,rename,rm} from 'node:fs/promises';
import {cpus} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fixtures} from '../src/fixtures.js';
import {compileScene,validatePlan,renderSVG,locateScene,durationOf} from '../src/engine.js';
import {writeSceneArtifacts} from '../src/scene-output.js';

const argv=process.argv.slice(2);const option=(name:string,fallback:string|null)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1];};
const output=resolve(option('--out','output/attention.mp4')!);const input=option('--input',null);
const fps=Number(option('--fps','12'));const width=Number(option('--width','1280'));
if(!Number.isInteger(fps)||fps<1||fps>60||![640,960,1280,1920].includes(width))throw new Error('Use fps 1–60 and width 640, 960, 1280 or 1920');
let sharp;
try{sharp=(await import('sharp')).default;}catch{throw new Error('MP4 export requires optional sharp. Run npm install and install FFmpeg.');}
const source=input?JSON.parse(await readFile(resolve(input),'utf8')):fixtures[option('--fixture','attention')!];
if(!source)throw new Error('Unknown fixture');
if(input&&source.status&&!['complete','partial'].includes(source.status))throw new Error('Export requires a complete or partial job');
const plan=validatePlan({version:1,title:source.title,scenes:source.scenes});
const scenes=plan.scenes.map((s,i)=>{
  const timing=source.scenes[i].timing;
  if(timing){
    if(timing.words?.length!==s.narration.trim().split(/\s+/).length||!Number.isFinite(timing.durationMs)||timing.durationMs>180000)throw new Error('Invalid imported timing');
    let last=0;for(const w of timing.words){if(!Number.isFinite(w.startMs)||!Number.isFinite(w.endMs)||w.startMs<last||w.endMs<w.startMs||w.endMs>timing.durationMs)throw new Error('Invalid imported word time');last=w.startMs;}
  }
  return compileScene(s,timing);
});
// Every committed scene saved scene-by-scene in output/ (harness §§45/57/64;
// AGENTS.md #8: exports live in output/, job data stays in .data/).
const scenesDir=output.replace(/\.mp4$/,'')+'.scenes';
const artifacts=await writeSceneArtifacts(scenes,{title:plan.title,
  manifestVersion:typeof source.manifestVersion==='string'?source.manifestVersion:undefined,
  timingMode:typeof source.timingMode==='string'?source.timingMode:undefined},scenesDir);
await mkdir(dirname(output),{recursive:true});const temporary=output+'.rendering.mp4';
const encoder=spawn('ffmpeg',['-y','-v','error','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart',temporary],{stdio:['pipe','inherit','inherit']});
let encoderError;encoder.on('error',e=>{encoderError=e;});encoder.stdin.on('error',e=>{encoderError=e;});
const completion=new Promise<void>((res,rej)=>{encoder.on('error',rej);encoder.on('close',c=>c===0?res():rej(new Error(`FFmpeg exited ${c}`)));});completion.catch(()=>{});
const duration=durationOf(scenes),frames=Math.ceil(duration*fps/1000),started=performance.now();
// Phase 4: render frames in small parallel batches (sharp scales across cores) but
// ALWAYS write to ffmpeg stdin in frame order — out-of-order frames would corrupt
// the video. EXPORT_JOBS overrides the CPU-derived batch size for measurement.
const batchSize=Math.max(2,Math.min(8,Number(process.env.EXPORT_JOBS||cpus().length||4)));
const renderFrame=async(frame:number)=>{const found=locateScene(scenes,frame*1000/fps)!;return sharp(Buffer.from(renderSVG(found.scene,found.localMs))).resize(width,width*9/16).png().toBuffer();};
try{
  for(let start=0;start<frames;start+=batchSize){
    if(encoderError)throw encoderError;
    const batch:number[]=[];for(let f=start;f<Math.min(frames,start+batchSize);f++)batch.push(f);
    const pngs=await Promise.all(batch.map(renderFrame));
    for(const png of pngs){if(encoderError)throw encoderError;if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');}
  }
  encoder.stdin.end();await completion;
  const renderMs=Math.round(performance.now()-started);
  const hasAudio=source.scenes.some((s:{audioUrl?:string})=>s.audioUrl);
  let muxMs=0;
  if(hasAudio){
    if(!input||source.scenes.some((s:{audioUrl?:string})=>!s.audioUrl))throw new Error('All scenes require local audio. Export the original .data/JOB/job.json.');
    const audioArgs=[],filters=[];
    for(let i=0;i<scenes.length;i++){
      const audioPath=join(dirname(resolve(input)),`${scenes[i].id}.${source.scenes[i].audioUrl.endsWith('.wav')?'wav':'mp3'}`);await readFile(audioPath);audioArgs.push('-i',audioPath);
      filters.push(`[${i+1}:a]aresample=24000,apad,atrim=duration=${scenes[i].durationMs/1000},asetpts=PTS-STARTPTS[a${i}]`);
    }
    filters.push(scenes.map((_,i)=>`[a${i}]`).join('')+`concat=n=${scenes.length}:v=0:a=1[a]`);
    const mux=spawn('ffmpeg',['-y','-v','error','-i',temporary,...audioArgs,'-filter_complex',filters.join(';'),'-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-t',String(duration/1000),'-movflags','+faststart',output],{stdio:'inherit'});
    const muxStarted=performance.now();
    await new Promise<void>((res,rej)=>{mux.on('error',rej);mux.on('exit',c=>c===0?res():rej(new Error('Audio mux failed')));});await rm(temporary);
    muxMs=Math.round(performance.now()-muxStarted);
  }else await rename(temporary,output);
  console.log(JSON.stringify({output,frames,fps,width,durationMs:duration,renderMs,muxMs,exportJobs:batchSize,narrated:hasAudio,scenesDir:artifacts.dir,sceneFiles:artifacts.files},null,2));
}catch(error){encoder.kill();await rm(temporary,{force:true});throw error;}
