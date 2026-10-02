import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {RagContentItem} from './content-list.js';

/** Local diagnostic logger (JSON line to stderr). Replaces the retired
 *  src/core/logger.ts dependency; sidecar diagnostics must never pull a
 *  whole app-logging subsystem. */
function log(event: string, fields: Record<string, unknown> = {}, level: 'info' | 'warn' | 'error' = 'info'): void {
  const line = JSON.stringify({at: new Date().toISOString(), level, event, ...fields});
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
}

/** Minimal budget/gateway shapes, structurally compatible with the retired
 *  src/gateway/* contracts. Deep-index only needs reserve/settle/release and
 *  the optional gateway execute wrapper; concrete ledgers live in the
 *  pipeline (pipeline/budgetLedger.ts). */
interface BudgetLedger {
  reserve(jobId: string, reservationId: string, estimatedUsd: number, limitUsd: number): Promise<unknown>;
  settle(jobId: string, reservationId: string, actualUsd: number): Promise<unknown>;
  release(jobId: string, reservationId: string): Promise<unknown>;
}
interface RagGateway {
  execute<T>(request: {jobId: string; taskId: string; operation: 'index' | 'query'; estimatedCostUsd: number; budgetLimitUsd: number; execute: (signal: AbortSignal) => Promise<T>}): Promise<T>;
}

/** RAG-Anything / LightRAG deep-index sidecar bridge. Gated by `RAG_ENGINE=on` AND an
 *  installed `rag-engine/.venv`, so it is inert by default and never blocks READY_FAST.
 *  Failures are visible and non-fatal: callers get `null` and keep the fast index. */

const root=fileURLToPath(new URL('../../../',import.meta.url)); // dist/src/deep-index/ -> repo root

function pythonBin():string{return process.env.RAG_PYTHON||join(root,'rag-engine','.venv','bin','python');}
function serviceScript():string{return join(root,'rag-engine','service.py');}

function deepIndexEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
  if((env.RAG_ENGINE||'').toLowerCase()!=='on')return false;
  return existsSync(pythonBin())&&existsSync(serviceScript());
}

interface DeepIndexResult {ok:boolean;items?:number;docId?:string;error?:string}
interface DeepQueryResult {ok:boolean;answer?:string;error?:string}

/** Verbatim retrieved chunk texts from a retrieval-only query payload.
 *  Walks only known envelope keys (mirrors plan/ragSidecar
 *  mapRagChunksToEvidence), so wrapper envelopes never silently yield an
 *  empty answer. Domain-general: no content vocabulary. */
export function extractDeepQueryChunks(data: unknown): string[] {
  let cursor: unknown = data;
  for (let depth = 0; depth < 5 && cursor && typeof cursor === 'object'; depth += 1) {
    const record = cursor as Record<string, unknown>;
    if (Array.isArray(record.chunks)) {
      const out: string[] = [];
      for (const raw of record.chunks) {
        if (!raw || typeof raw !== 'object') continue;
        const chunk = raw as Record<string, unknown>;
        const text = typeof chunk.content === 'string' ? chunk.content : typeof chunk.text === 'string' ? chunk.text : '';
        if (text.trim()) out.push(text);
      }
      return out;
    }
    cursor = ['data', 'result', 'raw_data', 'rawData'].map((key) => record[key]).find((value) => value && typeof value === 'object');
  }
  return [];
}
interface DeepIndexGatewayContext {
  /** Optional durable budget boundary. The Python sidecar does not expose token
   *  usage, so its reservation is settled at the configured estimate and marked
   *  as estimated in telemetry rather than pretending a provider invoice exists. */
  ledger:BudgetLedger;
  ragGateway?:RagGateway;
  jobId:string;
  budgetLimitUsd:number;
  estimatedCostUsd?:number;
}

