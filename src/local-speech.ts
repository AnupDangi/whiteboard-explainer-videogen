import {log} from './logger.js';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {ProviderOptions,Timing} from './types.js';

export function generateLocalSpeech(text:string,{signal,env=process.env}:ProviderOptions={}) {
  log('speech.request',{provider:'local',characters:text.length});
  const started=performance.now();
  return new Promise<{audio:Buffer;timing:Timing;format:'wav'}>((resolve,reject)=>{
    const child=spawn(env.PYTHON_BIN||'python3',[fileURLToPath(new URL('../../scripts/robot_tts.py',import.meta.url))],{
      env,signal,timeout:180000,stdio:['pipe','pipe','pipe'],
    });
    let output='',error='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{output+=chunk;if(output.length>30_000_000)child.kill();});
    child.stderr.on('data',(chunk:string)=>{error=(error+chunk).slice(-2000);});
    child.on('error',error=>{log('speech.process-error',{error},'error');reject(error);});child.stdin.on('error',()=>{});
    child.on('close',code=>{
      log('speech.process-exit',{code,elapsedMs:Math.round(performance.now()-started),error:error||undefined},code===0?'info':'error');
      if(code!==0)return reject(new Error(`Local robot TTS failed: ${error||'process stopped; check Python and speech access'}`));
      try {const result=JSON.parse(output);if(!result.audio_base64||!result.timing?.words?.length)throw new Error('Missing audio or word timings');resolve({audio:Buffer.from(result.audio_base64,'base64'),timing:result.timing,format:'wav'});}catch(e){reject(e);}
    });
    child.stdin.end(JSON.stringify({text}));
  });
}
