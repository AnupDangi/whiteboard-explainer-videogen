import {assetCandidates} from './visual-director.js';
import {resolveExternalConcept} from '../assets/external/resolve.js';
import {createIconifyClient,type IconifyClient} from '../assets/external/iconify.js';
import type {RetrievalMode} from '../assets/external/types.js';
import type {AssetDefinition} from '../assets/types.js';
import type {ConceptIdentity,SemanticScenePlan} from '../types.js';
import type {VisualModel} from './visual-model.js';
import {log} from '../../shared/logger.js';

/** Optional external representation resolution, layered on top of the
 *  deterministic local tiers.
 *
 *  Only concepts the local resolver could not represent at all are searched for,
 *  the work is bounded by `maxConcepts`, and every external asset lands in the
 *  scene catalog so rendering stays offline. With `VISUAL_ICONS=off` this is a
 *  pure pass-through: no client is constructed and no request is made. */
export interface ExternalRepresentationOptions{
 client?:IconifyClient;
 mode:RetrievalMode;
 fetchedAt:string;
 maxConcepts?:number;
 signal?:AbortSignal;
}
export type CandidateList=ReturnType<typeof assetCandidates>;
export interface RepresentationOutcome{candidates:CandidateList;catalog:Record<string,AssetDefinition>;warnings:string[]}

export const retrievalMode=(raw:string|undefined):RetrievalMode=>{
 const value=(raw??'off').trim().toLowerCase();
 if(value!=='off'&&value!=='strict'&&value!=='balanced'&&value!=='broad')throw new Error('VISUAL_ICONS must be off|strict|balanced|broad');
 return value;
};

export function externalClientFor(mode:RetrievalMode,env:NodeJS.ProcessEnv={}):IconifyClient|undefined{
 if(mode==='off')return undefined;
 return createIconifyClient({...(env.VISUAL_ICONS_BASE_URL?{baseUrl:env.VISUAL_ICONS_BASE_URL}:{})});
}

export async function representationCandidates(
 scene:SemanticScenePlan,
 registry:ConceptIdentity[],
 model:VisualModel,
 options:ExternalRepresentationOptions,
):Promise<RepresentationOutcome>{
 const candidates=assetCandidates(scene,registry,model);
 if(options.mode==='off'||!options.client)return {candidates,catalog:{},warnings:[]};

 const unresolved=candidates.filter(entry=>!entry.candidates.length&&!entry.representation);
 const budget=Math.max(0,Math.min(options.maxConcepts??4,unresolved.length));
 if(budget<unresolved.length)log('v2.icons.budget',{requested:unresolved.length,searched:budget,scenes:scene.id});

 const catalog:Record<string,AssetDefinition>={},warnings:string[]=[];
 for(const entry of unresolved.slice(0,budget)){
  const concept=registry.find(c=>c.id===entry.conceptId);
  if(!concept)continue;
  const outcome=await resolveExternalConcept(
   {conceptId:entry.conceptId,query:concept.canonicalName,archetypes:model.candidateArchetypes},
   {client:options.client,mode:options.mode,fetchedAt:options.fetchedAt,...(options.signal?{signal:options.signal}:{})},
  );
  for(const warning of outcome.warnings)warnings.push(warning);
  if(!outcome.asset||!outcome.assetId)continue;
  catalog[outcome.assetId]=outcome.asset;
  entry.candidates=[{
   id:outcome.asset.id,
   aliases:outcome.asset.aliases,
   anchors:Object.keys(outcome.asset.anchors),
   semanticAnchorAliases:outcome.asset.anchorAliases??{},
   states:Object.keys(outcome.asset.states),
   archetypes:outcome.asset.archetypes,
  }];
  log('v2.icons.resolved',{scene:scene.id,concept:entry.conceptId,asset:outcome.assetId,conversion:outcome.conversion?.conversionType,confidence:outcome.conversion?.confidence});
 }
 return {candidates,catalog,warnings};
}
