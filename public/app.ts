import type {JobSnapshot,CompiledScene} from '../src/types.js';
import {compileScene,renderSVG,sceneState,locateScene,durationOf,advancePlayback} from '../src/engine.js';
const $=(id:string)=>document.getElementById(id) as any;
const terminal=['complete','error','cancelled','interrupted'];
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
  $('timing').textContent=scene.audioUrl?(scene.timing.kind==='local-segment-aligned'?'Measured word segments · Python robot voice':'Provider alignment · narrated'):'Estimated timing · silent preview';
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
  job=data;scenes=data.scenes;$('title').textContent=data.title||(terminal.includes(data.status)?'Explanation unavailable':'Preparing your explanation…');$('status').textContent=data.status;
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
    const provider=$('tts-provider').value;
    const voiceId=provider==='kokoro'?$('kokoro-voice').value:provider==='elevenlabs'?($('voice').value==='custom'?$('custom-voice').value.trim():$('voice').value):'';
    const data=await request('/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:$('mode').value,fixture:$('fixture').value,prompt:$('prompt').value,source,durationMinutes:Number($('duration').value),maxCostUsd:Number($('budget').value),delayMs:0,narration:$('narration').checked,ttsProvider:provider,voiceId,visualCritic:$('visual-critic').checked})});showJob(data);refresh(data.id);}catch(error){$('message').textContent=error instanceof Error?error.message:String(error);$('create').disabled=false;$('status').textContent='Error';$('title').textContent='Explanation could not be prepared';$('voice-message').textContent='';}
};
$('cancel').onclick=async()=>{if(job){await request('/api/jobs/'+job.id+'/cancel',{method:'POST'});clearTimeout(poll);await refresh(job.id);}};
$('download').onclick=()=>{const data=job||{title:'Explanation',status:'complete',scenes};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='explanation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
request('/api/config').then(function(c){
  $('tts-provider').querySelector('[value=elevenlabs]').disabled=!c.elevenlabs;
  if(!c.localSpeech)$('voice-message').textContent='Local speech currently requires macOS and Python 3.';
  if(!c.model)$('message').textContent='Configure OPENROUTER_API_KEY in .env to generate an explanation.';
  else if(c.openRouter===false)$('message').textContent='Using legacy Anthropic planner; set OPENROUTER_API_KEY for OpenRouter.';
}).catch(function(e){$('message').textContent=e instanceof Error?e.message:String(e);});
$('source-kind').onchange=()=>{const kind=$('source-kind').value;$('prompt').hidden=!['prompt','text'].includes(kind);$('source-url').hidden=kind!=='url';$('source-file').hidden=kind!=='pdf';};
$('narration').onchange=()=>{$('voice-fields').hidden=!$('narration').checked;};
$('tts-provider').onchange=()=>{const provider=$('tts-provider').value;$('elevenlabs-fields').hidden=provider!=='elevenlabs';$('kokoro-fields').hidden=provider!=='kokoro';};
$('voice').onchange=()=>{$('custom-voice').hidden=$('voice').value!=='custom';};
const savedJob=new URLSearchParams(location.search).get('job');
if(savedJob&&/^[a-f0-9-]{36}$/.test(savedJob))void refresh(savedJob);
draw();requestAnimationFrame(frame);