import {renderSVG} from '../src/semantic/renderer/render-svg.js';
import type {CompiledSceneV2} from '../src/semantic/types.js';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const seek=el<HTMLInputElement>('seek'),play=el<HTMLButtonElement>('play'),cursor=el<HTMLInputElement>('cursor');let scene:CompiledSceneV2|undefined,playing=false,base=0,started=0;
const clock=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
function draw(){if(!scene)return;const t=Number(seek.value);el('board').innerHTML=renderSVG(scene,t,{cursor:cursor.checked});el('time').textContent=clock(t)+' / '+clock(scene.durationMs);}
function stop(){playing=false;play.textContent='Play';}
function frame(now:number){if(!playing||!scene)return;seek.value=String(Math.min(scene.durationMs,base+now-started));draw();if(Number(seek.value)>=scene.durationMs)stop();else requestAnimationFrame(frame);}
play.onclick=()=>{if(!scene)return;if(playing){stop();return;}base=Number(seek.value)>=scene.durationMs?0:Number(seek.value);started=performance.now();playing=true;play.textContent='Pause';requestAnimationFrame(frame);};
seek.oninput=()=>{stop();draw();};cursor.onchange=draw;
async function load(response:Response){const data=await response.json();if(!response.ok)throw new Error(data.error??'Scene compilation failed');scene=data;stop();seek.max=String(scene!.durationMs);seek.value='0';el('status').textContent=`${scene!.scene.title} · ${scene!.timing.kind} timing · ${scene!.scene.beats.length} beats`;el('details').textContent=JSON.stringify({archetype:scene!.scene.archetype,objects:scene!.objects.length,relations:scene!.relations.map(r=>`${r.from.objectId} → ${r.to.objectId}.${r.to.anchor}`),diagnostics:scene!.diagnostics},null,2);draw();}
el<HTMLInputElement>('file').onchange=async event=>{const f=(event.target as HTMLInputElement).files?.[0];if(!f)return;try{if(f.size>1_000_000)throw new Error('Scene file exceeds 1 MB');await load(await fetch('/api/semantic/compile',{method:'POST',headers:{'content-type':'application/json'},body:await f.text()}));}catch(e){el('status').textContent=e instanceof Error?e.message:String(e);}};

/* ---- Live generation: SSE scene push with offset resume + polling fallback ---- */
interface SceneSnapshot {id:string;title:string;durationMs:number;timingKind:string;audioUrl?:string}
interface JobSnapshot {id:string;status:string;scenes:SceneSnapshot[];availableMs:number;firstPlayableMs?:number;error?:string;errorKind?:string}
const generated:SceneSnapshot[]=[];
let jobAudio:Record<string,HTMLAudioElement>={};
async function showScene(snapshot:SceneSnapshot){
  const compiled=await (await fetch('/api/semantic/compile-from-job/'+snapshot.id,{method:'POST'})).json().catch(()=>null);
  let data:CompiledSceneV2|undefined;
  if(compiled&&compiled.version===2)data=compiled;
  else{const raw=await fetch(`/media/semantic-jobs/${snapshot.id}.json`).then(r=>r.ok?r.json():null).catch(()=>null);data=raw??undefined;}
  if(!data)return;
  scene=data;stop();seek.max=String(scene.durationMs);seek.value='0';
  el('status').textContent=`${scene.scene.title} · ${scene.timing.kind} timing · ${scene.scene.beats.length} beats`;
  draw();
}
async function createJob(){
  const prompt=el<HTMLTextAreaElement>('prompt').value.trim();
  if(!prompt)return;
  el('status').textContent='Planning…';
  const response=await fetch('/api/semantic/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt,allowedArchetypes:['structural_diagram','convergence','flow','cycle','equation_walkthrough'],narration:false,maxScenes:1})});
  const job=await response.json();
  if(!response.ok){el('status').textContent=job.error??'Job creation failed';return;}
  streamJob(job.id,0);
}
function applySnapshot(job:JobSnapshot){
  generated.length=0;generated.push(...job.scenes);
  el('jobstatus').textContent=`${job.status} · ${job.scenes.length} scene(s) · ${clock(job.availableMs)} ready`+(job.firstPlayableMs!==undefined?` · first playable ${job.firstPlayableMs}ms`:'')+(job.error?` · ${job.error}`:'');
  if(job.scenes.length&&!scene)void showScene(job.scenes[0]);
}
function streamJob(id:string,from:number){
  const source=new EventSource(`/api/semantic/jobs/${id}/stream?from=${from}`);
  source.addEventListener('scene',event=>{const snapshot=JSON.parse((event as MessageEvent).data) as SceneSnapshot;generated.push(snapshot);el('jobstatus').textContent=`streaming · ${generated.length} scene(s) ready`;void showScene(snapshot);});
  source.addEventListener('status',event=>{const job=JSON.parse((event as MessageEvent).data) as JobSnapshot;if(job.scenes.length)applySnapshot({...job,scenes:job.scenes});});
  source.addEventListener('end',event=>{source.close();const data=JSON.parse((event as MessageEvent).data);el('jobstatus').textContent+=` · ended (${data.status})`;});
  source.onerror=()=>{source.close();void fallbackPoll(id);};
}
async function fallbackPoll(id:string){
  for(let i=0;i<600;i++){
    const job=await fetch(`/api/semantic/jobs/${id}`).then(r=>r.json()).catch(()=>null);
    if(!job){el('jobstatus').textContent='job lost';return;}
    applySnapshot(job);
    if(['complete','partial','error','cancelled','interrupted'].includes(job.status))return;
    await new Promise(r=>setTimeout(r,500));
  }
}
el('generate').onclick=()=>void createJob().catch(e=>{el('status').textContent=e instanceof Error?e.message:String(e);});
fetch('/api/semantic/golden').then(load).catch(e=>{el('status').textContent=e.message;});
