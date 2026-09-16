import type {GateResult,HarnessStage,StageOwner} from './harness/contracts.js';
import {STAGE_OWNERS} from './harness/contracts.js';

export type FailureClass='SEMANTIC'|'REPRESENTATION'|'GEOMETRY'|'TIMING'|'SPEECH'|'PROVIDER';
/** One owner vocabulary. `StageOwner` is the canonical set; repair routing, the
 *  harness policy table and the job snapshot all speak it, so a failure can
 *  never be described in one vocabulary and repaired in another. */
export type RepairOwner=StageOwner;
export interface RepairFailure {
  class:FailureClass;
  stage:string;
  code:string;
  message:string;
  context:Record<string,unknown>;
  before?:unknown;
  after?:unknown;
  provenance?:{attempt:number;owner:RepairOwner;inputHash?:string;outputHash?:string};
}
export class PipelineError extends Error {
 constructor(public readonly failureClass:FailureClass,public readonly stage:string,public readonly code:string,message:string,public readonly context:Record<string,unknown>={},public readonly before?:unknown,public readonly after?:unknown){super(message);this.name='PipelineError';}
}
/** A failure raised by a stage that does not own the failed decision. Carrying
 *  it (instead of repairing) is what stops a compiler geometry error from
 *  triggering another visual-director model call. Extends PipelineError so the
 *  original failure class survives `stageFailure` and reaches the job layer. */
export class RoutedStageFailure extends PipelineError {
 constructor(public readonly classification:FailureClassification){
  super(classification.failureClass,classification.gate.stage,classification.code,`${classification.gate.stage} failed and is owned by ${classification.owner}; the running stage cannot repair it`,{gate:classification.gate,routedTo:classification.owner});
  this.name='RoutedStageFailure';
 }
}
export function stageFailure(error:unknown,stage:string):PipelineError{
 if(error instanceof PipelineError)return error;
 const failureClass:FailureClass=stage==='representation'?'REPRESENTATION':stage==='compile'?'GEOMETRY':stage==='tts'?'SPEECH':stage==='narration-finalize'?'TIMING':/OpenRouter|fetch failed|budget|pricing/i.test(String(error))?'PROVIDER':'SEMANTIC';
 const gate=error&&typeof error==='object'&&'gate' in error?(error as {gate:unknown}).gate:undefined;
 const first=gate&&typeof gate==='object'&&Array.isArray((gate as any).findings)?(gate as any).findings[0]:undefined;
 return new PipelineError(failureClass,stage,first?.code??`${failureClass.toLowerCase()}-failed`,error instanceof Error?error.message:String(error),gate?{gate}:{});
}

export interface FailureClassification{owner:StageOwner;code:string;failureClass:FailureClass;gate:GateResult}
/** Which failure class maps to which owner. `SEMANTIC` is deliberately absent:
 *  a semantic failure belongs to whichever stage raised it. */
const OWNER_BY_CLASS:Partial<Record<FailureClass,StageOwner>>={REPRESENTATION:'representation-guide',GEOMETRY:'compiler',TIMING:'speech-layer',SPEECH:'speech-layer',PROVIDER:'harness'};
const emptyGate=(stage:HarnessStage):GateResult=>({stage,passed:false,findings:[]});
const PROVIDER_PATTERN=/OpenRouter|fetch failed|budget|pricing|timed out|aborted due to timeout|TimeoutError|rate limit/i;

/** Decide who owns a failure. Precedence:
 *    1. a gate finding already names the owning stage (gates stamp their own);
 *    2. a typed PipelineError names its class (compile => geometry => compiler);
 *    3. otherwise the running stage owns it.
 *  Rule 3 keeps genuinely stage-owned repairs working (e.g. teaching repairs
 *  executed inside the knowledge stage), so the blast radius is only the
 *  explicitly-classified foreign failures. */
export function classifyFailure(error:unknown,currentStage:HarnessStage,gate?:GateResult):FailureClassification{
 if(error instanceof RoutedStageFailure)return error.classification;
 const attached=gate??(error&&typeof error==='object'&&'gate' in error?(error as {gate?:GateResult}).gate:undefined);
 const resolvedGate=attached??emptyGate(currentStage);
 const decisive=resolvedGate.findings.find(finding=>finding.severity==='hard')??resolvedGate.findings[0];
 if(decisive&&STAGE_OWNERS[decisive.stage])return {owner:STAGE_OWNERS[decisive.stage],code:decisive.code,failureClass:'SEMANTIC',gate:resolvedGate};
 if(error instanceof PipelineError){const owner=OWNER_BY_CLASS[error.failureClass]??STAGE_OWNERS[currentStage];return {owner,code:error.code,failureClass:error.failureClass,gate:resolvedGate};}
 /** A provider/cost failure is not a semantic one: re-asking the model cannot
  *  fix a timeout, a rate limit, a missing route or an exhausted budget, and
  *  the adapter already owns route failover. Routing it keeps the stage repair
  *  for decisions the model actually made. */
 const message=error instanceof Error?error.message:String(error);
 if(PROVIDER_PATTERN.test(message))return {owner:'harness',code:'provider-failed',failureClass:'PROVIDER',gate:resolvedGate};
 return {owner:STAGE_OWNERS[currentStage],code:'stage-failed',failureClass:'SEMANTIC',gate:resolvedGate};
}

/** Legacy shims kept for the existing ownership tests; they now speak the one
 *  canonical `StageOwner` vocabulary. Production routing uses `classifyFailure`.
 *  Audit status is TEST-ONLY and they are a candidate for removal in the
 *  identity/cleanup wave. */
export function repairOwner(failure:Pick<RepairFailure,'class'>):StageOwner{return OWNER_BY_CLASS[failure.class]??'harness';}
export function repairOwnerForStage(failure:Pick<RepairFailure,'class'|'stage'>):StageOwner{
 if(failure.class!=='SEMANTIC')return repairOwner(failure);
 const match=(Object.keys(STAGE_OWNERS) as HarnessStage[]).find(name=>failure.stage===name||failure.stage.includes(name)||name.includes(failure.stage));
 return match?STAGE_OWNERS[match]:'harness';
}
export function toRepairFailure(error:unknown,stage:string):RepairFailure{
 const failure=stageFailure(error,stage);
 const base={class:failure.failureClass,stage:failure.stage,code:failure.code,message:failure.message,context:failure.context,before:failure.before,after:failure.after};
 return {...base,provenance:{attempt:0,owner:repairOwnerForStage(base)}};
}

/** Actionable repair hints: hard gate findings first, else the thrown error's
 *  own message. A stage that threw (compiler/validation error) is still a
 *  failed stage the owner may repair once. */
export function repairHints(context:{error:Error;gate:{findings:{severity:string;code:string;message:string}[]}}):string[]{
 const hard=context.gate.findings.filter(finding=>finding.severity==='hard').map(finding=>`${finding.code}: ${finding.message}`);
 if(hard.length)return hard;
 const message=context.error.message.trim();
 const actionable=message.replace(/^(V2\s+\w+\s+validation exhausted:\s*|.*gate failed:\s*)/,'').trim();
 return actionable?[actionable.slice(0,300)]:[];
}
