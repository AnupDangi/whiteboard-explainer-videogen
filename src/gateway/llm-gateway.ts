import {createHash,randomUUID} from 'node:crypto';
import {log} from '../core/logger.js';
import type {BudgetLedger} from './budget-ledger.js';
import {InMemoryBudgetLedger} from './budget-ledger.js';
import {semaphore} from '../core/concurrency.js';

interface GatewayUsage {
  promptTokens:number;
  completionTokens:number;
  cachedTokens:number;
  costUsd:number;
}

export interface StructuredProviderResult {
  content:string;
  finishReason:string;
  providerRequestId?:string;
  usage:GatewayUsage;
  /** Provider response retained for compatibility logging/persisted replay. It is never
   * interpreted by callers to bypass the gateway. */
  rawResponse?:unknown;
}

export interface StructuredProviderRequest {
  provider:string;
  model:string;
  system:unknown;
  prompt:unknown;
  schema:object;
  schemaName:string;
  maxTokens:number;
  temperature:number;
  seed?:number;
  signal?:AbortSignal;
  sessionId?:string;
  reasoningMaxTokens?:number;
}

export interface StructuredModelProvider {
  execute(request:StructuredProviderRequest):Promise<StructuredProviderResult>;
}

interface GatewayCache {
  get(key:string):Promise<StructuredProviderResult|undefined>;
  put(key:string,value:StructuredProviderResult):Promise<void>;
}

class MemoryGatewayCache implements GatewayCache {
  private readonly entries=new Map<string,StructuredProviderResult>();
  async get(key:string){const value=this.entries.get(key);return value?structuredClone(value):undefined;}
  async put(key:string,value:StructuredProviderResult){this.entries.set(key,structuredClone(value));}
}

interface ExecuteStructuredRequest<T> extends StructuredProviderRequest {
  jobId:string;
  taskId?:string;
  label:string;
  promptVersion:string;
  schemaVersion:string;
  budgetLimitUsd:number;
  estimatedCostUsd:number;
  parse?:(content:string)=>T;
  validate?:(value:T)=>void;
  cache?:boolean;
  maxAttempts?:number;
  acceptedFinishReasons?:string[];
}

interface CircuitState {failures:number;openedAt?:number}

/** Shared semantic-model boundary. Providers own wire formats; the gateway owns
 * reservations, idempotency, single-flight, retry, cache, circuit state and telemetry. */
interface GatewayStructuredResult<T> {value:T;usage:GatewayUsage;cacheHit:boolean;requestId:string;finishReason:string;rawResponse?:unknown}

export class LLMGateway {
  private readonly flights=new Map<string,Promise<unknown>>();
  private readonly circuits=new Map<string,CircuitState>();
  private readonly capacity=new Map<string,ReturnType<typeof semaphore>>();

  constructor(
    private readonly providers:Record<string,StructuredModelProvider>,
    private readonly ledger:BudgetLedger=new InMemoryBudgetLedger(),
    private readonly cache:GatewayCache=new MemoryGatewayCache(),
    limits:Record<string,number>={},
  ){for(const [provider,limit] of Object.entries(limits))this.capacity.set(provider,semaphore(Math.max(1,Math.floor(limit))));}

  async executeStructured<T=unknown>(request:ExecuteStructuredRequest<T>):Promise<GatewayStructuredResult<T>>{
    const cacheKey=this.key(request);
    if(request.cache!==false){
      const cached=await this.cache.get(cacheKey);
      if(cached){
        const value=this.parse(request,cached.content);this.validate(request,value);
        log('gateway.cache-hit',{jobId:request.jobId,label:request.label,model:request.model,cacheKey});
        return {value,usage:{...cached.usage,costUsd:0},cacheHit:true,requestId:cached.providerRequestId??cacheKey,finishReason:cached.finishReason,rawResponse:cached.rawResponse};
      }
    }
    const running=this.flights.get(cacheKey) as Promise<GatewayStructuredResult<T>>|undefined;
    if(running)return running;
    const execution=this.run(request,cacheKey).finally(()=>this.flights.delete(cacheKey));
    this.flights.set(cacheKey,execution);
    return execution;
  }

