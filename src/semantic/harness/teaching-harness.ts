import type {GateResult,HarnessRunManifest,HarnessStage,StageEnvelope,StagePolicy} from './contracts.js';
import {HARNESS_VERSION} from './contracts.js';
import type {StageJournal} from './journal.js';
import {MemoryStageJournal} from './journal.js';
import {executeStage,type StageRepair} from './stage.js';
import {stableHash} from './state.js';

export class TeachingHarness {
 readonly runId:string;
 readonly journal:StageJournal;
 readonly stages:StageEnvelope<unknown>[]=[];
 readonly gates:GateResult[]=[];
 readonly createdAt:string;
 readonly inputHash:string;
 constructor(options:{runId:string;input:unknown;journal?:StageJournal}){this.runId=options.runId;this.journal=options.journal??new MemoryStageJournal();this.createdAt=new Date().toISOString();this.inputHash=stableHash(options.input);}
 async execute<T>(options:{stage:HarnessStage;input:unknown;run:()=>Promise<T>|T;gate:(output:T)=>GateResult;policy?:StagePolicy;attempt?:0|1;model?:string|(()=>string|undefined);promptHash?:string;skillHash?:string;usage?:()=>{costUsd:number;promptTokens:number;completionTokens:number};repair?:StageRepair<T>}){
  const completed=await executeStage({...options,journal:this.journal});this.stages.push(completed.envelope as StageEnvelope<unknown>);this.gates.push(completed.envelope.gate);return completed;
 }
 recordGate(gate:GateResult){this.gates.push(gate);return gate;}
 manifest(metadata:{config:unknown;schema:unknown;assets:unknown;promptSkills:unknown;costUsd?:number;status?:HarnessRunManifest['status']}):HarnessRunManifest{
  return {version:HARNESS_VERSION,runId:this.runId,createdAt:this.createdAt,inputHash:this.inputHash,configHash:stableHash(metadata.config),schemaHash:stableHash(metadata.schema),assetHash:stableHash(metadata.assets),promptSkillHash:stableHash(metadata.promptSkills),stages:[...this.stages],gates:[...this.gates],costUsd:Number((metadata.costUsd??this.stages.reduce((sum,stage)=>sum+stage.costUsd,0)).toFixed(6)),status:metadata.status??(this.gates.every(gate=>gate.passed)?'PASS':'FAIL')};
 }
}
