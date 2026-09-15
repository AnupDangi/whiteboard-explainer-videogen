import type {GateResult,HarnessStage,StageEnvelope,StageOwner,StagePolicy} from './contracts.js';
import {HARNESS_VERSION} from './contracts.js';
import {stableHash} from './state.js';
import {log} from '../../shared/logger.js';
import type {StageJournal} from './journal.js';

/** Bounded, owner-scoped context handed to a stage repair function. */
export interface StageRepairContext<T>{stage:HarnessStage;owner:StageOwner;attempt:0|1;input:unknown;error:Error;gate:GateResult;output?:T;signal:AbortSignal}
export type StageRepair<T>=(context:StageRepairContext<T>)=>Promise<T>|T;

export const DEFAULT_STAGE_POLICIES:Record<HarnessStage,StagePolicy>={
 ingest:{owner:'harness',timeoutMs:30000,maxRepairs:0,budgetUsd:0},
 'knowledge-compiler':{owner:'knowledge-compiler',timeoutMs:600000,maxRepairs:1,budgetUsd:.2},
 'teaching-architect':{owner:'teaching-architect',timeoutMs:90000,maxRepairs:1,budgetUsd:.35},
 'whiteboard-planner':{owner:'whiteboard-planner',timeoutMs:90000,maxRepairs:1,budgetUsd:.25},
 'representation-guide':{owner:'representation-guide',timeoutMs:10000,maxRepairs:0,budgetUsd:0},
 'source-visual-grounding':{owner:'source-visual-grounding',timeoutMs:30000,maxRepairs:1,budgetUsd:.1},
 'visual-director':{owner:'visual-director',timeoutMs:360000,maxRepairs:1,budgetUsd:.3},
 compiler:{owner:'compiler',timeoutMs:30000,maxRepairs:0,budgetUsd:0},
 'tts-alignment':{owner:'speech-layer',timeoutMs:120000,maxRepairs:1,budgetUsd:.2},
 'pedagogy-critic':{owner:'pedagogy-critic',timeoutMs:90000,maxRepairs:1,budgetUsd:.2},
 render:{owner:'renderer',timeoutMs:30000,maxRepairs:0,budgetUsd:0}
};

export interface StageExecuteOptions<T>{stage:HarnessStage;input:unknown;run:(signal:AbortSignal)=>Promise<T>|T;gate:(output:T)=>GateResult;journal?:StageJournal;policy?:StagePolicy;attempt?:0|1;model?:string|(()=>string|undefined);promptHash?:string;skillHash?:string;usage?:()=>{costUsd:number;promptTokens:number;completionTokens:number};repair?:StageRepair<T>;resume?:boolean}

const emptyGate=(stage:HarnessStage):GateResult=>({stage,passed:false,findings:[]});
const gateError=(stage:HarnessStage,gate:GateResult)=>Object.assign(new Error(`${stage} gate failed: ${gate.findings.filter(f=>f.severity==='hard').map(f=>f.code).join(', ')}`),{gate});

/**
 * Runs one stage under its policy. A supplied `repair` grants at most one
 * owner-scoped retry (`policy.maxRepairs`): the failed attempt is journaled, the
 * owner repairs its own output, and the repaired output is re-validated before
 * downstream work continues. Without `repair` behavior is a single attempt.
 * With `resume`, a prior validated journal entry for this exact stage input
 * replays instead of re-running the stage (elapsedMs 0, marked in the journal).
 */
