import {readFile} from 'node:fs/promises';
import {log} from '../logger.js';
import {createVoiceEngineRunner,wordsFromDuration,type VoiceEngineRequest,type VoiceEngineRunner} from '../voice-engine-client.js';
import type {VisualTiming} from './types.js';

export type V2Speech=(text:string)=>Promise<{timing:VisualTiming;audio:Buffer;format:'wav'|'mp3'}>;

/** Architecture boundary: V2 asks for speech, not for a provider. Local voice-engine stays external. */
export function createVoiceEngineSpeech(options:{env?:NodeJS.ProcessEnv;language?:string;run?:VoiceEngineRunner}={}):V2Speech{
 const env=options.env??process.env,run=options.run??createVoiceEngineRunner({env});
 const request={language:options.language??env.VOICE_ENGINE_LANGUAGE??'en',provider:(env.VOICE_ENGINE_PROVIDER as VoiceEngineRequest['provider'])??'auto'};
 return async (text:string)=>{
  const result=await run({text,...request});
  const audio=await readFile(result.audioPath);
  log('v2.speech.local',{provider:result.provider,language:result.language,voice:result.voice,generationMs:result.generationMs,audioDurationMs:result.audioDurationMs,rtf:result.rtf});
  return {timing:wordsFromDuration(text,result.audioDurationMs),audio,format:'wav'};
 };
}
