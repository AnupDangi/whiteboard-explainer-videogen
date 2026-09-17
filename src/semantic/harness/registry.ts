import type {CompiledSceneV2,VisualSceneV2} from '../types.js';
import {log} from '../../shared/logger.js';
import type {ConceptGraph,SemanticRegistryEntry,SemanticRegistrySnapshot} from './contracts.js';
import {normalizeSemanticKey} from '../identity/types.js';

/** Lesson-wide semantic identity. Scene-local runtime ids are instances only. */
export class LessonSemanticRegistry{
 private entries=new Map<string,SemanticRegistryEntry>();private aliases=new Map<string,string>();
 constructor(graph:ConceptGraph){for(const concept of graph.concepts){const entry={semanticKey:concept.id,canonicalName:concept.canonicalName,aliases:[...concept.aliases],persistentId:`concept:${concept.id}`,representationFamily:concept.visualFamily,colorRole:concept.preferredColorRole,semanticParts:[],sceneInstances:[]} satisfies SemanticRegistryEntry;this.entries.set(concept.id,entry);for(const alias of [concept.id,concept.canonicalName,...concept.aliases]){const normalized=normalizeSemanticKey(alias),existing=this.aliases.get(normalized);if(existing&&existing!==concept.id)throw new Error(`Ambiguous canonical concept alias: ${alias}`);this.aliases.set(normalized,concept.id);}}}
 canonicalKey(value:string):string{const normalized=normalizeSemanticKey(value),key=this.aliases.get(normalized)??normalized;if(!this.entries.has(key))throw new Error(`Unknown canonical concept: ${value}`);return key;}
  observeScene(scene:VisualSceneV2,compiled?:CompiledSceneV2):void{
   for(const object of scene.objects){if(!object.conceptId)continue;const key=this.canonicalKey(object.conceptId),entry=this.entries.get(key)!;const existing=entry.sceneInstances.find(i=>i.sceneId===scene.id&&i.objectId===object.id);if(!existing)entry.sceneInstances.push({sceneId:scene.id,objectId:object.id});const family=object.representation?.family??object.assetRef??object.primitiveRef;
   /** The constructor seeds representationFamily from the graph's preferred
    *  visualFamily; that preference is not an established observation. The
    *  first scene presenting the concept establishes the real family without
    *  needing a transition — persistence only binds after establishment. */
   const established=entry.sceneInstances.length>1;
   const unexplained=established&&entry.representationFamily&&family&&entry.representationFamily!==family&&!scene.continuity.transitions?.some(t=>t.conceptId===key&&['REPLACE','TRANSFORM'].includes(t.action));
   /** A representation that changes without a declared transition is drift worth
    *  recording, but it is the director's bookkeeping, not a reason to lose a
    *  twenty-minute lesson whose earlier scenes are already paid for. Measured:
    *  `Persistent representation changed without transition: memory-bandwidth`
    *  after two scenes had been produced. The new family is adopted, logged. */
   if(unexplained)log('v2.registry.representation-drift',{concept:key,from:entry.representationFamily,to:family,scene:scene.id},'warn');
   if(family)entry.representationFamily=family;entry.state=object.state;if(compiled){const resolved=compiled.objects.find(o=>o.id===object.id);if(resolved)entry.semanticParts=[...new Set([...entry.semanticParts,...Object.keys(resolved.anchors)])];}}
  }
 snapshot():SemanticRegistrySnapshot{return {version:1,entries:[...this.entries.values()].map(e=>structuredClone(e)).sort((a,b)=>a.semanticKey.localeCompare(b.semanticKey))};}
}
