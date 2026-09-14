import {readFile} from 'node:fs/promises';
import {log} from '../shared/logger.js';
import {createVoiceEngineRunner,wordsFromDuration,type VoiceEngineRequest,type VoiceEngineRunner} from '../shared/voice-engine-client.js';
import type {VisualTiming} from './types.js';

export type SpeechTimingSource='provider'|'aligner'|'estimated';
export interface SpeechResult {timing:VisualTiming;audio:Buffer;format:'wav'|'mp3';provider?:string;timingSource:SpeechTimingSource;firstAudioByteMs?:number}
export type V2Speech=(text:string)=>Promise<SpeechResult>;
export type StreamingSpeechEvent =
 | {type:'audio';chunk:Buffer;offsetMs:number}
 | {type:'word';word:string;startMs:number;endMs:number}
 | {type:'complete';durationMs:number;timingSource:SpeechTimingSource}
 | {type:'error';error:Error};
export interface StreamingSpeech {stream(text:string,signal?:AbortSignal):AsyncIterable<StreamingSpeechEvent>}

/** Buffered providers can participate in the streaming contract without being
 * mislabeled as low-latency: the single audio event is emitted only after the
 * provider has completed. */
export function bufferedSpeechAdapter(speech:V2Speech):StreamingSpeech{
 return {async *stream(text,signal){signal?.throwIfAborted();try{const result=await speech(text);signal?.throwIfAborted();yield {type:'audio',chunk:result.audio,offsetMs:0};yield {type:'word',...result.timing.words[0]};for(const word of result.timing.words.slice(1))yield {type:'word',...word};yield {type:'complete',durationMs:result.timing.durationMs,timingSource:result.timingSource};}catch(error){yield {type:'error',error:error instanceof Error?error:new Error(String(error))};}}};
}

/** Architecture boundary: V2 asks for speech, not for a provider. Local voice-engine stays external. */
export function createVoiceEngineSpeech(options:{env?:NodeJS.ProcessEnv;language?:string;run?:VoiceEngineRunner;signal?:AbortSignal}={}):V2Speech{
 const env=options.env??process.env,run=options.run??createVoiceEngineRunner({env,signal:options.signal});
 const request={language:options.language??env.VOICE_ENGINE_LANGUAGE??'en',provider:(env.VOICE_ENGINE_PROVIDER as VoiceEngineRequest['provider'])??'auto'};
 return async (text:string)=>{
  const result=await run({text,...request});
  const audio=await readFile(result.audioPath);
  log('v2.speech.local',{provider:result.provider,language:result.language,voice:result.voice,generationMs:result.generationMs,audioDurationMs:result.audioDurationMs,rtf:result.rtf});
  return {timing:wordsFromDuration(text,result.audioDurationMs),audio,format:'wav',provider:result.provider,timingSource:'estimated'};
 };
}
