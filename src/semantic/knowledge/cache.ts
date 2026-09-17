import {log} from '../../shared/logger.js';
import {assertSchema} from '../schemas.js';
import {sourceCacheKey} from '../cache/keys.js';
import type {CacheStore} from '../cache/store.js';
import {gateBaseGraph} from './reducer.js';
import {baseConceptGraphSchema} from './schema.js';
import type {BaseConceptGraph} from './types.js';

/** BaseConceptGraph belongs to the source, not the lesson (`Architecture_plan.md`
 *  §14-15). Cached only after the knowledge gate and shape check pass (§51). */
export async function loadBaseConceptGraph(store:CacheStore,sourceHash:string):Promise<BaseConceptGraph|undefined>{
  const value=await store.get<BaseConceptGraph>(sourceCacheKey(sourceHash));
  if(!value)return undefined;
  try{
    assertSchema(value,baseConceptGraphSchema);
    return value;
  }catch(error){
    log('v3.knowledge-cache-invalid',{sourceId:sourceHash.slice(0,12),error:error instanceof Error?error.message:String(error)},'warn');
    return undefined;
  }
}

export async function saveBaseConceptGraph(store:CacheStore,sourceHash:string,graph:BaseConceptGraph):Promise<void>{
  const gate=gateBaseGraph(graph);
  if(!gate.passed)throw new Error(`Refusing to cache a knowledge graph that failed its gate: ${gate.findings.join('; ')}`);
  assertSchema(graph,baseConceptGraphSchema);
  await store.put(sourceCacheKey(sourceHash),graph,{validated:true,kind:'base-concept-graph'});
}
