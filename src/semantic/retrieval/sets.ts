import type {SemanticChunk} from '../source/chunker.js';
import {buildBm25Index,rankChunks,words,type Bm25Index} from './bm25.js';

/** Coverage and Focus sets (`Architecture_plan.md` §8-10). Coverage guarantees
 *  every meaningful source section is represented; Focus personalizes top-K by
 *  the query. GraphContext is their union, so personalization cannot delete
 *  important source context. Pure and deterministic. */
export interface RetrievalQuery {
  objective:string;
  keyPoints?:string[];
  vectors?:number[][];
  queryVector?:number[];
  topK?:number;
}

export interface RankedChunkRef {id:string; score:number}
export interface GraphContext {
  coverage:SemanticChunk[];
  focus:SemanticChunk[];
  chunks:SemanticChunk[];
  coverageIds:string[];
  focusIds:string[];
}

export function buildIndex(chunks:SemanticChunk[]):Bm25Index{return buildBm25Index(chunks);}

/** One representative chunk per top-level section, in document order. A source
 *  with no headings yields its first chunk as the sole representative. */
export function coverageSet(chunks:SemanticChunk[]):SemanticChunk[]{
  const seen=new Set<string>();
  const picked:SemanticChunk[]=[];
  for(const chunk of [...chunks].sort((a,b)=>a.start-b.start)){
    const section=chunk.sectionPath[0]??'__root__';
    if(seen.has(section))continue;
    seen.add(section);
    picked.push(chunk);
  }
  return picked;
}

export function focusSet(index:Bm25Index,query:RetrievalQuery):SemanticChunk[]{
  const terms=[...new Set([...words(query.objective),...(query.keyPoints??[]).flatMap(point=>words(point))])];
  const topK=query.topK??25;
  if(!terms.length&&!(query.vectors&&query.queryVector))return [];
  return rankChunks(index,terms,query.vectors,query.queryVector).slice(0,topK).map(entry=>entry.chunk);
}

export function graphContext(chunks:SemanticChunk[],query:RetrievalQuery):GraphContext{
  const index=buildIndex(chunks);
  const coverage=coverageSet(chunks);
  const focus=focusSet(index,query);
  const byId=new Map<string,SemanticChunk>();
  for(const chunk of [...coverage,...focus])byId.set(chunk.id,chunk);
  const union=[...byId.values()].sort((a,b)=>a.start-b.start);
  return {coverage,focus,chunks:union,coverageIds:coverage.map(c=>c.id),focusIds:focus.map(c=>c.id)};
}
