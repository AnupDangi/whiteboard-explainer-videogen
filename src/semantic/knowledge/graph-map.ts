import {assertSchema} from '../schemas.js';
import {mapConcurrent} from '../harness/concurrency.js';
import {skillInstruction} from '../skills.js';
import type {JsonModel} from '../planning/model-adapter.js';
import type {SemanticChunk} from '../source/chunker.js';
import {graphFragmentSchema} from './schema.js';
import type {GraphFragment} from './types.js';

/** Parallel knowledge-map batches (`Architecture_plan.md` §11-12, §64). Related
 *  chunks pack into a small number of concurrent calls — never one call per
 *  chunk. Each call returns a `GraphFragment`; the reducer merges them. */
export interface GraphMapOptions {
  model:JsonModel;
  concurrency?:number;
  language?:string;
  signal?:AbortSignal;
  sessionId?:string;
  /** Test/telemetry hook: run per batch-index. */
  onBatch?:(batchIndex:number,chunkIds:string[])=>void;
}

/** Small: 1 map. Medium: 2. Large: 4. Very large: 8. Derived from chunk count
 *  only, so the call budget is predictable (`Architecture_plan.md` §39). */
export function mapBatchCount(chunkCount:number):number{
  if(chunkCount<=8)return 1;
  if(chunkCount<=16)return 2;
  if(chunkCount<=32)return 4;
  return 8;
}

/** Split document-ordered chunks into `batches` contiguous groups (near-equal). */
export function batchChunks(chunks:SemanticChunk[],batches:number):SemanticChunk[][]{
  const count=Math.max(1,Math.min(batches,chunks.length));
  const groups:SemanticChunk[][]=Array.from({length:count},()=>[]);
  const per=Math.ceil(chunks.length/count);
  chunks.forEach((chunk,index)=>groups[Math.min(count-1,Math.floor(index/per))].push(chunk));
  return groups.filter(group=>group.length);
}

const KNOWLEDGE_INVARIANTS=[
  'Every factual claim and mechanism must reference at least one evidenceRef whose id exists in the evidence list.',
  'Do not invent concepts, mechanisms, numbers or causal directions absent from the supplied chunks.',
  'Preserve quantities exactly as written.',
  'Canonicalize aliases without changing meaning.',
  'No coordinates, no SVG, no executable code, no URLs.',
].join(' ');

function instructions(language:string):string{
  return `You are the knowledge compiler for a whiteboard lesson. Extract the source's concepts, typed relations, claims, mechanisms, prerequisites, terminology and evidence into one GraphFragment. ${KNOWLEDGE_INVARIANTS} ${skillInstruction('knowledge-compiler')} Language: ${language}.`;
}

function normalizeFragment(raw:unknown):GraphFragment{
  const value=(raw??{}) as Partial<GraphFragment>;
  return {
    concepts:Array.isArray(value.concepts)?value.concepts:[],
    relations:Array.isArray(value.relations)?value.relations:[],
    claims:Array.isArray(value.claims)?value.claims:[],
    mechanisms:Array.isArray(value.mechanisms)?value.mechanisms:[],
    prerequisites:Array.isArray(value.prerequisites)?value.prerequisites:[],
    terminology:Array.isArray(value.terminology)?value.terminology:[],
    evidence:Array.isArray(value.evidence)?value.evidence:[],
  };
}

export async function mapChunksToFragments(chunks:SemanticChunk[],objective:string,options:GraphMapOptions):Promise<GraphFragment[]>{
  if(!chunks.length)return [];
  const batches=batchChunks(chunks,mapBatchCount(chunks.length));
  const limit=Math.max(1,Math.min(options.concurrency??batches.length,batches.length));
  return mapConcurrent(batches,limit,async(group,index)=>{
    options.onBatch?.(index,group.map(chunk=>chunk.id));
    const input={objective,chunks:group.map(chunk=>({id:chunk.id,section:chunk.sectionPath.join(' / '),text:chunk.text}))};
    try{
      const result=await options.model.generate('graphMap',instructions(options.language??'en'),input,graphFragmentSchema,(value)=>{assertSchema(value,graphFragmentSchema);return normalizeFragment(value);},{...(options.signal?{signal:options.signal}:{}),...(options.sessionId?{sessionId:options.sessionId}:{})});
      return normalizeFragment(result);
    }catch(error){
      throw new Error(`Graph map batch ${index} failed: ${error instanceof Error?error.message:String(error)}`);
    }
  },options.signal);
}
