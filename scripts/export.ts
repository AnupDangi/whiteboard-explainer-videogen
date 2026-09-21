import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {cpus} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {compileScene,validatePlan,renderSVG,locateScene,durationOf} from '../src/generation/engine.js';
import {writeSceneArtifacts} from '../src/generation/scene-output.js';
import {segmentWords} from '../src/core/language.js';
import {auditLessonRelease} from '../src/generation/release-audit.js';

const argv=process.argv.slice(2);const option=(name:string,fallback:string|null)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1];};
const output=resolve(option('--out','output/attention.mp4')!);const input=option('--input',null);
const fps=Number(option('--fps','12'));const width=Number(option('--width','1280'));
const clipsDirArg=option('--clips-dir',null);
if(!Number.isInteger(fps)||fps<1||fps>60||![640,960,1280,1920].includes(width))throw new Error('Use fps 1–60 and width 640, 960, 1280 or 1920');
let sharp;
try{sharp=(await import('sharp')).default;}catch{throw new Error('MP4 export requires optional sharp. Run npm install and install FFmpeg.');}
if(!input)throw new Error('MP4 export requires --input <job.json>');
const source=JSON.parse(await readFile(resolve(input),'utf8'));
if(input&&source.status&&source.status!=='complete')throw new Error('Export requires a complete job');
const captionMode: 'off'|'sidecar'|'burn-in'=source.captionMode==='sidecar'||source.captionMode==='burn-in'?source.captionMode:(source.request?.stylePreferences?.captionMode==='sidecar'||source.request?.stylePreferences?.captionMode==='burn-in'?source.request.stylePreferences.captionMode:'off');
const plan=validatePlan({version:1,title:source.title,scenes:source.scenes});
const scenes=plan.scenes.map((s,i)=>{
  const timing=source.scenes[i].timing;
  if(timing){
    if(timing.words?.length!==segmentWords(s.narration).length||!Number.isFinite(timing.durationMs)||timing.durationMs>180000)throw new Error('Invalid imported timing');
    let last=0;for(const w of timing.words){if(!Number.isFinite(w.startMs)||!Number.isFinite(w.endMs)||w.startMs<last||w.endMs<w.startMs||w.endMs>timing.durationMs)throw new Error('Invalid imported word time');last=w.startMs;}
  }
  return compileScene(s,timing);
});
// Generated jobs carry the immutable lesson request. Re-check its intent at the
// exporter boundary too, so a caller cannot bypass the CLI preflight by exporting
// a saved job directly. Legacy fixtures have no request and remain replayable.
if(input&&source.request){
  const releaseAudit=auditLessonRelease({
    title:source.title??'',
    instruction:source.request.instruction,
    narration:source.scenes[0]?.narration??'',
    scenes:source.scenes.map((scene:{narration:string;nodes?:Array<{label?:string;shape?:string}>;timing?:{durationMs:number}})=>({narration:scene.narration,nodes:scene.nodes,timing:scene.timing})),
    requiredConcepts:[source.request.instruction??''].filter(Boolean),
    learnerLevel:source.request.learnerContext?.level,
    targetMs:Number(source.targetMinutes ?? source.request.durationMinutes)*60_000,
    actualMs:durationOf(scenes),
  });
  await writeFile(resolve(input,'..','final-release-audit.json'),JSON.stringify(releaseAudit,null,2));
  if(!releaseAudit.ok)throw new Error(`Final release audit failed: ${releaseAudit.findings.join(', ')}`);
}
// Every committed scene saved scene-by-scene in output/ (harness §§45/57/64;
// AGENTS.md #8: exports live in output/, job data stays in .data/).
const scenesDir=output.replace(/\.mp4$/,'')+'.scenes';
const artifacts=await writeSceneArtifacts(scenes,{title:plan.title,
  manifestVersion:typeof source.manifestVersion==='string'?source.manifestVersion:undefined,
  timingMode:typeof source.timingMode==='string'?source.timingMode:undefined,captionMode},scenesDir);
