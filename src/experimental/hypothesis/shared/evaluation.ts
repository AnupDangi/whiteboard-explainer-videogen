import {EXPERIMENT,type EvaluationBundle,type GoldenCase,type NeutralElement,type NeutralTimelineEvent,type RunFailure,type RunStatus} from './contracts.js';

const intersects=(a:NeutralElement['bbox'],b:NeutralElement['bbox']):boolean=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;

export function deterministicGates(input:{golden?:GoldenCase;elements:NeutralElement[];timeline:NeutralTimelineEvent[];durationMs:number;svg:string;licenses?:string[]}):RunFailure[]{
  const failures:RunFailure[]=[];
  const ids=new Set<string>();
  for(const element of input.elements){
    if(ids.has(element.id))failures.push({code:'duplicate-element',stage:'schema',message:`Duplicate element ${element.id}`,hard:true});ids.add(element.id);
    const {x,y,w,h}=element.bbox;
    const epsilon = 1e-6; // absorb sub-micro-pixel floating-point layout noise only
    if(w<=0||h<=0||x<EXPERIMENT.safeArea-epsilon||y<EXPERIMENT.safeArea-epsilon||x+w>EXPERIMENT.width-EXPERIMENT.safeArea+epsilon||y+h>EXPERIMENT.height-EXPERIMENT.safeArea+epsilon)failures.push({code:'safe-area',stage:'layout',message:`${element.id} escapes the safe area`,hard:true});
  }
  for(let i=0;i<input.elements.length;i++)for(let j=i+1;j<input.elements.length;j++)if(intersects(input.elements[i].bbox,input.elements[j].bbox))failures.push({code:'overlap',stage:'layout',message:`${input.elements[i].id} overlaps ${input.elements[j].id}`,hard:true});
  for(const event of input.timeline){
    if(!ids.has(event.elementId))failures.push({code:'dangling-event',stage:'timeline',message:`Unknown element ${event.elementId}`,hard:true});
    if(event.startMs<0||event.endMs<event.startMs||event.endMs>input.durationMs)failures.push({code:'timeline-bounds',stage:'timeline',message:`Invalid event bounds for ${event.elementId}`,hard:true});
  }
  if(input.golden&&Math.abs(input.durationMs-input.golden.targetDurationMs)>200)failures.push({code:'av-sync',stage:'timeline',message:`Duration ${input.durationMs}ms differs from ${input.golden.targetDurationMs}ms`,hard:true});
  if(/<script\b|on\w+\s*=|javascript:/i.test(input.svg))failures.push({code:'unsafe-svg',stage:'render',message:'Rendered SVG contains executable content',hard:true});
  if(input.licenses?.some(item=>!['MIT','ISC','Apache-2.0','CC0-1.0','CC-BY-4.0','manual'].includes(item)))failures.push({code:'license',stage:'resolve',message:'Asset license is not allowlisted',hard:true});
  return failures;
}

export interface PublishEvidence { factualEvidenceComplete: boolean; alignmentComplete: boolean }

/** A run is publishable only after an external judge and required evidence/timing gates pass. */
export function deriveRunStatus(hardFailures:number,judgePassed=false,evidence:PublishEvidence={factualEvidenceComplete:false,alignmentComplete:false}):RunStatus{
  if(hardFailures>0)return 'failed';
  if(!judgePassed)return 'draft';
  return evidence.factualEvidenceComplete&&evidence.alignmentComplete?'passed':'failed';
}

export function mechanismCoverage(golden:GoldenCase,bundle:Pick<EvaluationBundle,'claims'|'relations'>):Record<string,number|string>{
  const claimHits=golden.requiredClaims.filter(claim=>bundle.claims.some(item=>item.toLocaleLowerCase().includes(claim.toLocaleLowerCase()))).length;
  const relationHits=golden.requiredRelations.filter(expected=>bundle.relations.some(found=>found.from===expected.from&&found.to===expected.to&&found.type===expected.type)).length;
  const claimCoverage=claimHits/Math.max(1,golden.requiredClaims.length),relationCoverage=relationHits/Math.max(1,golden.requiredRelations.length);
  return {claimCoverage,relationCoverage,mechanismVsList:relationCoverage>=.75?'mechanism':relationCoverage>=.4?'mixed':'list'};
}
