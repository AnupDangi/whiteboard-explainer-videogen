import {assertSchema,type Schema} from '../schemas.js';
import {normalizeSemanticKey} from '../identity/types.js';
import type {ConceptGraph,KnowledgeClaim} from '../harness/contracts.js';
import type {JsonModel} from './model-adapter.js';
import type {KnowledgePromptOptions} from './prompt-builder.js';
import {knowledgePrompt} from './prompt-builder.js';
import type {SourceFigure} from '../../shared/types.js';

/** Model-facing knowledge contract. No beats, narration, geometry, IDs, code. */
const str=(maxLength:number):Schema=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
const id:Schema={type:'string',minLength:1,maxLength:64,pattern:'^[a-z][a-z0-9_-]*$'};
 const arr=(items:Schema,maxItems=32,minItems=0):Schema=>({type:'array',items,minItems,maxItems});
const en=(values:readonly string[]):Schema=>({type:'string',enum:values});
const obj=(properties:Record<string,Schema>,optional:string[]=[]):Schema=>({type:'object',properties,required:Object.keys(properties).filter(k=>!optional.includes(k)),additionalProperties:false});
const SEMANTIC_TYPES=['entity','material','process','state','quantity','equation','location','role'] as const;
const concept=obj({key:id,canonicalName:str(120),aliases:arr(str(120),12),semanticType:en(SEMANTIC_TYPES),visualFamily:str(80),evidenceRefs:arr(id)},['visualFamily','evidenceRefs','aliases']);
const prerequisite=obj({before:id,after:id,reason:str(300)});
const mechanism=obj({id,statement:str(1000),conceptIds:arr(id,16,1),requiresStateChange:{type:'boolean'},evidenceRefs:arr(id)});
const claim=obj({id,statement:str(1000),critical:{type:'boolean'},evidenceRefs:arr(id)});
const quantity=obj({conceptKey:id,value:str(120),evidenceRefs:arr(id)});
const terminologyEntry=obj({key:id,definition:str(600)});
const evidence=obj({id,sourceId:str(120),quote:str(3000),section:str(120)},['sourceId','section']);
export const knowledgeGraphSchema=obj({
 version:{type:'integer',enum:[1]},
 concepts:arr(concept,64,1),
 prerequisites:arr(prerequisite,120),
 mechanisms:arr(mechanism,32),
 claims:arr(claim,64),
 quantities:arr(quantity,48),
 terminology:arr(terminologyEntry,64),
 evidence:arr(evidence,100)
});

export interface KnowledgeInput {prompt:string;sourceText:string;sourceId?:string;language?:string;repairFindings?:string[]}

