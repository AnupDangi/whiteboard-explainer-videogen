import {setTimeout as delay} from 'node:timers/promises';
import type {BudgetLedger} from './budget-ledger.js';
import type {Timing} from '../types/engine.js';

interface SpeechResult {audio:Buffer;timing:Timing;format?:'wav'|'mp3'}
interface PaidSpeechRequest {
  jobId:string;
  taskId:string;
  providerRequestId:string;
  text:string;
  voiceId?:string;
  limitUsd:number;
  signal?:AbortSignal;
}
type PaidSpeechAdapter=(text:string,options:{signal?:AbortSignal;voiceId?:string;providerRequestId?:string})=>Promise<SpeechResult>;

interface PaidSpeechGatewayOptions {
  usdPerThousandCharacters?:number;
  maxAttempts?:number;
  retryBaseMs?:number;
}

/**
 * Budget and idempotency boundary for paid speech. A reservation is durable-ledger
 * keyed before the adapter can perform network I/O. The same provider request ID
 * is used for every retry and concurrent duplicates share one execution.
 */
export class PaidSpeechGateway {
  private readonly completed=new Map<string,SpeechResult>();
  private readonly inFlight=new Map<string,Promise<SpeechResult>>();
  private readonly usdPerThousandCharacters:number;
  private readonly maxAttempts:number;
  private readonly retryBaseMs:number;

  constructor(private readonly ledger:BudgetLedger,private readonly adapter:PaidSpeechAdapter,options:PaidSpeechGatewayOptions={}){
    this.usdPerThousandCharacters=options.usdPerThousandCharacters??0.30;
    this.maxAttempts=Math.max(1,Math.floor(options.maxAttempts??3));
    this.retryBaseMs=Math.max(0,options.retryBaseMs??200);
  }

  estimateUsd(text:string):number {
    if(!Number.isFinite(this.usdPerThousandCharacters)||this.usdPerThousandCharacters<0)throw new Error('Speech price must be a non-negative finite amount');
    return text.length*this.usdPerThousandCharacters/1000;
  }

  async synthesize(request:PaidSpeechRequest):Promise<SpeechResult>{
    if(!request.providerRequestId.trim())throw new Error('Paid speech requires a provider request ID');
    const key=`${request.jobId}:${request.providerRequestId}`;
    const done=this.completed.get(key);if(done)return cloneResult(done);
    const active=this.inFlight.get(key);if(active)return cloneResult(await active);
    const execution=this.execute(request).finally(()=>this.inFlight.delete(key));
    this.inFlight.set(key,execution);
    return cloneResult(await execution);
  }

  private async execute(request:PaidSpeechRequest):Promise<SpeechResult>{
    const reservationId=`elevenlabs:${request.taskId}:${request.providerRequestId}`;
    const estimate=this.estimateUsd(request.text);
    const reservation=await this.ledger.reserve(request.jobId,reservationId,estimate,request.limitUsd);
    if(reservation.status==='settled')throw new Error(`Paid speech request ${request.providerRequestId} already settled; replay its artifact instead of calling the provider again`);
    if(reservation.status==='released')throw new Error(`Paid speech request ${request.providerRequestId} was released and cannot be reused`);
    let result:SpeechResult;
    try {
      result=await this.callWithRetry(request);
    }catch(error){
      await this.ledger.release(request.jobId,reservationId);
      throw error;
    }
    // Once the adapter returns, the provider may have charged us. Do not release or
    // repeat that paid call if settlement storage is temporarily unavailable: the
    // still-reserved row is the durable evidence requiring reconciliation.
    const settled=await this.ledger.settle(request.jobId,reservationId,estimate);
    if(settled.status!=='settled')throw new Error('Speech budget settlement did not commit');
    this.completed.set(`${request.jobId}:${request.providerRequestId}`,cloneResult(result));
    return result;
  }

  private async callWithRetry(request:PaidSpeechRequest):Promise<SpeechResult>{
    let lastError:unknown;
    for(let attempt=1;attempt<=this.maxAttempts;attempt++){
      request.signal?.throwIfAborted();
      try {
        return await this.adapter(request.text,{signal:request.signal,voiceId:request.voiceId,providerRequestId:request.providerRequestId});
      }catch(error){
        lastError=error;
        if(attempt>=this.maxAttempts||!retryable(error)||request.signal?.aborted)throw error;
        await delay(this.retryBaseMs*2**(attempt-1),undefined,{signal:request.signal});
      }
    }
    throw lastError;
  }
}

function retryable(error:unknown):boolean {
  const message=error instanceof Error?error.message:String(error);
  return /(?:HTTP\s+(?:408|409|425|429|5\d\d)\b|ECONNRESET|ETIMEDOUT|fetch failed|network)/i.test(message);
}

function cloneResult(result:SpeechResult):SpeechResult {
  return {...result,audio:Buffer.from(result.audio),timing:{...result.timing,words:result.timing.words.map(word=>({...word}))}};
}
