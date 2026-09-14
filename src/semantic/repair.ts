export type FailureClass='SEMANTIC'|'REPRESENTATION'|'GEOMETRY'|'TIMING'|'SPEECH'|'PROVIDER';
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
export type RepairOwner='knowledge-compiler'|'teaching-architect'|'whiteboard-planner'|'visual-director'|'semantic-stage'|'representation-resolver'|'compiler'|'timeline'|'speech-layer'|'model-router';
export class PipelineError extends Error {
 constructor(public readonly failureClass:FailureClass,public readonly stage:string,public readonly code:string,message:string,public readonly context:Record<string,unknown>={},public readonly before?:unknown,public readonly after?:unknown){super(message);this.name='PipelineError';}
}
export function stageFailure(error:unknown,stage:string):PipelineError{
 if(error instanceof PipelineError)return error;
 const failureClass:FailureClass=stage==='representation'?'REPRESENTATION':stage==='compile'?'GEOMETRY':stage==='tts'?'SPEECH':stage==='narration-finalize'?'TIMING':/OpenRouter|fetch failed|budget|pricing/i.test(String(error))?'PROVIDER':'SEMANTIC';
 const gate=error&&typeof error==='object'&&'gate' in error?(error as {gate:unknown}).gate:undefined;
 const first=gate&&typeof gate==='object'&&Array.isArray((gate as any).findings)?(gate as any).findings[0]:undefined;
 return new PipelineError(failureClass,stage,first?.code??`${failureClass.toLowerCase()}-failed`,error instanceof Error?error.message:String(error),gate?{gate}:{});
}
export function repairOwner(failure:Pick<RepairFailure,'class'>):RepairOwner{
 switch(failure.class){
  case 'REPRESENTATION':return 'representation-resolver';
  case 'GEOMETRY':return 'compiler';
  case 'TIMING':return 'timeline';
  case 'SPEECH':case 'PROVIDER':return 'speech-layer';
  default:return 'semantic-stage';
 }
}
export function repairOwnerForStage(failure:Pick<RepairFailure,'class'|'stage'>):RepairOwner{
 if(failure.class==='PROVIDER')return 'model-router';if(failure.class!=='SEMANTIC')return repairOwner(failure);
 if(failure.stage.includes('knowledge'))return 'knowledge-compiler';if(failure.stage.includes('teaching'))return 'teaching-architect';if(failure.stage.includes('whiteboard'))return 'whiteboard-planner';if(failure.stage.includes('director')||failure.stage.includes('visual'))return 'visual-director';return 'semantic-stage';
}
export function toRepairFailure(error:unknown,stage:string):RepairFailure{
 const failure=stageFailure(error,stage);
 const base={class:failure.failureClass,stage:failure.stage,code:failure.code,message:failure.message,context:failure.context,before:failure.before,after:failure.after};
 return {...base,provenance:{attempt:0,owner:repairOwnerForStage(base)}};
}
