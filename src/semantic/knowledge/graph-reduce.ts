import {assertSchema} from '../schemas.js';
import type {JsonModel} from '../planning/model-adapter.js';
import {baseConceptGraphSchema} from './schema.js';
import {reduceFragments,gateBaseGraph} from './reducer.js';
import type {BaseConceptGraph,GraphFragment} from './types.js';

/** One graph-reducer call (`Architecture_plan.md` §13). The model may
 *  canonicalize aliases and deduplicate, but its output is treated as one more
 *  fragment and re-reduced deterministically against the original evidence, so
 *  it can never smuggle in an unsupported claim. On schema failure or a failed
 *  gate the deterministic reducer is the fallback — never a repair loop (§61). */
export interface GraphReduceResult {graph:BaseConceptGraph;usedModel:boolean;reason?:string}

const INSTRUCTIONS=[
  'You are the graph reducer. Deduplicate concepts, canonicalize aliases, merge terminology and mechanisms, build prerequisite edges, preserve every evidence quote, and identify the central concepts and the source thesis.',
  'Never invent concepts, claims, numbers or causal directions. Every claim and mechanism must keep evidenceRefs that exist in the supplied fragments.',
  'No coordinates, no SVG, no executable code, no URLs.',
].join(' ');

export async function runGraphReducer(model:JsonModel,fragments:GraphFragment[],options:{language?:string;signal?:AbortSignal;maxCostUsd?:number}={}):Promise<GraphReduceResult>{
  const deterministic=reduceFragments(fragments);
  try{
    const value=await model.generate('graphReduce',`${INSTRUCTIONS} Language: ${options.language??'en'}.`,{fragments},baseConceptGraphSchema,(output)=>{assertSchema(output,baseConceptGraphSchema);return output;},{...(options.signal?{signal:options.signal}:{})});
    const graph=value as BaseConceptGraph;
    // Model output is one more fragment; the deterministic reducer is the truth.
    const merged=reduceFragments([...fragments,toFragment(graph)]);
    const gate=gateBaseGraph(merged);
    if(!gate.passed)return {graph:deterministic,usedModel:false,reason:gate.findings.join('; ')};
    return {graph:merged,usedModel:true};
  }catch(error){
    return {graph:deterministic,usedModel:false,reason:error instanceof Error?error.message:String(error)};
  }
}

function toFragment(graph:BaseConceptGraph):GraphFragment{
  // Evidence is source-owned: the reducer's evidence is intentionally dropped so
  // a model-authored quote can never become a valid evidenceRef on re-reduce.
  return {concepts:graph.concepts??[],relations:graph.relations??[],claims:graph.claims??[],mechanisms:graph.mechanisms??[],prerequisites:graph.prerequisites??[],terminology:graph.terminology??[],evidence:[]};
}
