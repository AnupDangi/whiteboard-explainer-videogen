import type {JobSnapshot,CompiledScene} from '../src/shared/types.js';
import {compileScene,renderSVG,sceneState,locateScene,durationOf,advancePlayback} from '../src/explainer/engine.js';
const $=(id:string)=>document.getElementById(id) as any;
const terminal=['complete','partial','error','cancelled','interrupted'];
let scenes:CompiledScene[]=[],job:JobSnapshot|null=null,time=0,playing=false,last=0,poll:ReturnType<typeof setTimeout>|undefined=undefined,stalls=0,buffering=false,audioScene:string|null=null,audioTail=false,audioPending=false;
const audio=$('audio');const format=(t:number)=>`${Math.floor(t/60000)}:${String(Math.floor(t/1000)%60).padStart(2,'0')}`;let lastDraw=0,transcriptScene:CompiledScene|null=null,activeWord=-1;
function reportPlayback(type:string){
  void fetch('/api/client-events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,jobId:job?.id||null,timeMs:time,rate:Number($('speed').value)})}).catch(()=>{});
}
window.addEventListener('error',()=>reportPlayback('client-error'));
window.addEventListener('unhandledrejection',()=>reportPlayback('client-error'));
function draw(){
  const found=locateScene(scenes,time);if(!found){$('board').replaceChildren();$('transcript').textContent=job&&terminal.includes(job.status)?(job.error||'No scenes were prepared.'):'Preparing the first scene…';return;}
  const {scene,index,localMs}=found;
  $('board').innerHTML=renderSVG(scene,localMs);$('scene-name').textContent='Scene '+String(index+1).padStart(2,'0')+' / ' + (job?.totalScenes||scenes.length);
  const state=sceneState(scene,localMs);
  if(transcriptScene!==scene){transcriptScene=scene;activeWord=-1;const spans=scene.timing.words.map((w,i)=>{const span=document.createElement('span');span.textContent=w.word+' ';if(i===state.activeWord)span.className='spoken';return span;});$('transcript').replaceChildren(...spans);}
  if(activeWord!==state.activeWord){$('transcript').children[activeWord]?.classList.remove('spoken');$('transcript').children[state.activeWord]?.classList.add('spoken');activeWord=state.activeWord;}
  $('seek').max=Math.max(1,durationOf(scenes));$('seek').value=time;$('clock').textContent=format(time)+' / '+format(durationOf(scenes));
  $('timing').textContent=scene.audioUrl?'Provider alignment · narrated':'Estimated timing · silent preview';
  $('play').textContent=playing?'Ⅱ Pause':'▶ Play';$('buffer-metric').textContent=stalls;
}
let audioGeneration=0;
function resetAudio(){audioGeneration++;audio.pause();audio.removeAttribute('src');audio.load();audioScene=null;audioTail=false;audioPending=false;}
async function syncAudio(found:ReturnType<typeof locateScene>){
  if(!found?.scene.audioUrl)return;
  if(audioScene!==found.scene.id){
    resetAudio();audioScene=found.scene.id;
    // Seeking into the visual tail must not replay the scene's narration.
    if(found.localMs>=found.scene.timing.durationMs){audioTail=true;return;}
    audio.src=found.scene.audioUrl;audio.currentTime=found.localMs/1000;
  }
  if(audioPending||audioTail||!audio.paused)return;
  const generation=audioGeneration;audioPending=true;
  audio.playbackRate=Number($('speed').value);
  try{await audio.play();if(generation===audioGeneration&&!playing)audio.pause();}
  catch{if(generation===audioGeneration){playing=false;reportPlayback('audio-blocked');$('message').textContent='Audio playback was blocked or failed. Press Play to retry.';draw();}}
  finally{if(generation===audioGeneration)audioPending=false;}
}
audio.addEventListener('ended',()=>{audioTail=true;reportPlayback('audio-ended');});
audio.addEventListener('error',()=>{if(audioScene){playing=false;reportPlayback('audio-error');$('message').textContent='Narration could not load. Retry the job or disable narration.';draw();}});
function frame(now:number){
  const delta=last?Math.min(250,now-last):0;last=now;
  if(playing){
    const found=locateScene(scenes,time),complete=!job||terminal.includes(job.status);
    let next=time+delta*Number($('speed').value);
    if(found?.scene.audioUrl){
      if(audioScene!==found.scene.id){void syncAudio(found);next=time;}
      else if(!audioTail){void syncAudio(found);next=audioPending?time:found.offsetMs+audio.currentTime*1000;}
    }else if(audioScene){resetAudio();}
    const result=advancePlayback(time,next-time,durationOf(scenes),complete);
    if(result.buffering&&!buffering)stalls++;
    if(result.buffering!==buffering)reportPlayback(result.buffering?'buffering':'resumed');
    buffering=result.buffering;time=result.timeMs;
    if(result.ended){reportPlayback('playback-ended');playing=false;audio.pause();draw();}
    if(buffering)$('status').textContent='Buffering · next scene preparing';
    else if(job)$('status').textContent=job.status==='complete'?'Complete':job.status;
    if(now-lastDraw>=80){draw();lastDraw=now;}
  }
  requestAnimationFrame(frame);
}
$('play').onclick=()=>{if(!scenes.length)return;if(time>=durationOf(scenes)&&(!job||terminal.includes(job.status))){time=0;resetAudio();}playing=!playing;reportPlayback(playing?'play':'pause');if(!playing)audio.pause();last=0;draw();};
$('seek').oninput=()=>{time=Number($('seek').value);reportPlayback('seek');resetAudio();buffering=false;draw();};
$('speed').onchange=()=>{reportPlayback('speed');audio.playbackRate=Number($('speed').value);};
$('mode').onchange=()=>{$('fixture-fields').hidden=$('mode').value!=='fixture';$('prompt-fields').hidden=$('mode').value!=='model';};
async function request(path:string,options:RequestInit={}){
  const res=await fetch(path,options);
  const data=await res.json();
  if(!res.ok)throw new Error(data.error||'Request failed');
  return data;
}
function showJob(data:JobSnapshot){
  job=data;scenes=data.scenes;$('title').textContent=data.title||(terminal.includes(data.status)?'Explanation unavailable':'Preparing your explanation…');
  const degraded=data.fallbackCount||0;$('status').textContent=degraded?`${data.status} · ${degraded} scene${degraded>1?'s':''} silent (local TTS unavailable)`:data.status;
  $('ready-metric').textContent=`${scenes.length} / ${data.totalScenes||'?'}`;
  $('events').replaceChildren(...data.events.slice(-10).map(e=>{const li=document.createElement('li');li.textContent=(`${(e.atMs/1000).toFixed(1)}s  ${e.type}  · ${format(e.availableMs)} ready`);return li;}));
  const ended=terminal.includes(data.status);$('first-metric').textContent=data.firstPlayableMs===undefined?'—':(data.firstPlayableMs/1000).toFixed(1)+' s';$('cancel').disabled=ended;$('create').disabled=!ended;
  $('cost-metric').textContent=data.usage?`$${data.usage.costUsd.toFixed(4)} planning · ${data.usage.calls} calls · ${data.ttsCharacters} TTS characters`:data.mode==='fixture'?`${data.ttsCharacters} TTS characters · offline fixture`:'Waiting for provider usage';
  if(data.error)$('message').textContent=data.error;
  draw();
}
async function refresh(id:string){try{const data=await request('/api/jobs/'+id);showJob(data);if(!terminal.includes(data.status))poll=setTimeout(()=>refresh(id),400);}catch(e){$('message').textContent=e instanceof Error?e.message:String(e);$('create').disabled=false;}}
$('generate').onsubmit=async (e:SubmitEvent)=>{
  e.preventDefault();clearTimeout(poll);playing=false;time=0;stalls=0;buffering=false;resetAudio();$('create').disabled=true;$('message').textContent='';job=null;scenes=[];transcriptScene=null;$('title').textContent='Preparing your explanation…';$('status').textContent='Submitting';draw();
  try{
    const kind=$('source-kind').value;
    const source:any={kind,text:$('prompt').value,url:$('source-url').value};
    if(kind==='pdf'){const file=$('source-file').files[0];if(!file)throw new Error('Choose a PDF');if(file.size>50*1024*1024)throw new Error('PDF exceeds 50 MB');source.name=file.name;source.base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});}
    const language=$('tts-language').value;
    const data=await request('/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:$('mode').value,fixture:$('fixture').value,prompt:$('prompt').value,source,durationMinutes:Number($('duration').value),maxCostUsd:Number($('budget').value),delayMs:0,narration:$('narration').checked,ttsProvider:'voice-engine',language,visualCritic:$('visual-critic').checked})});showJob(data);refresh(data.id);}catch(error){$('message').textContent=error instanceof Error?error.message:String(error);$('create').disabled=false;$('status').textContent='Error';$('title').textContent='Explanation could not be prepared';$('voice-message').textContent='';}
};
$('cancel').onclick=async()=>{if(job){await request('/api/jobs/'+job.id+'/cancel',{method:'POST'});clearTimeout(poll);await refresh(job.id);}};
$('download').onclick=async()=>{if(!job||!['complete','partial'].includes(job.status)){$('message').textContent='Job must be complete to export video';return;}$('message').textContent='Exporting MP4...';const resp=await fetch(`/api/export?job=${job.id}`,{method:'GET'});const result=await resp.json();if(!resp.ok||result.status!=='complete'){$('message').textContent=result.error||'Export failed';return;}// `result.output` is a server route (/output/<jobId>.mp4), not a filesystem path — a browser
// can only fetch the former, so anything else here is a broken link rather than a download.
if(typeof result.output!=='string'||!result.output.startsWith('/')){$('message').textContent='Export returned an unfetchable path';return;}
$('message').textContent='Downloading MP4...';const mpxLink=document.createElement('a');mpxLink.href=result.output;mpxLink.download=`${job.title||'explanation'}-${job.id?.slice(0,8)}.mp4`;document.body.appendChild(mpxLink);mpxLink.click();mpxLink.remove();$('message').textContent='MP4 exported and downloaded.';setTimeout(()=>{$('message').textContent='';},2000);};
request('/api/config').then(function(c){
  if(c.tiers){
    const pipeline=$('pipeline');pipeline.hidden=false;
    const fill=(id:string,value?:string)=>{const el=$(id);if(el)el.querySelector('b').textContent=' '+(value||'default').split('/').pop();};
    fill('tier-outline',c.tiers.outline);fill('tier-content',c.tiers.content);fill('tier-director',c.tiers.director);fill('tier-vision',c.tiers.vision);
  }
  if(!c.model)$('message').textContent='Configure OPENROUTER_API_KEY in .env to generate an explanation.';
  else if(c.openRouter===false)$('message').textContent='Using legacy Anthropic planner; set OPENROUTER_API_KEY for OpenRouter.';
}).catch(function(e){$('message').textContent=e instanceof Error?e.message:String(e);});
const sourceFields=()=>{const kind=$('source-kind').value,wrap=(el:HTMLElement|null,show:boolean)=>{if(el)el.hidden=!show;};
  wrap($('prompt').closest('.field') as HTMLElement,['prompt','text'].includes(kind));
  wrap(document.getElementById('source-url')?.closest('.field') as HTMLElement,kind==='url');
  wrap(document.getElementById('source-file')?.closest('.field') as HTMLElement,kind==='pdf');};
$('source-kind').onchange=sourceFields;sourceFields();
$('demo').onclick=()=>{$('mode').value='fixture';$('mode').dispatchEvent(new Event('change'));$('generate').requestSubmit();};
$('narration').onchange=()=>{$('voice-fields').hidden=!$('narration').checked;};
const savedJob=new URLSearchParams(location.search).get('job');
if(savedJob&&/^[a-f0-9-]{36}$/.test(savedJob))void refresh(savedJob);
draw();requestAnimationFrame(frame);