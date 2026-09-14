import {renderSVG} from '../src/semantic/renderer/render-svg.js';
import type {CompiledSceneV2} from '../src/semantic/types.js';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const seek=el<HTMLInputElement>('seek'),play=el<HTMLButtonElement>('play'),cursor=el<HTMLInputElement>('cursor'),audio=el<HTMLAudioElement>('audio');let scene:CompiledSceneV2|undefined,playing=false,base=0,started=0;
const clock=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
function draw(){if(!scene)return;const t=Number(seek.value);el('board').innerHTML=renderSVG(scene,t,{cursor:cursor.checked});el('time').textContent=clock(t)+' / '+clock(scene.durationMs);}
function stop(){playing=false;play.textContent='Play preview';}
function frame(now:number){if(!playing||!scene)return;seek.value=String(Math.min(scene.durationMs,base+now-started));draw();if(Number(seek.value)>=scene.durationMs)stop();else requestAnimationFrame(frame);}
play.onclick=()=>{if(!scene)return;if(playing){stop();return;}base=Number(seek.value)>=scene.durationMs?0:Number(seek.value);started=performance.now();playing=true;play.textContent='Pause';requestAnimationFrame(frame);};
seek.oninput=()=>{stop();draw();};cursor.onchange=draw;
async function load(response:Response){const data=await response.json();if(!response.ok)throw new Error(data.error??'Scene compilation failed');scene=data;stop();seek.max=String(scene!.durationMs);seek.value='0';el('status').textContent=`${scene!.scene.title} · ${scene!.timing.kind} timing · ${scene!.scene.beats.length} beats`;el('details').textContent=JSON.stringify({archetype:scene!.scene.archetype,objects:scene!.objects.length,relations:scene!.relations.map(r=>`${r.from.objectId} → ${r.to.objectId}.${r.to.anchor}`),diagnostics:scene!.diagnostics},null,2);draw();}
el<HTMLInputElement>('file').onchange=async event=>{const f=(event.target as HTMLInputElement).files?.[0];if(!f)return;try{if(f.size>1_000_000)throw new Error('Scene file exceeds 1 MB');await load(await fetch('/api/semantic/compile',{method:'POST',headers:{'content-type':'application/json'},body:await f.text()}));}catch(e){el('status').textContent=e instanceof Error?e.message:String(e);}};

