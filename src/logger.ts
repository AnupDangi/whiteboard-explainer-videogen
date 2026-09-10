import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {appendFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

export const logContext=new AsyncLocalStorage<Record<string,unknown>>();

export function sanitizeLog(value:unknown):unknown {
  if(value instanceof Error)return sanitizeLog({name:value.name,message:value.message,stack:value.stack});
  if(typeof value==='string'){
    let safe=value;
    for(const [key,secret] of Object.entries(process.env)){
      if(/key|token|secret|password|credential/i.test(key)&&secret&&secret.length>=4)safe=safe.split(secret).join('[REDACTED]');
    }
    return safe.replace(/(Bearer\s+)[^\s"']+/gi,'$1[REDACTED]');
  }
  if(Array.isArray(value))return value.map(sanitizeLog);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[
    key,/^(authorization|cookie|set-cookie|.*api.?key|.*password|.*secret|.*token|prompt|narration|sourceText|audio_base64|base64)$/i.test(key)?'[REDACTED]':sanitizeLog(item),
  ]));
  return value;
}

export function log(event:string,fields:Record<string,unknown>={},level:'info'|'warn'|'error'='info') {
  const line=JSON.stringify(sanitizeLog({at:new Date().toISOString(),level,event,...logContext.getStore(),...fields}));
  if(level==='error')console.error(line);else if(level==='warn')console.warn(line);else console.log(line);
  // P5 eval ledger: every line also lands in the job's log.jsonl (best-effort; the
  // console stream stays primary). Journal/eval scripts read this file back.
  const jobId=logContext.getStore()?.jobId;
  if(typeof jobId==='string'&&/^[a-f0-9-]{36}$/.test(jobId)){
    try{appendFileSync(join('.data',jobId,'log.jsonl'),line+'\n');}catch{/* ledger must never break the pipeline */}
  }
}

/** Never logs provider headers, request bodies, query strings, or response bodies. */
export function loggedFetch(provider:string,fetcher:typeof fetch):typeof fetch {
  return async(input,init)=>{
    const callId=randomUUID(),started=performance.now();
    const url=new URL(input instanceof Request?input.url:String(input));
    log('provider.request',{provider,callId,method:init?.method||'GET',host:url.host,path:url.pathname});
    try {
      const response=await fetcher(input,init);
      log('provider.response',{provider,callId,status:response.status,elapsedMs:Math.round(performance.now()-started),requestId:response.headers?.get('request-id')||response.headers?.get('x-request-id')},response.ok?'info':'error');
      return response;
    }catch(error){log('provider.failure',{provider,callId,elapsedMs:Math.round(performance.now()-started),error},'error');throw error;}
  };
}
