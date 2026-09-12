import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import type {Timing} from './types.js';

export interface VoiceEngineSynthesis {audioPath:string;provider:string;language:string;voice:string;generationMs:number;audioDurationMs:number;rtf:number}
export interface VoiceEngineRequest {text:string;language:string;voice?:string;provider?:'auto'|'supertonic'|'piper'}
export type VoiceEngineRunner=(request:VoiceEngineRequest)=>Promise<VoiceEngineSynthesis>;

/** The local voice-engine lives beside the repo; override with VOICE_ENGINE_DIR. */
export function defaultVoiceEngineDir(env:NodeJS.ProcessEnv=process.env):string{
 return env.VOICE_ENGINE_DIR?resolve(env.VOICE_ENGINE_DIR):resolve(process.cwd(),'../lamina-labs-video/voice-engine');
}

/** Async one-shot bridge: JSON on stdin, result JSON on stdout. Providers stay behind the engine. */
export function createVoiceEngineRunner(options:{env?:NodeJS.ProcessEnv;engineDir?:string}={}):VoiceEngineRunner{
 const env=options.env??process.env,dir=options.engineDir??defaultVoiceEngineDir(env),cli=join(dir,'dist','cli.js');
 return request=>new Promise((resolvePromise,reject)=>{
  const child=spawn(process.execPath,[cli],{stdio:['pipe','pipe','pipe'],env:{...env,VOICE_ENGINE_OUT:env.VOICE_ENGINE_OUT??join(dir,'out')}});
  let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
  child.on('error',error=>reject(new Error(`voice-engine spawn failed: ${error.message}`)));
  child.on('close',code=>{if(code!==0){reject(new Error(`voice-engine exited ${code}: ${err.trim().slice(0,300)||'no stderr'}`));return;}try{resolvePromise(JSON.parse(out) as VoiceEngineSynthesis);}catch{reject(new Error(`Unreadable voice-engine output: ${out.slice(0,200)}`));}});
  child.stdin.end(JSON.stringify(request));
 });
}

/** Local engines return audio duration, not word timings: mark that explicitly. */
export function wordsFromDuration(text:string,durationMs:number):Timing{
 const tokens=text.trim().split(/\s+/).filter(Boolean);if(!tokens.length)throw new Error('Cannot time empty narration');
 const step=durationMs/tokens.length;
 return {kind:'engine',durationMs,words:tokens.map((word,i)=>({word,startMs:i*step,endMs:(i+1)*step}))};
}

/** Providers.speech-compatible adapter used by the V1 job runner. */
export async function generateVoiceEngineSpeech(text:string,{env=process.env,voiceId,language}:{env?:NodeJS.ProcessEnv;signal?:AbortSignal;voiceId?:string;language?:string}={}):Promise<{audio:Buffer;timing:Timing;format:'wav'}>{
 const run=createVoiceEngineRunner({env});
 const result=await run({text,language:language??env.VOICE_ENGINE_LANGUAGE??'en',...(voiceId?{voice:voiceId}:{}),provider:(env.VOICE_ENGINE_PROVIDER as VoiceEngineRequest['provider'])??'auto'});
 const audio=await readFile(result.audioPath);
 return {audio,timing:wordsFromDuration(text,result.audioDurationMs),format:'wav'};
}