/* ---- Live generation: SSE scene push with offset resume + polling fallback ---- */
interface SceneSnapshot {id:string;title:string;durationMs:number;timingKind:string;audioUrl?:string}
interface JobSnapshot {id:string;status:string;scenes:SceneSnapshot[];availableMs:number;firstPlayableMs?:number;error?:string;errorKind?:string;mp4Status?:'pending'|'ready'|'failed'|'withheld';mp4Url?:string;mp4Error?:string;harnessVersion?:string;finalGate?:'PENDING'|'PASS'|'FAIL'|'PARTIAL';publishable?:boolean;currentStage?:string;stageOwner?:string;costUsd?:number;calls?:number;gates?:{passed:boolean;findings:{severity:string}[]}[];learnerProgression?:{establishedConcepts:string[];checkpoints:number};continuityDecisions?:number}
const generated:SceneSnapshot[]=[];
let jobAudio:Record<string,HTMLAudioElement>={};
let currentJobId:string|null=null;
const mp4Button=el<HTMLButtonElement>('download-mp4');
const generateButton=el<HTMLButtonElement>('generate'),cancelButton=el<HTMLButtonElement>('cancel-job');
mp4Button.onclick=async()=>{
  if(!currentJobId)return;
  mp4Button.disabled=true;el('jobstatus').textContent='Exporting job MP4…';
  try{
    const result=await (await fetch(`/api/semantic/jobs/${currentJobId}/export`)).json();
    if(!result.output||typeof result.output!=='string'||!result.output.startsWith('/'))throw new Error(result.error||'Export failed');
    const a=document.createElement('a');a.href=result.output;a.download=`semantic-${currentJobId.slice(0,8)}.mp4`;document.body.appendChild(a);a.click();a.remove();
    el('jobstatus').textContent+=` · MP4 ready (${result.size||''})`;
  }catch(e){el('jobstatus').textContent=e instanceof Error?e.message:String(e);}
  mp4Button.disabled=false;
};
async function showScene(snapshot:SceneSnapshot,jobId:string|null=currentJobId){
  if(!jobId)return;
  const data=await fetch(`/media/semantic/${jobId}/${snapshot.id}.json`).then(r=>r.ok?r.json():null).catch(()=>null) as CompiledSceneV2|undefined;
  if(!data||data.version!==2)return;
  scene=data;stop();seek.max=String(scene.durationMs);seek.value='0';audio.hidden=!snapshot.audioUrl;if(snapshot.audioUrl){audio.src=snapshot.audioUrl;audio.load();}
  el('status').textContent=`${scene.scene.title} · ${scene.timing.kind} timing · ${scene.scene.beats.length} beats`;
  draw();
}
async function createJob(){
  const prompt=el<HTMLTextAreaElement>('prompt').value.trim();
  if(!prompt)return;
  generateButton.disabled=true;
  el('status').textContent='Planning…';
  const narration=el<HTMLInputElement>('narration').checked;const language=el<HTMLSelectElement>('language').value;
  const file=el<HTMLInputElement>('source').files?.[0];let source:undefined|{kind:'pdf';name:string;base64:string};
  if(file){if(file.size>50*1024*1024)throw new Error('PDF exceeds 50 MB');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));source={kind:'pdf',name:file.name,base64:btoa(binary)};}
  const goals=el<HTMLInputElement>('learner-goals').value.split(',').map(value=>value.trim()).filter(Boolean);
  const response=await fetch('/api/semantic/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt,source,allowedArchetypes:['structural_diagram','convergence','flow','cycle','equation_walkthrough','matrix_operation','timeline','trajectory','comparison','before_after','compression'],narration,language,targetMinutes:Number(el<HTMLSelectElement>('target-minutes').value),maxCostUsd:Number(el<HTMLInputElement>('budget').value),learnerProfile:{level:el<HTMLSelectElement>('learner-level').value,goals,language,assumedKnowledge:[]},groundingPolicy:el<HTMLSelectElement>('grounding').value,autoMp4:true})});
  const job=await response.json();
  if(!response.ok){generateButton.disabled=false;el('status').textContent=job.error??'Job creation failed';return;}
  currentJobId=job.id;mp4Button.hidden=true;cancelButton.hidden=false;
  streamJob(job.id,0);
}
function applySnapshot(job:JobSnapshot){
  generated.length=0;generated.push(...job.scenes);
  el('jobstatus').textContent=`${job.status} · ${job.scenes.length} scene(s) · ${clock(job.availableMs)} ready`+(job.firstPlayableMs!==undefined?` · first playable ${job.firstPlayableMs}ms`:'')+(job.error?` · ${job.error}`:'')+(job.mp4Status==='ready'&&job.mp4Url?` · MP4 ready (${job.mp4Url})`:job.mp4Status==='pending'?' · MP4 assembling…':job.mp4Status==='failed'?` · MP4 failed (${job.mp4Error??'see server log'})`:job.mp4Status==='withheld'?` · MP4 withheld (${job.mp4Error??'teaching gate failed'})`:'');
  const summary=el<HTMLElement>('run-summary');summary.hidden=false;
  el('run-gate').textContent=job.finalGate??'PENDING';el('run-stage').textContent=[job.currentStage,job.stageOwner].filter(Boolean).join(' / ')||job.status;
  el('run-learned').textContent=`${job.learnerProgression?.establishedConcepts.length??0} concepts`+(job.learnerProgression?.checkpoints?` / ${job.learnerProgression.checkpoints} checks`:'');
  el('run-cost').textContent=`$${(job.costUsd??0).toFixed(4)}`;
  el('run-note').textContent=job.publishable?'All critical gates passed. This run is publishable.':job.finalGate==='FAIL'?'Debug artifacts are retained. MP4 publication is blocked by a critical gate.':'The final MP4 is available only after every critical teaching gate passes.';
  mp4Button.hidden=!(job.publishable&&job.finalGate==='PASS');
  const terminal=['complete','partial','error','cancelled','interrupted'].includes(job.status);generateButton.disabled=!terminal;cancelButton.hidden=terminal;
  if(job.scenes.length&&!scene)void showScene(job.scenes[0],currentJobId);
}
function streamJob(id:string,from:number){
  const source=new EventSource(`/api/semantic/jobs/${id}/stream?from=${from}`);
  source.addEventListener('scene',event=>{const snapshot=JSON.parse((event as MessageEvent).data) as SceneSnapshot;generated.push(snapshot);el('jobstatus').textContent=`streaming · ${generated.length} scene(s) ready`;void showScene(snapshot,id);});
  source.addEventListener('status',event=>{const job=JSON.parse((event as MessageEvent).data) as JobSnapshot;if(job.scenes.length)applySnapshot({...job,scenes:job.scenes});});
  source.addEventListener('end',event=>{source.close();const data=JSON.parse((event as MessageEvent).data);el('jobstatus').textContent+=` · ended (${data.status})`;fetch(`/api/semantic/jobs/${id}`).then(r=>r.ok?r.json():null).then(job=>{if(job)applySnapshot(job);}).catch(()=>{});});
  source.onerror=()=>{source.close();void fallbackPoll(id);};
}
async function fallbackPoll(id:string){
  for(let i=0;i<600;i++){
    const job=await fetch(`/api/semantic/jobs/${id}`).then(r=>r.json()).catch(()=>null);
    if(!job){el('jobstatus').textContent='job lost';return;}
    applySnapshot(job);
    if(['complete','partial','error','cancelled','interrupted'].includes(job.status)){
      return;
    }
    await new Promise(r=>setTimeout(r,500));
  }
}
cancelButton.onclick=async()=>{if(!currentJobId)return;cancelButton.disabled=true;await fetch(`/api/semantic/jobs/${currentJobId}/cancel`,{method:'POST'}).catch(()=>null);cancelButton.disabled=false;};
generateButton.onclick=()=>void createJob().catch(e=>{generateButton.disabled=false;el('status').textContent=e instanceof Error?e.message:String(e);});
fetch('/api/semantic/golden').then(load).catch(e=>{el('status').textContent=e.message;});
