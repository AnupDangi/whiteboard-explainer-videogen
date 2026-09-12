import {ASSETS} from './registry.js';
import type {VisualArchetype} from '../types.js';
export function searchAssets(query:{name:string;tags?:string[];semanticType?:string;archetype:VisualArchetype;styleFamily?:string},limit=8):{id:string;score:number}[]{
 if(!Number.isInteger(limit)||limit<1||limit>12)throw new Error('Asset candidate limit must be 1–12');
 const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const name=normalize(query.name),terms=new Set([name,...name.split(/\s+/),...(query.tags??[]).map(normalize)]);
 return ASSETS.filter(a=>a.archetypes.includes(query.archetype)&&(!query.styleFamily||a.styleFamily===query.styleFamily)).map(a=>({id:a.id,score:(a.aliases.some(s=>normalize(s)===name)?100:0)+(a.aliases.some(s=>normalize(s).split(/\s+/).every(t=>terms.has(t)))?40:0)+a.tags.filter(t=>terms.has(t)).length*10+(query.semanticType&&a.semanticTypes.includes(query.semanticType)?2:0)})).filter(a=>a.score>=10).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
}
