import type {CandidateScore,ExternalCandidateMetadata,RetrievalMode} from './types.js';
import {licensePolicy} from './license.js';
import {collectionsFor,profileFor} from './policy.js';

/** Deterministic candidate ranking. No randomness, no clock, no I/O: the same
 *  candidates and mode always produce the same order, so a retrieval run is
 *  reproducible and its outcome can be asserted in a test. */
export interface RankOutcome{
 ranked:CandidateScore[];
 rejected:{collection:string;name:string;reason:string}[];
}
export interface RankOptions{maxCandidates?:number}

function score(meta:ExternalCandidateMetadata,order:string[]):CandidateScore{
 const reasons:string[]=[];
 let value=100;
 const policy=licensePolicy(meta.licenseId);
 const profile=profileFor(meta.collection);
 if(!profile){value-=25;reasons.push('unprofiled collection');}
 else if(profile.license.policy!==policy){value-=10;reasons.push('licence differs from the collection profile');}
 if(policy==='attribution'){value-=5;reasons.push('attribution required');}
 if(meta.hasStroke&&!meta.hasFill){value+=20;reasons.push('stroke-native');}
 else if(meta.hasFill&&!meta.hasStroke){value-=15;reasons.push('fill-only');}
 else if(meta.hasStroke&&meta.hasFill){value+=5;reasons.push('mixed stroke and fill');}
 if(meta.duotone){value-=10;reasons.push('duotone');}
 if(meta.partCount!==undefined){
  if(meta.partCount>40){value-=15;reasons.push('very complex');}
  else if(meta.partCount>20){value-=5;reasons.push('complex');}
 }
 const index=order.indexOf(meta.collection);
 if(index>=0){const bonus=Math.max(0,10-index);if(bonus){value+=bonus;reasons.push('preferred collection');}}
 return {collection:meta.collection,name:meta.name,score:value,reasons};
}

export function rankCandidates(candidates:ExternalCandidateMetadata[],mode:RetrievalMode,options:RankOptions={}):RankOutcome{
 const maxCandidates=options.maxCandidates??12;
 if(!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>50)throw new Error('maxCandidates must be 1-50');
 const order=collectionsFor(mode),allowed=new Set(order);
 const ranked:CandidateScore[]=[],rejected:RankOutcome['rejected']=[];
 for(const meta of candidates){
  if(mode==='off'){rejected.push({collection:meta.collection,name:meta.name,reason:'external retrieval is disabled'});continue;}
  const policy=licensePolicy(meta.licenseId);
  if(policy==='blocked'){rejected.push({collection:meta.collection,name:meta.name,reason:`licence not permitted: ${meta.licenseId||'(empty)'}`});continue;}
  if(!allowed.has(meta.collection)){rejected.push({collection:meta.collection,name:meta.name,reason:`collection not permitted in ${mode} mode`});continue;}
  ranked.push(score(meta,order));
 }
 ranked.sort((a,b)=>b.score-a.score||a.collection.localeCompare(b.collection)||a.name.localeCompare(b.name));
 rejected.sort((a,b)=>a.collection.localeCompare(b.collection)||a.name.localeCompare(b.name));
 return {ranked:ranked.slice(0,maxCandidates),rejected};
}