await mkdir(dirname(output),{recursive:true});const temporary=output+'.rendering.mp4';
const encoder=spawn('ffmpeg',['-y','-v','error','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart',temporary],{stdio:['pipe','inherit','inherit']});
let encoderError;encoder.on('error',e=>{encoderError=e;});encoder.stdin.on('error',e=>{encoderError=e;});
const completion=new Promise<void>((res,rej)=>{encoder.on('error',rej);encoder.on('close',c=>c===0?res():rej(new Error(`FFmpeg exited ${c}`)));});completion.catch(()=>{});
const duration=durationOf(scenes),frames=Math.ceil(duration*fps/1000),started=performance.now();
// Phase 4: render frames in small parallel batches (sharp scales across cores) but
// ALWAYS write to ffmpeg stdin in frame order — out-of-order frames would corrupt
// the video. EXPORT_JOBS overrides the CPU-derived batch size for measurement.
const batchSize=Math.max(2,Math.min(8,Number(process.env.EXPORT_JOBS||cpus().length||4)));
const renderFrame=async(frame:number)=>{const found=locateScene(scenes,frame*1000/fps)!;return sharp(Buffer.from(renderSVG(found.scene,found.localMs,{captions:captionMode==='burn-in'}))).resize(width,width*9/16).png().toBuffer();};
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
    if(!input)throw new Error('Narrated export requires the original .data/JOB/job.json.');
    const audioArgs=[],filters=[];
    for(let i=0;i<scenes.length;i++){
      const audioUrl=source.scenes[i].audioUrl;
      if(audioUrl){
        const audioPath=join(dirname(resolve(input)),`${scenes[i].id}.${audioUrl.endsWith('.wav')?'wav':'mp3'}`);await readFile(audioPath);audioArgs.push('-i',audioPath);
      }else{
        // A degraded TTS scene remains exportable: give ffmpeg an explicit silent
        // input matching the compiled scene instead of rejecting the whole lesson.
        audioArgs.push('-f','lavfi','-t',String(scenes[i].durationMs/1000),'-i','anullsrc=r=24000:cl=mono');
      }
      filters.push(`[${i+1}:a]aresample=24000,apad,atrim=duration=${scenes[i].durationMs/1000},asetpts=PTS-STARTPTS[a${i}]`);
    }
    filters.push(scenes.map((_,i)=>`[a${i}]`).join('')+`concat=n=${scenes.length}:v=0:a=1[a]`);
    const mux=spawn('ffmpeg',['-y','-v','error','-i',temporary,...audioArgs,'-filter_complex',filters.join(';'),'-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-t',String(duration/1000),'-movflags','+faststart',output],{stdio:'inherit'});
    const muxStarted=performance.now();
    await new Promise<void>((res,rej)=>{mux.on('error',rej);mux.on('exit',c=>c===0?res():rej(new Error('Audio mux failed')));});await rm(temporary);
    muxMs=Math.round(performance.now()-muxStarted);
  }else await rename(temporary,output);
  if(captionMode==='sidecar'){
    let offset=0;const cues:string[]=[];
    const stamp=(ms:number)=>{const total=Math.max(0,Math.round(ms));const h=Math.floor(total/3600000);const m=Math.floor(total%3600000/60000);const s=Math.floor(total%60000/1000);const z=total%1000;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(z).padStart(3,'0')}`;};
    for(const scene of scenes){
      const words=scene.timing.words||[];
      for(let i=0;i<words.length;i+=10){
        const group=words.slice(i,i+10);if(!group.length)continue;
        const start=offset+group[0].startMs,end=offset+group[group.length-1].endMs;
        cues.push(`${cues.length+1}\n${stamp(start)} --> ${stamp(end)}\n${group.map(w=>w.word).join(' ')}`);
      }
      offset+=scene.durationMs;
    }
    await writeFile(output.replace(/\.mp4$/i,'.vtt'),'WEBVTT\n\n'+cues.join('\n\n')+'\n');
  }
  let sceneClips:string[]=[];
  if(clipsDirArg){
    const clipsDir=resolve(clipsDirArg);await mkdir(clipsDir,{recursive:true});
    let offset=0;
    for(let index=0;index<scenes.length;index++){
      const scene=scenes[index];
      const clip=join(clipsDir,`scene-${String(index+1).padStart(2,'0')}-${scene.id}.mp4`);
      const args=['-y','-v','error','-ss',String(offset/1000),'-i',output,'-t',String(scene.durationMs/1000),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p',...(hasAudio?['-c:a','aac']:['-an']),'-movflags','+faststart',clip];
      await new Promise<void>((resolveClip,reject)=>{const child=spawn('ffmpeg',args,{stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolveClip():reject(new Error(`Scene clip export failed (${code})`)));});
      sceneClips.push(clip);offset+=scene.durationMs;
    }
  }
  const exportTiming={version:1,output,frames,fps,width,durationMs:duration,renderMs,muxMs,totalMs:Math.round(performance.now()-started),exportJobs:batchSize,narrated:hasAudio,captionMode,scenesDir:artifacts.dir,sceneFiles:artifacts.files,...(clipsDirArg?{sceneClips}:{})};
  // Persist timing where the job audit can find it. CLI stdout is useful for a
  // human, but it is not durable telemetry and cannot be joined after a restart.
  const timingArtifact=input?resolve(input,'..','export-timing.json'):output+'.timing.json';
  await writeFile(timingArtifact,JSON.stringify(exportTiming,null,2));
  console.log(JSON.stringify({...exportTiming,timingArtifact},null,2));
}catch(error){encoder.kill();await rm(temporary,{force:true});throw error;}