/** Deterministic alias merge first; ambiguity, cycles, orphans and fabricated evidence reject. */
export function validateKnowledge(raw:unknown,sourceText:string):ConceptGraph{
 assertSchema(raw,knowledgeGraphSchema);
 const value=structuredClone(raw) as {concepts:{key:string;canonicalName:string;aliases:string[];semanticType:ConceptGraph['concepts'][number]['semanticType'];visualFamily?:string;evidenceRefs:string[]}[];prerequisites:{before:string;after:string;reason:string}[];mechanisms:ConceptGraph['mechanisms'];claims:{id:string;statement:string;critical:boolean;evidenceRefs:string[]}[];quantities:{conceptKey:string;value:string;evidenceRefs:string[]}[];terminology:{key:string;definition:string}[];evidence:{id:string;sourceId?:string;quote:string;section?:string}[]};
 const concepts:ConceptGraph['concepts']=value.concepts.map(c=>({id:c.key,canonicalName:c.canonicalName,aliases:[...c.aliases],semanticType:c.semanticType,visualFamily:c.visualFamily,preferredColorRole:undefined,evidenceRefs:[...new Set(c.evidenceRefs)]}));
 const aliases:Record<string,string>={};
 for(const concept of concepts)for(const alias of [concept.id,concept.canonicalName,...concept.aliases]){
  const normalized=normalizeSemanticKey(alias),existing=aliases[normalized];
  if(existing&&existing!==concept.id)throw new Error(`Alias fork: "${alias}" maps to both ${existing} and ${concept.id}`);
  aliases[normalized]=concept.id;
 }
 const keys=new Set(concepts.map(c=>c.id));
 for(const edge of value.prerequisites)if(!keys.has(edge.before)||!keys.has(edge.after)||edge.before===edge.after)throw new Error(`Invalid prerequisite edge: ${JSON.stringify(edge)}`);
 const outgoing=new Map<string,string[]>();
 for(const edge of value.prerequisites)outgoing.set(edge.before,[...(outgoing.get(edge.before)??[]),edge.after]);
 const visiting=new Set<string>(),visited=new Set<string>();
 const visit=(key:string):boolean=>{if(visiting.has(key))return true;if(visited.has(key))return false;visiting.add(key);if((outgoing.get(key)??[]).some(visit))return true;visiting.delete(key);visited.add(key);return false;};
 if([...keys].some(visit))throw new Error('Prerequisite graph contains a cycle');
 const evidenceIds=new Set(value.evidence.map(e=>e.id));
 for(const item of value.evidence)if(!item.quote.trim())throw new Error(`Evidence ${item.id} is empty`);
 for(const claim of value.claims)if(!claim.evidenceRefs.length)throw new Error(`Claim ${claim.id} has no verbatim evidence`);
 for(const item of [...value.claims,...value.mechanisms,...value.quantities])for(const ref of item.evidenceRefs)if(!evidenceIds.has(ref))throw new Error(`Unknown evidence ${ref}`);
 for(const mechanism of value.mechanisms)for(const conceptId of mechanism.conceptIds)if(!keys.has(conceptId))throw new Error(`Unknown concept in mechanism ${mechanism.id}: ${conceptId}`);
 for(const quantity of value.quantities)if(!keys.has(quantity.conceptKey))throw new Error(`Unknown quantity concept: ${quantity.conceptKey}`);
 for(const term of value.terminology)if(!keys.has(term.key))throw new Error(`Unknown terminology key: ${term.key}`);
 for(const item of value.evidence)if(sourceText&&!sourceText.includes(item.quote))throw new Error(`Fabricated evidence: ${item.id}`);
 const graph:ConceptGraph={version:1,concepts,aliases,prerequisites:value.prerequisites.filter((edge,index,all)=>all.findIndex(other=>other.before===edge.before&&other.after===edge.after)===index),mechanisms:value.mechanisms.map(m=>({...m,conceptIds:[...new Set(m.conceptIds)],evidenceRefs:[...new Set(m.evidenceRefs)]})),claims:value.claims.map(c=>({id:c.id,statement:c.statement,critical:c.critical,evidenceRefs:[...new Set(c.evidenceRefs)]})) satisfies KnowledgeClaim[] as KnowledgeClaim[],terminology:Object.fromEntries(value.terminology.map(t=>[t.key,{definition:t.definition}])),quantities:value.quantities.map(q=>({conceptId:q.conceptKey,value:q.value,evidenceRefs:[...new Set(q.evidenceRefs)]})),evidence:value.evidence.map(e=>({id:e.id,sourceId:e.sourceId??'source',quote:e.quote,section:e.section})),sourceVisuals:[]};
 return graph;
}

export function attachSourceVisuals(graph:ConceptGraph,figures:SourceFigure[]|undefined,sourceId?:string):ConceptGraph{
 if(graph.sourceVisuals.length||!figures?.length)return graph;
 graph.sourceVisuals=figures.map((figure,index)=>({id:`source-visual:${index+1}`,sourceId:sourceId??'source',page:figure.page,caption:figure.caption,provenance:`source-${figure.kind}`}));
 return graph;
}

/** The real knowledge-compiler stage: one source-grounded model call, validated deterministically. */
export async function compileKnowledge(input:KnowledgeInput,model:JsonModel,promptOptions:KnowledgePromptOptions={}):Promise<ConceptGraph>{
 if(!input.sourceText?.trim())throw new Error('Knowledge compilation requires source text');
 const value=await model.generate('knowledge',knowledgePrompt({language:input.language,repairNotes:input.repairFindings,...promptOptions}),{prompt:input.prompt,sourceId:input.sourceId??'source',sourceText:input.sourceText},knowledgeGraphSchema,raw=>validateKnowledge(raw,input.sourceText));
 return value as ConceptGraph;
}
