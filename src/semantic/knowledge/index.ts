import {log} from '../../shared/logger.js';
import type {SourceDocument} from '../../shared/types.js';
import type {CacheStore} from '../cache/store.js';
import type {JsonModel} from '../planning/model-adapter.js';
import {chunkSourceDocument,type SemanticChunk} from '../source/chunker.js';
import {graphContext,type GraphContext} from '../retrieval/sets.js';
import {mapChunksToFragments} from './graph-map.js';
import {reduceFragments,focusGraph,gateBaseGraph,type GraphGate} from './reducer.js';
import {loadBaseConceptGraph,saveBaseConceptGraph} from './cache.js';
import type {BaseConceptGraph,FocusedConceptGraph,GraphFragment} from './types.js';

/** W2 orchestrator: source → typed chunks → parallel graph maps → one
 *  deterministic reducer → cached `BaseConceptGraph` → lesson-focus graph.
 *  The base graph is built from the WHOLE source so it can be reused across
 *  lessons (`Architecture_plan.md` §14-15); the objective only narrows the
 *  returned focus graph. Model I/O is injected; everything else is pure. */
export interface BuildKnowledgeV3Options {
  doc:SourceDocument;
  objective:string;
  keyPoints?:string[];
  model:JsonModel;
  store?:CacheStore;
  concurrency?:number;
  language?:string;
  signal?:AbortSignal;
  sessionId?:string;
  /** Optional key-gated embedding boundary. Returns one vector per input text. */
  embed?:(texts:string[])=>Promise<number[][]|null>;
}

export interface KnowledgeV3Result {
  base:BaseConceptGraph;
  focus:FocusedConceptGraph;
  fragments:GraphFragment[];
  context:GraphContext;
  chunks:SemanticChunk[];
  cached:boolean;
  gate:GraphGate;
}

export async function buildBaseConceptGraph(options:BuildKnowledgeV3Options):Promise<KnowledgeV3Result>{
  const chunks=chunkSourceDocument(options.doc);

  // Cache first: a hit must not pay embedding latency or a provider call.
  const cached=options.store?await loadBaseConceptGraph(options.store,options.doc.sha256):undefined;
  if(cached){
    const gate=gateBaseGraph(cached);
    if(gate.passed){
      const context=graphContext(chunks,{objective:options.objective,keyPoints:options.keyPoints});
      return {base:cached,focus:focusGraph(cached,options.objective),fragments:[],context,chunks,cached:true,gate};
    }
    log('v3.knowledge-cache-rejected',{sourceId:options.doc.sha256.slice(0,12),findings:gate.findings});
  }

  let vectors:number[][]|undefined,queryVector:number[]|undefined;
  if(options.embed&&chunks.length){
    const embedded=await options.embed([options.objective,...chunks.map(chunk=>chunk.text)]);
    if(embedded&&embedded.length===chunks.length+1){queryVector=embedded[0];vectors=embedded.slice(1);}
    else if(embedded)log('v3.embed-failed',{reason:'vector count mismatch',expected:chunks.length+1,got:embedded.length});
  }
  const context=graphContext(chunks,{objective:options.objective,keyPoints:options.keyPoints,vectors,queryVector});

  // The base graph is source-owned: the graph maps understand the WHOLE source
  // without the lesson objective, so the source cache stays objective-independent
  // and a second lesson with a different focus reuses it (`Architecture_plan.md`
  // §15). The objective only drives retrieval context and the focus graph below.
  const fragments=await mapChunksToFragments(chunks,'Understand the entire source and extract its knowledge graph.',{
    model:options.model,
    ...(options.concurrency!==undefined?{concurrency:options.concurrency}:{}),
    ...(options.language?{language:options.language}:{}),
    ...(options.signal?{signal:options.signal}:{}),
    ...(options.sessionId?{sessionId:options.sessionId}:{}),
  });
  const base=reduceFragments(fragments);
  const gate=gateBaseGraph(base);
  if(!gate.passed)throw new Error(`Knowledge gate failed: ${gate.findings.join('; ')}`);
  if(options.store)await saveBaseConceptGraph(options.store,options.doc.sha256,base);
  return {base,focus:focusGraph(base,options.objective),fragments,context,chunks,cached:false,gate};
}
