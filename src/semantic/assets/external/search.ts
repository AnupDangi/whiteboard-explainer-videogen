import type {CandidateScore,ExternalCandidateMetadata,RetrievalMode} from './types.js';
import {profileFor} from './policy.js';
import {rankCandidates,type RankOptions,type RankOutcome} from './rank.js';
import type {IconifySearchHit} from './iconify.js';

/** Turn provider search hits into ranked candidates. Licences are taken from the
 *  reviewed collection profiles, never from the provider response: the provider
 *  is a source of geometry, not an authority on licensing. A hit from a
 *  collection with no profile is rejected outright. */
export interface SearchOutcome extends RankOutcome{hits:number;unprofiled:number}

export function searchCandidates(hits:IconifySearchHit[],mode:RetrievalMode,options:RankOptions={}):SearchOutcome{
 const metadata:ExternalCandidateMetadata[]=[],rejected:RankOutcome['rejected']=[];
 let unprofiled=0;
 for(const [index,hit] of hits.entries()){
  const profile=profileFor(hit.prefix);
  if(!profile){unprofiled++;rejected.push({collection:hit.prefix,name:hit.name,reason:'unprofiled collection'});continue;}
  metadata.push({
   provider:'iconify',
   collection:hit.prefix,
   name:hit.name,
   licenseId:profile.license.id,
   hasStroke:profile.style.outline,
   hasFill:profile.style.fill,
   duotone:profile.style.duotone,
   ...(profile.style.complexity!==undefined?{partCount:profile.style.complexity}:{}),
   providerRank:index,
  });
 }
 const ranked=rankCandidates(metadata,mode,options);
 return {ranked:ranked.ranked,rejected:[...rejected,...ranked.rejected],hits:hits.length,unprofiled};
}
