import type {SourceDocument} from '../../shared/types.js';
import {sourceCacheKey} from '../cache/keys.js';
import type {CacheStore} from '../cache/store.js';

/** Source-tier cache (`Architecture_plan.md` §14, §50). The source document
 *  (parsed blocks included) is deterministic output, so it is cacheable once
 *  parsed; a changed parser/chunker version invalidates it via the key. */
export function loadSourceDocument(store:CacheStore,sourceHash:string):Promise<SourceDocument|undefined>{
  return store.get<SourceDocument>(sourceCacheKey(sourceHash));
}

export async function saveSourceDocument(store:CacheStore,doc:SourceDocument):Promise<void>{
  await store.put(sourceCacheKey(doc.sha256),doc,{validated:true,kind:'source'});
}
