import {log} from '../shared/logger.js';
import type {SourceDocument} from '../shared/types.js';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {SourceChunk} from './retrieval.js';

/** LD4: key-gated embeddings for hybrid retrieval. Provider-agnostic OpenAI-compatible
 *  endpoint; fully fail-soft — no key, provider error, or a mismatched cache returns
 *  null and the pipeline continues BM25-only (retrievalMode stays visible in the ledger).
 *  Never throws into the job; a degraded-but-honest retrieval beats a hard failure here. */

export interface EmbedIndex { model:string; dims:number; vectors:number[][] }

const BATCH=64;
const TIMEOUT_MS=120000;

export function embedEnabled(env:NodeJS.ProcessEnv):boolean {
  return !!env.EMBEDDINGS_API_KEY;
}

export function embedCachePath(root:string,sha256:string):string {return join(root,`embed-${sha256}.json`);}

/** Batched embedding call. Returns null on any failure (logged, never thrown). */
export async function embedTexts(texts:string[],{env,fetcher=fetch,model}: {env:NodeJS.ProcessEnv;fetcher?:typeof fetch;model?:string}):Promise<number[][]|null> {
  const key=env.EMBEDDINGS_API_KEY;
  if(!key||!texts.length)return null;
  const url=env.EMBEDDINGS_API_URL||'https://api.openai.com/v1/embeddings';
  const modelId=model||env.EMBEDDINGS_MODEL||'text-embedding-3-small';
  const vectors:number[][]=[];
  try{
    for(let i=0;i<texts.length;i+=BATCH){
      const batch=texts.slice(i,i+BATCH);
      const response=await fetcher(url,{method:'POST',signal:AbortSignal.timeout(TIMEOUT_MS),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:modelId,input:batch})});
      if(!response.ok){log('source.embed-failed',{status:response.status,batch:i/BATCH});return null;}
      const data=await response.json() as {data?:Array<{index?:number;embedding?:number[]}>};
      if(!Array.isArray(data.data)||data.data.length!==batch.length){log('source.embed-failed',{reason:'shape mismatch',expected:batch.length,got:data.data?.length});return null;}
      const sorted=[...data.data].sort((a,b)=>(a.index??0)-(b.index??0));
      for(const d of sorted){
        if(!Array.isArray(d.embedding)){log('source.embed-failed',{reason:'missing vector'});return null;}
        vectors.push(d.embedding);
      }
    }
    return vectors;
  }catch(error){log('source.embed-failed',{error:error instanceof Error?error.message:String(error)});return null;}
}

/** Embed all chunks of a source once, cached by sha256 under the jobs root. Vector i
 *  corresponds to chunk i of chunkSource(source) — a stale cache (chunk count changed)
 *  is rebuilt, never trusted. Returns null when disabled/failed; BM25-only continues. */
export async function getOrBuildChunkVectors(source:SourceDocument,chunks:SourceChunk[],{env,fetcher=fetch,cacheDir,signal}: {env:NodeJS.ProcessEnv;fetcher?:typeof fetch;cacheDir?:string;signal?:AbortSignal}):Promise<number[][]|null> {
  if(!embedEnabled(env))return null;
  if(cacheDir){
    try{
      const parsed=JSON.parse(await readFile(embedCachePath(cacheDir,source.sha256),'utf8')) as EmbedIndex;
      if(parsed&&Array.isArray(parsed.vectors)&&parsed.vectors.length===chunks.length&&parsed.vectors.every(v=>Array.isArray(v)))return parsed.vectors;
      log('source.embed-cache-stale',{expected:chunks.length,got:parsed?.vectors?.length});
    }catch{/* no cache yet */}
  }
  const vectors=await embedTexts(chunks.map(c=>c.text),{env,fetcher});
  signal?.throwIfAborted();
  if(!vectors||vectors.length!==chunks.length)return null;
  if(cacheDir){
    const index:EmbedIndex={model:env.EMBEDDINGS_MODEL||'text-embedding-3-small',dims:vectors[0]?.length||0,vectors};
    try{await writeFile(embedCachePath(cacheDir,source.sha256),JSON.stringify(index));}catch{/* cache write is best-effort */}
  }
  return vectors;
}
