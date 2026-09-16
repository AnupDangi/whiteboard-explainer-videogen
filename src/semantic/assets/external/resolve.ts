import type {AssetDefinition} from '../types.js';
import type {VisualArchetype} from '../../types.js';
import {convertSvgToAsset,type ConversionMetadata,type AssetProvenance} from './convert.js';
import {searchCandidates} from './search.js';
import {profileFor} from './policy.js';
import type {IconifyClient} from './iconify.js';
import type {RetrievalMode} from './types.js';

/** Resolve one concept from an external collection.
 *
 *  Bounded and visible: a search is issued once, at most `maxFetches` bodies are
 *  fetched, and every rejection or failure is returned as a warning. Nothing is
 *  retried, nothing is cached here (that is P4), and a total miss returns no
 *  asset rather than a placeholder — the caller keeps its existing fallback. */
export interface ExternalConceptRequest{conceptId:string;query:string;archetypes:VisualArchetype[]}
export interface ExternalResolveOutcome{
 conceptId:string;
 assetId?:string;
 asset?:AssetDefinition;
 conversion?:ConversionMetadata;
 provenance?:AssetProvenance;
 warnings:string[];
 rejected:{collection:string;name:string;reason:string}[];
}
export interface ExternalResolveOptions{
 client:IconifyClient;
 mode:RetrievalMode;
 searchLimit?:number;
 maxFetches?:number;
 curveSegments?:number;
 signal?:AbortSignal;
 /** Supplied by the caller so this function stays free of a clock. */
 fetchedAt:string;
}

const safe=(value:string):string=>value.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');

export async function resolveExternalConcept(request:ExternalConceptRequest,options:ExternalResolveOptions):Promise<ExternalResolveOutcome>{
 const outcome:ExternalResolveOutcome={conceptId:request.conceptId,warnings:[],rejected:[]};
 if(options.mode==='off')return outcome;
 const maxFetches=options.maxFetches??3;
 if(!Number.isInteger(maxFetches)||maxFetches<1||maxFetches>5)throw new Error('maxFetches must be 1-5');
 const query=request.query.trim();
 if(!query)return outcome;

 let hits;
 try{hits=await options.client.search(query,{limit:options.searchLimit??20,...(options.signal?{signal:options.signal}:{})});}
 catch(error){outcome.warnings.push(`external search failed for ${request.conceptId}: ${error instanceof Error?error.message:String(error)}`);return outcome;}

 const ranked=searchCandidates(hits,options.mode,{maxCandidates:maxFetches,query});
 outcome.rejected.push(...ranked.rejected);
 if(!ranked.ranked.length){outcome.warnings.push(`no suitable candidate for ${request.conceptId} (query "${query}")`);return outcome;}

 for(const candidate of ranked.ranked){
  const id=`external.${safe(candidate.collection)}.${safe(candidate.name)}`;
  try{
   const svg=await options.client.fetchSvg({prefix:candidate.collection,name:candidate.name},{...(options.signal?{signal:options.signal}:{})});
   const converted=convertSvgToAsset({
    id,
    svg,
    aliases:[query],
    tags:[query,candidate.collection],
    semanticTypes:['entity'],
    archetypes:request.archetypes,
    provenance:{provider:'iconify',collection:candidate.collection,sourceAssetId:candidate.name,licenseId:profileFor(candidate.collection)!.license.id,fetchedAt:options.fetchedAt},
    ...(options.curveSegments!==undefined?{curveSegments:options.curveSegments}:{}),
   });
   outcome.assetId=id;
   outcome.asset=converted.asset;
   outcome.conversion=converted.conversion;
   outcome.provenance=converted.provenance;
   outcome.warnings.push(...converted.warnings);
   return outcome;
  }catch(error){
   outcome.warnings.push(`candidate ${candidate.collection}:${candidate.name} rejected: ${error instanceof Error?error.message:String(error)}`);
  }
 }
 outcome.warnings.push(`no usable icon for ${request.conceptId} after ${ranked.ranked.length} candidate(s)`);
 return outcome;
}