  private async run<T>(request:ExecuteStructuredRequest<T>,cacheKey:string):Promise<GatewayStructuredResult<T>>{
    const provider=this.providers[request.provider];
    if(!provider)throw new Error(`Unknown model provider ${request.provider}`);
    const circuitKey=`${request.provider}:${request.model}`;
    const circuit=this.circuits.get(circuitKey)??{failures:0};
    if(circuit.openedAt&&Date.now()-circuit.openedAt<30_000)throw new Error(`Circuit open for ${circuitKey}`);
    if(circuit.openedAt)circuit.openedAt=undefined;
    this.circuits.set(circuitKey,circuit);
    const requestId=request.taskId??randomUUID();
    const attempts=Math.max(1,Math.min(3,request.maxAttempts??2));
    let lastError:unknown;
    for(let attempt=1;attempt<=attempts;attempt++){
      const reservationId=`${requestId}:${attempt}`;
      await this.ledger.reserve(request.jobId,reservationId,request.estimatedCostUsd,request.budgetLimitUsd);
      const started=performance.now();
      try{
        const gate=this.capacity.get(request.provider);if(gate)await gate.acquire();
        let result:StructuredProviderResult;
        try{result=await provider.execute(request);}finally{gate?.release();}
        await this.ledger.settle(request.jobId,reservationId,result.usage.costUsd);
        const accepted=request.acceptedFinishReasons??['stop'];
        if(!accepted.includes(result.finishReason))throw new Error(`Provider returned finish_reason=${result.finishReason||'missing'}`);
        const value=this.parse(request,result.content);this.validate(request,value);
        circuit.failures=0;circuit.openedAt=undefined;
        if(request.cache!==false)await this.cache.put(cacheKey,result);
        log('gateway.call',{jobId:request.jobId,label:request.label,provider:request.provider,model:request.model,attempt,requestId:result.providerRequestId??requestId,promptVersion:request.promptVersion,schemaVersion:request.schemaVersion,estimatedCostUsd:request.estimatedCostUsd,actualCostUsd:result.usage.costUsd,promptTokens:result.usage.promptTokens,completionTokens:result.usage.completionTokens,cachedTokens:result.usage.cachedTokens,elapsedMs:Math.round(performance.now()-started)});
        return {value,usage:result.usage,cacheHit:false,requestId:result.providerRequestId??requestId,finishReason:result.finishReason,rawResponse:result.rawResponse};
      }catch(error){
        await this.ledger.release(request.jobId,reservationId).catch(()=>{});
        lastError=error;circuit.failures++;
        if(circuit.failures>=5)circuit.openedAt=Date.now();
        log('gateway.call-failed',{jobId:request.jobId,label:request.label,provider:request.provider,model:request.model,attempt,error},'warn');
        if(attempt<attempts)await this.backoff(attempt,request.signal);
      }
    }
    throw lastError instanceof Error?lastError:new Error(String(lastError));
  }

  private parse<T>(request:ExecuteStructuredRequest<T>,content:string):T{return request.parse?request.parse(content):JSON.parse(content) as T;}
  private validate<T>(request:ExecuteStructuredRequest<T>,value:T):void{request.validate?.(value);}
  private key<T>(request:ExecuteStructuredRequest<T>):string{
    return createHash('sha256').update(JSON.stringify({provider:request.provider,model:request.model,system:request.system,prompt:request.prompt,schema:request.schema,promptVersion:request.promptVersion,schemaVersion:request.schemaVersion,temperature:request.temperature,seed:request.seed})).digest('hex');
  }
  private async backoff(attempt:number,signal?:AbortSignal):Promise<void>{
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,Math.min(1000,100*2**(attempt-1)));signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason??new Error('Aborted'));},{once:true});});
  }
}
