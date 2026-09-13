import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {embedTexts,embedEnabled,getOrBuildChunkVectors,embedCachePath} from '../dist/src/explainer/embeddings.js';
import {chunkSource} from '../dist/src/explainer/retrieval.js';

const env={EMBEDDINGS_API_KEY:'test-only'};
function embedFetcher(batches){
  const calls=[];
  let batch=0;
  return {calls,fetcher:async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    if(batch>=batches.length)return new Response('too many',{status:500});
    const vectors=batches[batch++];
    return Response.json({data:vectors.map((v,i)=>({index:i,embedding:v}))});
  }};
}

test('LD4 embedEnabled: no key means disabled, BM25-only path',()=>{
  assert.equal(embedEnabled({}),false);
  assert.equal(embedEnabled(env),true);
});

test('LD4 embedTexts: batches requests, preserves order, fail-soft on provider error',async()=>{
  // 3 texts, batch cap 64 → one request; vectors come back in index order.
  const {calls,fetcher}=embedFetcher([[[0.1,0.2],[0.3,0.4],[0.5,0.6]]]);
  const vectors=await embedTexts(['one','two','three'],{env,fetcher});
  assert.deepEqual(vectors,[[0.1,0.2],[0.3,0.4],[0.5,0.6]]);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].body.input,['one','two','three']);
  // Provider failure → null, never throws.
  const failing={calls:[],fetcher:async()=>new Response('err',{status:503})};
  assert.equal(await embedTexts(['x'],{env,fetcher:failing.fetcher}),null);
  // No key → null without any fetch.
  let noKeyCalls=0;
  const noKey={calls:[],fetcher:async()=>{noKeyCalls++;return new Response('{}',{status:200});}};
  assert.equal(await embedTexts(['x'],{env:{},fetcher:noKey.fetcher}),null);
  assert.equal(noKeyCalls,0);
});

test('LD4 getOrBuildChunkVectors: builds once, caches, rebuilds on stale cache',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'embed-cache-'));
  try{
    const source={kind:'text',label:'t',text:Array.from({length:6},(_,i)=>`Paragraph ${i} with distinct content words ${i}${i} filler padding for chunking size requirements here.`).join('\n\n'),sha256:'sha-l4'};
    const chunks=chunkSource(source,{maxChars:120});
    if(chunks.length<2)throw new Error('test source must chunk into ≥2');
    let fetchCalls=0;
    const fetcher=async()=>{
      fetchCalls++;
      return Response.json({data:chunks.map((_,i)=>({index:i,embedding:[i+1,i]}))});
    };
    const first=await getOrBuildChunkVectors(source,chunks,{env,fetcher,cacheDir:dir});
    assert.equal(fetchCalls,1);
    assert.equal(first.length,chunks.length);
    // Second call: served from cache, zero provider calls.
    const second=await getOrBuildChunkVectors(source,chunks,{env,fetcher,cacheDir:dir});
    assert.equal(fetchCalls,1);
    assert.deepEqual(second,first);
    const saved=JSON.parse(await readFile(embedCachePath(dir,'sha-l4'),'utf8'));
    assert.equal(saved.vectors.length,chunks.length);
    // Stale cache (wrong count) → rebuild.
    await writeFile(embedCachePath(dir,'sha-l4'),JSON.stringify({model:'m',dims:2,vectors:[[1,2]]}));
    const third=await getOrBuildChunkVectors(source,chunks,{env,fetcher,cacheDir:dir});
    assert.equal(fetchCalls,2);
    assert.equal(third.length,chunks.length);
  }finally{await rm(dir,{recursive:true,force:true});}
});
