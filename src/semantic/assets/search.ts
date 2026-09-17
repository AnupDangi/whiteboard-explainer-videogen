import {ASSETS} from './registry.js';
import type {VisualArchetype} from '../types.js';
export function searchAssets(query:{name:string;tags?:string[];semanticType?:string;archetype:VisualArchetype;styleFamily?:string},limit=8):{id:string;score:number}[]{
 if(!Number.isInteger(limit)||limit<1||limit>12)throw new Error('Asset candidate limit must be 1–12');
 const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const name=normalize(query.name),terms=new Set([name,...name.split(/\s+/),...(query.tags??[]).map(normalize)]);
 /** The archetype is a PREFERENCE, not a gate. 37 of 43 catalog assets declared
  *  two or three layouts, and `cause_effect`, `numbered_steps` and `hierarchy`
  *  appeared on almost none of them, so a search for a `cause_effect` concept
  *  returned nothing at all and every concept fell to a generic composition.
  *  An illustration is geometry with anchors; the compiler draws it in any
  *  layout. Assets that name the queried archetype simply rank higher. */
 return ASSETS.filter(a=>!query.styleFamily||a.styleFamily===query.styleFamily).map(a=>{
  const aliasScore=(a.aliases.some(s=>normalize(s)===name)?100:0)+(a.aliases.some(s=>normalize(s).split(/\s+/).every(t=>terms.has(t)))?40:0);
  const tagHits=a.tags.filter(t=>terms.has(t)).length;
  const archetypeBoost=a.archetypes.includes(query.archetype)?5:0;
  return {id:a.id,aliasScore,tagHits,score:aliasScore+tagHits*10+archetypeBoost+(query.semanticType&&a.semanticTypes.includes(query.semanticType)?2:0)};
 })
 /** A single thematic tag is not a semantic match. The refrigeration parts carry
  *  the tag `cycle`, so "Discovery Loop" scored 10 on that word alone and the
  *  resolver would have drawn a coolant compressor for a machine-learning
  *  concept. Require a real alias hit, or at least two tags. */
 .filter(a=>(a.aliasScore>0||a.tagHits>=2)&&a.score>=10)
 .sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))
 .slice(0,limit)
 .map(({id,score})=>({id,score}));
}
