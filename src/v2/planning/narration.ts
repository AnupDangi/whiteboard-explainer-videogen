import type {SemanticScenePlan,VisualSceneV2} from '../types.js';
import {getAsset} from '../assets/registry.js';
/** Reuse validated beat prose; no independent fact-generating call. Freeze only after direction is feasible. */
export function finalizeNarration(semantic:SemanticScenePlan,visual:VisualSceneV2):Readonly<{text:string;beats:readonly Readonly<{id:string;text:string}>[]}>{
 for(const o of visual.objects)if(o.assetRef)getAsset(o.assetRef);
 const beats=semantic.beats.map(b=>{const v=visual.beats.find(v=>v.id===b.id);if(!v||!v.actions.length||v.narration!==b.narrationDraft)throw new Error(`Narration/visual mismatch: ${b.id}`);return Object.freeze({id:b.id,text:b.narrationDraft});});
 return Object.freeze({text:beats.map(b=>b.text).join(' '),beats:Object.freeze(beats)});
}
