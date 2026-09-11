import {log,loggedFetch} from './logger.js';
import type {Timing} from './types.js';
interface Alignment {characters:string[];character_start_times_seconds:number[];character_end_times_seconds:number[]}
const timeoutSignal=(signal?:AbortSignal)=>signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);
// Legacy Anthropic direct path — kept for backwards compat when OPENROUTER_* absent.
// Prefer OPENROUTER_API_KEY. This function is deprecated; jobs.ts now uses planner.ts generateChapters.

export function alignmentToTiming(text:string,alignment:Alignment):Timing {
  if(!alignment || !Array.isArray(alignment.characters))throw new Error('Speech provider returned no alignment');
  const {characters,character_start_times_seconds:starts,character_end_times_seconds:ends}=alignment;
  if(!Array.isArray(starts)||!Array.isArray(ends)||starts.length!==characters.length||ends.length!==characters.length||!starts.length)throw new Error('Malformed speech alignment');
  const joined=characters.join('');
  // Reject normalization changes instead of silently assigning the wrong word anchors.
  if(joined.replace(/\s+/g,' ').trim()!==text.replace(/\s+/g,' ').trim())throw new Error('Speech alignment differs from source text');
  let previous=0;
  starts.forEach((start,i)=>{if(!Number.isFinite(start)||!Number.isFinite(ends[i])||start<previous||ends[i]<start)throw new Error('Non-monotonic speech alignment');previous=start;});
  const words:{word:string;startMs:number;endMs:number}[]=[];let word='',start=0,end=0;
  characters.forEach((c,i)=>{if(/\s/.test(c)){if(word){words.push({word,startMs:start*1000,endMs:end*1000});word='';}}else{if(!word)start=starts[i];word+=c;end=ends[i];}});
  if(word)words.push({word,startMs:start*1000,endMs:end*1000});
  return {kind:'provider-aligned',words,durationMs:Math.max(...ends)*1000};
}

export async function generateSpeech(text:string,{env=process.env,fetcher=fetch,signal,voiceId}:{voiceId?:string;env?:NodeJS.ProcessEnv;fetcher?:typeof fetch;signal?:AbortSignal}={}) {
  fetcher=loggedFetch('elevenlabs',fetcher);
  log('speech.request',{provider:'elevenlabs',voiceId:voiceId||env.ELEVENLABS_VOICE_ID,model:env.ELEVENLABS_MODEL_ID||'eleven_multilingual_v2',characters:text.length});
  if(!env.ELEVENLABS_API_KEY||!(voiceId||env.ELEVENLABS_VOICE_ID))throw new Error('Configure ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID for narration.');
  const response=await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId||env.ELEVENLABS_VOICE_ID!)}/with-timestamps`,{method:'POST',signal:timeoutSignal(signal),headers:{'content-type':'application/json','xi-api-key':env.ELEVENLABS_API_KEY},body:JSON.stringify({text,model_id:env.ELEVENLABS_MODEL_ID||'eleven_multilingual_v2'})});
  if(!response.ok){
    let message='',code='';
    try {
      const data=await response.json();
      const detail=data.detail;
      message=typeof detail==='string'?detail:detail?.message||data.message||'';
      code=detail?.code||detail?.status||detail?.type||'';
    } catch {}
    log('speech.rejected',{provider:'elevenlabs',status:response.status,code,message},'error');
    throw new Error(`ElevenLabs HTTP ${response.status}${code?` [${code}]`:''}${message?`: ${message}`:''}`);
  }
  const data=await response.json();
  if(!data.audio_base64)throw new Error('Speech provider returned no audio');
  return {format:'mp3' as const,audio:Buffer.from(data.audio_base64,'base64'),timing:alignmentToTiming(text,data.alignment)};
}