function run(command:'check'|'index'|'query',payload:Record<string,unknown>,timeoutMs:number):Promise<Record<string,unknown>|null>{
  return new Promise(resolve=>{
    const child=spawn(pythonBin(),[serviceScript(),command],{stdio:['pipe','pipe','pipe'],env:process.env});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');resolve(null);},timeoutMs);
    child.stdout.on('data',chunk=>{stdout+=String(chunk);});
    child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    child.on('error',error=>{clearTimeout(timer);log('deep-index.error',{command,error:String(error)},'warn');resolve(null);});
    child.on('close',()=>{
      clearTimeout(timer);
      try{resolve(JSON.parse(stdout.trim().split('\n').at(-1)||'{}') as Record<string,unknown>);}
      catch{log('deep-index.bad-json',{command,tail:stderr.slice(-200)},'warn');resolve(null);}
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function deepIndexStatus():Promise<Record<string,unknown>|null>{
  if(!deepIndexEnabled())return null;
  return run('check',{},30000);
}

export async function indexContentList(input:{contentList:RagContentItem[];filePath:string;workingDir:string;docId?:string;gateway?:DeepIndexGatewayContext}):Promise<DeepIndexResult|null>{
  if(!deepIndexEnabled())return null;
  const estimate=Math.max(0,Number(input.gateway?.estimatedCostUsd??process.env.RAG_INDEX_ESTIMATE_USD??0.02));
  const legacyReservationId=input.gateway&&!input.gateway.ragGateway?`deep-index:${input.gateway.jobId}:${input.docId??input.filePath}`:undefined;
  if(input.gateway&&legacyReservationId)await input.gateway.ledger.reserve(input.gateway.jobId,legacyReservationId,estimate,input.gateway.budgetLimitUsd);
  const started=Date.now();
  try{
    const {gateway:_,...payload}=input;
    const execute=()=>run('index',payload as unknown as Record<string,unknown>,Number(process.env.RAG_INDEX_TIMEOUT_MS||600000));
    const guarded=async()=>{const value=await execute();if(!value||value.ok!==true)throw new Error(String(value?.error??'RAG index sidecar returned no response'));return value;};
    const result=input.gateway?.ragGateway
      ?await input.gateway.ragGateway.execute({jobId:input.gateway.jobId,taskId:`${input.gateway.jobId}:${input.docId??input.filePath}`,operation:'index',estimatedCostUsd:estimate,budgetLimitUsd:input.gateway.budgetLimitUsd,execute:async()=>guarded()})
      :await execute();
    if(!result||result.ok!==true){
      if(input.gateway&&legacyReservationId)await input.gateway.ledger.release(input.gateway.jobId,legacyReservationId);
      log('deep-index.index-failed',{error:result?.error,elapsedMs:Date.now()-started},'warn');
      return result?{ok:false,error:String(result.error)}:null;
    }
    // The sidecar currently returns no token/cost usage. Settling at the bounded
    // estimate is conservative and keeps the durable ledger honest about paid work.
    if(input.gateway&&legacyReservationId){
      await input.gateway.ledger.settle(input.gateway.jobId,legacyReservationId,estimate);
      log('gateway.deep-index',{jobId:input.gateway.jobId,provider:'rag-anything',label:'deep-index',estimatedCostUsd:estimate,actualCostUsd:estimate,costEstimated:true,elapsedMs:Date.now()-started,items:Number(result.items)||input.contentList.length});
    }
    return {ok:true,items:Number(result.items)||input.contentList.length,...(input.docId?{docId:input.docId}:{})};
  }catch(error){
    if(input.gateway?.ragGateway){
      log('deep-index.gateway-failed',{error:error instanceof Error?error.message:String(error),elapsedMs:Date.now()-started},'warn');
      return {ok:false,error:error instanceof Error?error.message:String(error)};
    }
    if(input.gateway&&legacyReservationId)await input.gateway.ledger.release(input.gateway.jobId,legacyReservationId).catch(()=>undefined);
    throw error;
  }
}

export async function queryDeep(input:{workingDir:string;question:string;mode?:string;gateway?:DeepIndexGatewayContext}):Promise<DeepQueryResult|null>{
  if(!deepIndexEnabled())return null;
  const {gateway:_,...payload}=input;
  const estimate=Math.max(0,Number(input.gateway?.estimatedCostUsd??(process.env.RAG_QUERY_ESTIMATE_USD||'0.01')));
  const execute=()=>run('query',payload as unknown as Record<string,unknown>,Number(process.env.RAG_QUERY_TIMEOUT_MS||120000));
  const guarded=async()=>{const value=await execute();if(!value||value.ok!==true)throw new Error(String(value?.error??'RAG query sidecar returned no response'));return value;};
  const result=input.gateway?.ragGateway
    ?await input.gateway.ragGateway.execute({jobId:input.gateway.jobId,taskId:`${input.gateway.jobId}:query`,operation:'query',estimatedCostUsd:estimate,budgetLimitUsd:input.gateway.budgetLimitUsd,execute:async()=>guarded()})
    :await execute();
  if(!result||result.ok!==true)return result?{ok:false,error:String(result.error)}:null;
  // The query sidecar returns retrieval data ({data} with chunks), never an
  // answer string. Map chunk texts (like plan/ragSidecar does) instead of
  // reading a field the service never sends, which always yielded ''.
  if(typeof result.answer === 'string' && result.answer.trim())return {ok:true,answer:String(result.answer)};
  return {ok:true,answer:extractDeepQueryChunks(result.data ?? result).join('\n\n')};
}