export async function executeStage<T>(options:StageExecuteOptions<T>):Promise<{output:T;envelope:StageEnvelope<T>}>{
 const policy=options.policy??DEFAULT_STAGE_POLICIES[options.stage];
 const inputHash=stableHash(options.input);
 await options.journal?.persistInput?.(options.stage,options.attempt??0,inputHash,options.input);
 if(options.resume&&options.journal?.read){
  const prior=await options.journal.read();
  const match=prior.find(entry=>!('status' in entry)&&entry.stage===options.stage&&entry.inputHash===inputHash&&entry.harnessVersion===HARNESS_VERSION&&entry.skillHash===options.skillHash&&entry.promptHash===options.promptHash) as StageEnvelope<T>|undefined;
  if(match){
   const output=structuredClone(match.output);
   const gate=options.gate(output);
   if(gate.passed){
    const envelope:StageEnvelope<T>={...structuredClone(match),startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),elapsedMs:0,gate};
    await options.journal?.append(envelope as StageEnvelope<unknown>);
    return {output,envelope};
   }
  }
 }
 const maxRepairs=options.repair?policy.maxRepairs:0;
 const model=()=>typeof options.model==='function'?options.model():options.model;
 const appendFailure=async(attempt:0|1,startedAt:string,started:number,gate:GateResult,error:Error)=>{
  log('v2.stage',{stage:options.stage,owner:policy.owner,attempt,status:'FAIL',elapsedMs:Math.round(performance.now()-started),model:model(),gateCodes:gate.findings.map(finding=>finding.code),error:error.message.slice(0,200)},'warn');
  await options.journal?.append({harnessVersion:HARNESS_VERSION,stage:options.stage,owner:policy.owner,attempt,startedAt,finishedAt:new Date().toISOString(),elapsedMs:performance.now()-started,inputHash,status:'FAIL',model:model(),promptHash:options.promptHash,skillHash:options.skillHash,gate,error:{name:error.name,message:error.message}});
 };
 let attempt:0|1=options.attempt??0,hasProduced=false,produced:T|undefined;
 /** Repair failures are journaled like any other failed attempt; without this
  *  wrapper a throwing repair propagated unjournaled and looked like a
  *  single-attempt stage failure, hiding that a repair was attempted. */
 const runRepair=async(error:Error,gate:GateResult,at:0|1)=>{
  const repairStartedAt=new Date().toISOString(),repairStarted=performance.now();
  /** A fresh signal: the failed attempt's controller was aborted before the
   *  repair ran, so reusing it made every thrown-error repair fail instantly. */
  const repairController=new AbortController();
  try{produced=await options.repair!({stage:options.stage,owner:policy.owner,attempt:at,input:options.input,error,gate,output:hasProduced?produced:undefined,signal:repairController.signal});}
  catch(repairError){
   const value=repairError instanceof Error?repairError:new Error(String(repairError));
   await appendFailure(1,repairStartedAt,repairStarted,(repairError as {gate?:GateResult})?.gate??gate,value);
   throw value;
  }
  hasProduced=true;attempt=1;
 };
 for(;;){
  const startedAt=new Date().toISOString(),started=performance.now();
  const controller=new AbortController();
  let output:T;
  if(hasProduced)output=produced as T;
  else{
   let timer:NodeJS.Timeout|undefined;
   try{output=await Promise.race([Promise.resolve().then(()=>options.run(controller.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort(new Error(`${options.stage} exceeded ${policy.timeoutMs}ms`));reject(new Error(`${options.stage} exceeded ${policy.timeoutMs}ms`));},policy.timeoutMs);})]);}
   catch(error){
    if(timer)clearTimeout(timer);
    controller.abort(error);
    const value=error instanceof Error?error:new Error(String(error)),gate=(error as {gate?:GateResult})?.gate??emptyGate(options.stage);
    await appendFailure(attempt,startedAt,started,gate,value);
    if(attempt<maxRepairs){await runRepair(value,gate,attempt);continue;}
    throw error;
   }
   if(timer)clearTimeout(timer);
  }
  const gate=options.gate(output);
  if(!gate.passed){
   const error=gateError(options.stage,gate);
   await appendFailure(attempt,startedAt,started,gate,error);
   if(attempt<maxRepairs){await runRepair(error,gate,attempt);continue;}
   throw error;
  }
  const usage=options.usage?.()??{costUsd:0,promptTokens:0,completionTokens:0};
  const envelope:StageEnvelope<T>={harnessVersion:HARNESS_VERSION,stage:options.stage,owner:policy.owner,attempt,startedAt,finishedAt:new Date().toISOString(),elapsedMs:performance.now()-started,inputHash,outputHash:stableHash(output),model:model(),promptHash:options.promptHash,skillHash:options.skillHash,costUsd:usage.costUsd,promptTokens:usage.promptTokens,completionTokens:usage.completionTokens,gate,output};
  log('v2.stage',{stage:options.stage,owner:policy.owner,attempt,status:'OK',elapsedMs:Math.round(envelope.elapsedMs),model:envelope.model,costUsd:usage.costUsd,promptTokens:usage.promptTokens,completionTokens:usage.completionTokens,skillHash:options.skillHash?.slice(0,12)});
  await options.journal?.append(envelope as StageEnvelope<unknown>);return {output,envelope};
 }
}
