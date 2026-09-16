import {assertSchema,type Schema} from '../schemas.js';
import {normalizeSemanticKey} from '../identity/types.js';
import {log} from '../../shared/logger.js';
import type {ConceptGraph,KnowledgeClaim} from '../harness/contracts.js';
import type {TeachingPlanV2} from '../types.js';
import {validateTeachingPlan} from './validate.js';
import type {JsonModel} from './model-adapter.js';
import type {KnowledgePromptOptions} from './prompt-builder.js';
import {knowledgePrompt} from './prompt-builder.js';
import type {SourceFigure} from '../../shared/types.js';
import {skillDocInstruction} from '../skills.js';

/** Model-facing knowledge contract. No beats, narration, geometry, IDs, code. */
const str=(maxLength:number):Schema=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
const id:Schema={type:'string',minLength:1,maxLength:64,pattern:'^[a-z][a-z0-9_-]*$'};
 const arr=(items:Schema,maxItems=32,minItems=0):Schema=>({type:'array',items,minItems,maxItems});
const en=(values:readonly string[]):Schema=>({type:'string',enum:values});
const obj=(properties:Record<string,Schema>,optional:string[]=[]):Schema=>({type:'object',properties,required:Object.keys(properties).filter(k=>!optional.includes(k)),additionalProperties:false});
const SEMANTIC_TYPES=['entity','material','process','state','quantity','equation','location','role'] as const;
const concept=obj({key:id,canonicalName:str(120),aliases:arr(str(120),12),semanticType:en(SEMANTIC_TYPES),visualFamily:str(80),evidenceRefs:arr(id)},['visualFamily','evidenceRefs','aliases']);
const prerequisite=obj({before:id,after:id,reason:str(160)},['reason']);
const mechanism=obj({id,statement:str(400),conceptIds:arr(id,16,1),requiresStateChange:{type:'boolean'},evidenceRefs:arr(id)});
const claim=obj({id,statement:str(400),critical:{type:'boolean'},evidenceRefs:arr(id)});
const quantity=obj({conceptKey:id,value:str(120),evidenceRefs:arr(id)});
const terminologyEntry=obj({key:id,definition:str(200)});
const evidence=obj({id,sourceId:str(120),quote:str(600),section:{type:'string',maxLength:120}},['sourceId','section']);
export const knowledgeGraphSchema=obj({
 version:{type:'integer',enum:[1]},
 concepts:arr(concept,32,1),
 prerequisites:arr(prerequisite,48),
 mechanisms:arr(mechanism,16),
 claims:arr(claim,24),
 quantities:arr(quantity,12),
 terminology:arr(terminologyEntry,24),
 evidence:arr(evidence,24)
});

const evidenceTokens=(text:string):string[]=>normalizeEvidence(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu)??[];
/** Nearest source sentence that covers most of a paraphrase. Never invents text:
 *  the replacement is copied character-for-character from the source. */
/** Per-source snapshot: tokenizing a 105k-character source for every candidate
 *  quote was the dominant validation cost; one WeakMap entry per source makes
 *  repeated evidence checks near-free. */
const sourceSnapshotCache=new Map<string,{sentences:string[];frequencies:Map<string,number>}>();
function sourceSnapshot(sourceText:string){
 let snapshot=sourceSnapshotCache.get(sourceText);
 if(snapshot)return snapshot;
 const sentences=sourceText.split(/(?<=[.!?;])\s+/);
 const frequencies=new Map<string,number>();
 for(const token of evidenceTokens(sourceText))frequencies.set(token,(frequencies.get(token)??0)+1);
 snapshot={sentences,frequencies};
 if(sourceSnapshotCache.size>50)sourceSnapshotCache.delete(sourceSnapshotCache.keys().next().value as string);
 sourceSnapshotCache.set(sourceText,snapshot);
 return snapshot;
}
/** Snap a paraphrase to the exact raw source sentence it covers. Scores the
 *  RAW sentences directly (normalization is per-sentence), so the replacement
 *  is always a character-for-character source substring and index alignment
 *  cannot break when PDF artifacts precede sentence punctuation. */
export function snapQuoteToSource(sourceText:string,quote:string):string|null{
 const quoteTokens=evidenceTokens(quote);
 if(quoteTokens.length<3)return null;
 const unique=new Set(quoteTokens);
 const snapshot=sourceSnapshot(sourceText);const sentences=snapshot.sentences;const frequencies=snapshot.frequencies;
  let best:{index:number;score:number}|null=null;
 for(let i=0;i<sentences.length;i++){
  const normalized=normalizeEvidence(sentences[i]);
  if(normalized.length>Math.max(400,quote.length*3))continue;
  const sentenceTokens=new Set(evidenceTokens(normalized));
  let hit=0;for(const token of unique)if(sentenceTokens.has(token))hit+=1;
  const score=hit/unique.size;
  const distinctive=[...unique].some(token=>sentenceTokens.has(token)&&(frequencies.get(token)??0)<=5);
  if(score>=0.6&&distinctive&&(!best||score>best.score))best={index:i,score};
 }
 if(!best)return null;
 return sentences[best.index]??null;
}
/** Ground model-invented evidence ids: a plan evidence entry whose (already
 *  snapped) quote matches a compiled inventory entry verbatim maps to that
 *  entry's id; anything else was never verified by the knowledge compiler. */
export function evidenceIdGrounding(plan:{evidenceRefs:{id:string;quote?:string}[]},graph:{evidence:{id:string;quote:string}[]},inventoryIds:Set<string>):{renames:{from:string;to:string}[];dropped:string[]}{
 const renames:{from:string;to:string}[]=[],dropped:string[]=[];
 const byQuote=new Map<string,string>();
 for(const e of graph.evidence)byQuote.set(evidenceTokens(e.quote).slice(0,8).join(' '),e.id);
 for(const entry of plan.evidenceRefs){
  if(inventoryIds.has(entry.id))continue;
  const match=byQuote.get(evidenceTokens(entry.quote??'').slice(0,8).join(' '));
  if(match){renames.push({from:entry.id,to:match});}
  else dropped.push(entry.id);
 }
 return {renames,dropped};
}
/** Whitespace/unicode-normalized form for verbatim-quote matching. */
const normalizeEvidence=(text:string)=>text.replace(/[\u2018\u2019\u201A\u201B]/g,"'").replace(/[\u201C\u201D\u201E]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/\u2026/g,'...').replace(/\u00A0/g,' ').replace(/[\u2217\u22C5\u00B7\u2219]/g,'*').replace(/[\u2212\u2010\u2011]/g,'-').replace(/\u2264/g,'<=').replace(/\u2265/g,'>=').replace(/([a-z])-[ \t]*\n[ \t]*([a-z])/gi,'$1$2').replace(/[\u0000-\u0008\u000B\u000E-\u001F]/g,'').normalize('NFKD').replace(/[\u0300-\u036F]/g,'').replace(/\s+/g,' ').trim();
export const evidenceSupported=(sourceText:string,quote:string):boolean=>{
 if(sourceText.includes(quote)||normalizeEvidence(sourceText).includes(normalizeEvidence(quote)))return true;
 /** PDF extraction can drop inter-word spaces entirely (kerned arXiv text:
  *  "backbonewithalightweightsequentialmodule"). A contiguous match with all
  *  whitespace removed still proves the quote is copied from the source, but
  *  only above a length floor so short quotes cannot cross word boundaries. */
 const packed=normalizeEvidence(sourceText).replace(/\s+/g,'');
 const packedQuote=normalizeEvidence(quote).replace(/\s+/g,'');
 return packedQuote.length>=30&&packed.includes(packedQuote);
};

/** Bounded source slice that never cuts mid-sentence when a boundary exists. */
export function capAtBoundary(text:string,limit:number):string{
 if(limit<=0||text.length<=limit)return text;
 const slice=text.slice(0,limit);
 const paragraph=slice.lastIndexOf('\n\n');
 if(paragraph>limit*0.3)return slice.slice(0,paragraph).trimEnd();
 const sentence=Math.max(slice.lastIndexOf('. '),slice.lastIndexOf('! '),slice.lastIndexOf('? '));
 if(sentence>limit*0.3)return slice.slice(0,sentence+1).trimEnd();
 return slice;
}

export interface KnowledgeInput {prompt:string;sourceText:string;sourceId?:string;language?:string;repairFindings?:string[];evidenceScope?:string}

/** Long documents: one global graph, then bounded chapter windows against shared state. */
export interface ChapterWindow {id:string;index:number;text:string}
export function chapterWindows(sourceText:string,maxChars=12000):ChapterWindow[]{
 if(sourceText.length<=maxChars)return [{id:'chapter:1',index:1,text:sourceText}];
 const windows:ChapterWindow[]=[];let buffer='';
 const push=()=>{if(buffer.trim())windows.push({id:`chapter:${windows.length+1}`,index:windows.length+1,text:buffer});buffer='';};
 for(const paragraph of sourceText.split(/\n\s*\n/)){
  if(buffer&&(buffer+'\n\n'+paragraph).length>maxChars)push();
  buffer=buffer?`${buffer}\n\n${paragraph}`:paragraph;
 }
  push();
  return windows.length?windows:[{id:'chapter:1',index:1,text:sourceText}];
}

/** Bounds how much of a long document is planned: a short lesson must not pay
 *  for windows whose scenes will be discarded by the scene cap. Windows are
 *  chosen by prompt-term relevance (ties keep document order) so a narrow
 *  requested topic is not replaced by the document's opening pages. */
export function selectRelevantWindows(windows:ChapterWindow[],prompt:string,budget:number):ChapterWindow[]{
 if(budget>=windows.length)return windows;
 const terms=[...new Set((prompt.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{3,}/gu)??[]))];
 const scored=windows.map((window,index)=>({window,index,score:terms.reduce((total,term)=>total+(window.text.toLowerCase().includes(term)?1:0),0)}));
 scored.sort((a,b)=>b.score-a.score||a.index-b.index);
 return scored.slice(0,Math.max(1,budget)).sort((a,b)=>a.index-b.index).map(entry=>entry.window);
}


/** Deterministic union of per-window plans. Identical requirement/evidence meaning keeps one id;
 *  a colliding id with different meaning renames with a chapter suffix. */
export function mergeGroundedPlans(graph:ConceptGraph,windows:{window:ChapterWindow;plan:TeachingPlanV2}[]):TeachingPlanV2{
 if(windows.length===1)return windows[0].plan;
 const claims:TeachingPlanV2['requiredClaims']=[],mechanisms:TeachingPlanV2['requiredMechanisms']=[],scenes:TeachingPlanV2['scenes']=[],evidence:TeachingPlanV2['evidenceRefs']=[],misconceptions:TeachingPlanV2['misconceptions']=[];
 const seenRequirement=new Map<string,string>(),seenEvidence=new Map<string,string>();
 for(const [index,entry] of windows.entries()){
  const requirementFinal=new Map<string,string>(),evidenceFinal=new Map<string,string>();
  const resolve=(id:string,fingerprint:string,seen:Map<string,string>)=>{
   if(seen.get(id)===fingerprint)return {id,duplicate:true};
   if(!seen.has(id)){seen.set(id,fingerprint);return {id,duplicate:false};}
   let suffix=index+1,candidate=`${id}_ch${suffix}`;
   while(seen.has(candidate)&&seen.get(candidate)!==fingerprint){suffix++;candidate=`${id}_ch${suffix}`;}
   const duplicate=seen.has(candidate);
   if(!duplicate)seen.set(candidate,fingerprint);
   return {id:candidate,duplicate};
  };
  for(const claim of entry.plan.requiredClaims){const {id,duplicate}=resolve(claim.id,`claim|${claim.statement}`,seenRequirement);requirementFinal.set(claim.id,id);if(!duplicate)claims.push({...claim,id});}
  for(const mechanism of entry.plan.requiredMechanisms){const {id,duplicate}=resolve(mechanism.id,`mechanism|${mechanism.statement}|${mechanism.conceptIds.join(',')}`,seenRequirement);requirementFinal.set(mechanism.id,id);if(!duplicate)mechanisms.push({...mechanism,id});}
  for(const item of entry.plan.evidenceRefs){const {id,duplicate}=resolve(item.id,`evidence|${item.quote}`,seenEvidence);evidenceFinal.set(item.id,id);if(!duplicate)evidence.push({...item,id});}
  for(const scene of entry.plan.scenes){
   const id=scenes.some(existing=>existing.id===scene.id)?`${scene.id}_ch${index+1}`:scene.id;
   scenes.push({...scene,id,beats:scene.beats.map(beat=>({...beat,requirementIds:beat.requirementIds.map(id=>requirementFinal.get(id)??id),evidenceRefs:beat.evidenceRefs.map(id=>evidenceFinal.get(id)??id)}))});
  }
  misconceptions.push(...entry.plan.misconceptions);
 }
 const first=windows[0].plan;
 const merged:TeachingPlanV2={version:2,lessonGoal:first.lessonGoal,learnerAssumption:first.learnerAssumption,centralQuestion:first.centralQuestion,requiredClaims:claims,requiredMechanisms:mechanisms,conceptRegistry:structuredClone(graph.concepts),scenes,misconceptions,evidenceRefs:evidence};
 validateTeachingPlan(merged);
 return merged;
}

/** Deterministic alias merge first; ambiguity, cycles, orphans and fabricated evidence reject. */
export function validateKnowledge(raw:unknown,sourceText:string):ConceptGraph{
 if(Array.isArray(raw))throw new Error(`Knowledge response must be one JSON object with concepts/claims/evidence keys; received a bare array of ${raw.length} items. Re-emit the whole graph as an object.`);
 assertSchema(raw,knowledgeGraphSchema);
 const value=structuredClone(raw) as {concepts:{key:string;canonicalName:string;aliases:string[];semanticType:ConceptGraph['concepts'][number]['semanticType'];visualFamily?:string;evidenceRefs:string[]}[];prerequisites:{before:string;after:string;reason:string}[];mechanisms:ConceptGraph['mechanisms'];claims:{id:string;statement:string;critical:boolean;evidenceRefs:string[]}[];quantities:{conceptKey:string;value:string;evidenceRefs:string[]}[];terminology:{key:string;definition:string}[];evidence:{id:string;sourceId?:string;quote:string;section?:string}[]};
 const concepts:ConceptGraph['concepts']=value.concepts.map(c=>({id:c.key,canonicalName:c.canonicalName,aliases:[...(c.aliases??[])],semanticType:c.semanticType,evidenceRefs:[...new Set(c.evidenceRefs)],...(c.visualFamily?{visualFamily:c.visualFamily}:{})}));
 // Canonical identity (key/canonicalName) must never fork — that rejects.
 // Optional surface aliases that collide across concepts are dropped
 // deterministically (each concept keeps its own canonical identity).
 const canonical:Record<string,string>={};
 for(const concept of concepts)for(const name of [concept.id,concept.canonicalName]){
  const normalized=normalizeSemanticKey(name),existing=canonical[normalized];
  if(existing&&existing!==concept.id)throw new Error(`Canonical identity conflict: "${name}" maps to both ${existing} and ${concept.id}`);
  canonical[normalized]=concept.id;
 }
 const aliasOwners:Record<string,string>={},conflicted=new Set<string>();
 for(const concept of concepts)for(const alias of concept.aliases??[]){
  const normalized=normalizeSemanticKey(alias);
  if(!normalized)continue;
  const canonicalOwner=canonical[normalized];
  if(canonicalOwner&&canonicalOwner!==concept.id){conflicted.add(normalized);continue;}
  const owner=aliasOwners[normalized];
  if(owner&&owner!==concept.id){conflicted.add(normalized);continue;}
  aliasOwners[normalized]=concept.id;
 }
 if(conflicted.size)for(const concept of concepts)concept.aliases=(concept.aliases??[]).filter(alias=>!conflicted.has(normalizeSemanticKey(alias)));
 const aliases:Record<string,string>={...canonical};
 for(const [normalized,owner] of Object.entries(aliasOwners))if(!(normalized in canonical)&&!conflicted.has(normalized))aliases[normalized]=owner;
 if(conflicted.size)log('v2.knowledge.aliases-dropped',{count:conflicted.size,aliases:[...conflicted].slice(0,8)});
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
 // Deterministic heal: models compile terminology for entities mentioned in
 // claims without emitting them as concepts; unknown-key entries drop (recorded).
 const knownTerminology=value.terminology.filter(term=>keys.has(term.key));
 const droppedTerminology=value.terminology.length-knownTerminology.length; for(const item of value.evidence){
  if(!sourceText||evidenceSupported(sourceText,item.quote))continue;
  const snapped=snapQuoteToSource(sourceText,item.quote);
  if(snapped){log('v2.evidence.snapped',{id:item.id,paraphrase:item.quote.slice(0,80),source:snapped.slice(0,80)});item.quote=snapped;continue;}
  throw new Error(`Fabricated evidence: ${item.id} ("${item.quote.slice(0,80)}") is not present in the ingested source; quote the source verbatim.`);
 }
 const graph:ConceptGraph={version:1,concepts,aliases,prerequisites:value.prerequisites.filter((edge,index,all)=>all.findIndex(other=>other.before===edge.before&&other.after===edge.after)===index).map(edge=>({...edge,reason:edge.reason||'required by the source'})),mechanisms:value.mechanisms.map(m=>({...m,conceptIds:[...new Set(m.conceptIds)],evidenceRefs:[...new Set(m.evidenceRefs)]})),claims:value.claims.map(c=>({id:c.id,statement:c.statement,critical:c.critical,evidenceRefs:[...new Set(c.evidenceRefs)]})) satisfies KnowledgeClaim[] as KnowledgeClaim[],terminology:Object.fromEntries(knownTerminology.map(t=>[t.key,{definition:t.definition}])),quantities:value.quantities.map(q=>({conceptId:q.conceptKey,value:q.value,evidenceRefs:[...new Set(q.evidenceRefs)]})),evidence:value.evidence.map(e=>({id:e.id,sourceId:e.sourceId??'source',quote:e.quote,section:e.section})),sourceVisuals:[]};
 return graph;
}

export function attachSourceVisuals(graph:ConceptGraph,figures:SourceFigure[]|undefined,sourceId?:string):ConceptGraph{
 if(graph.sourceVisuals.length||!figures?.length)return graph;
 graph.sourceVisuals=figures.map((figure,index)=>({id:`source-visual:${index+1}`,sourceId:sourceId??'source',page:figure.page,caption:figure.caption,provenance:`source-${figure.kind}`}));
 return graph;
}

/** Deterministic source-visual selection (source-visual-grounding skill):
 *  a figure is offered only when its caption names a concept this scene requires;
 *  everything else is rejected with a recorded reason. No renderer coupling. */
export interface SourceVisualSelection {selected:{id:string;concept:string}[];rejected:{id:string;reason:string}[]}
export function selectSourceVisuals(semantic:{id:string;requiredConceptIds:string[]},graph:ConceptGraph):SourceVisualSelection{
 if(!graph.sourceVisuals.length)return {selected:[],rejected:[]};
 const wanted=graph.concepts.filter(concept=>semantic.requiredConceptIds.includes(concept.id));
 const selected:SourceVisualSelection['selected']=[],rejected:SourceVisualSelection['rejected']=[];
 for(const visual of graph.sourceVisuals){
  const caption=(visual.caption??'').toLowerCase();
  const match=wanted.find(concept=>caption.includes(concept.canonicalName.toLowerCase())||concept.aliases.some(alias=>alias.length>2&&caption.includes(alias.toLowerCase())));
  if(match)selected.push({id:visual.id,concept:match.id});
  else rejected.push({id:visual.id,reason:caption?'caption does not name a required concept':'figure has no caption'});
 }
 return {selected,rejected};
}

/** The real knowledge-compiler stage: one source-grounded model call, validated deterministically. */
/** Deterministic union of per-window knowledge graphs. Identical meaning keeps one id;
 *  a colliding id with a different fingerprint renames with a window suffix. */
export function mergeConceptGraphs(graphs:ConceptGraph[]):ConceptGraph{
 if(!graphs.length)throw new Error('mergeConceptGraphs requires at least one graph');
 if(graphs.length===1)return graphs[0];
 const first=graphs[0];
 const concepts:ConceptGraph['concepts']=[],aliases:Record<string,string>={},prerequisites:ConceptGraph['prerequisites']=[],mechanisms:ConceptGraph['mechanisms']=[],claims:ConceptGraph['claims']=[],quantities:ConceptGraph['quantities']=[],evidence:ConceptGraph['evidence']=[],sourceVisuals:ConceptGraph['sourceVisuals']=[];
 const terminology:ConceptGraph['terminology']={};
 const seenEvidence=new Map<string,string>(),seenRequirement=new Map<string,string>();
 const canonical=new Map<string,string>();
 for(const [index,graph] of graphs.entries()){
  for(const concept of graph.concepts)if(!canonical.has(concept.id)){canonical.set(concept.id,concept.id);concepts.push(structuredClone(concept));}
  for(const [alias,target] of Object.entries(graph.aliases))if(!(alias in aliases))aliases[alias]=target;
  for(const edge of graph.prerequisites)if(!prerequisites.some(other=>other.before===edge.before&&other.after===edge.after))prerequisites.push(structuredClone(edge));
  for(const term of Object.entries(graph.terminology))if(!(term[0] in terminology))terminology[term[0]]=structuredClone(term[1]);
  for(const item of graph.evidence){const fingerprint=normalizeEvidence(item.quote);const prior=seenEvidence.get(item.id);let id=item.id;if(prior!==undefined&&prior!==fingerprint){id=`${item.id}_w${index+1}`;}else if(prior!==undefined)continue;seenEvidence.set(id,fingerprint);evidence.push({...structuredClone(item),id});}
  for(const claim of graph.claims){const prior=seenRequirement.get(claim.id);let id=claim.id;if(prior!==undefined&&prior!==claim.statement){id=`${claim.id}_w${index+1}`;}else if(prior!==undefined)continue;seenRequirement.set(id,claim.statement);claims.push({...structuredClone(claim),id});}
  for(const mechanism of graph.mechanisms){const prior=seenRequirement.get(mechanism.id);let id=mechanism.id;if(prior!==undefined&&prior!==mechanism.statement){id=`${mechanism.id}_w${index+1}`;}else if(prior!==undefined)continue;seenRequirement.set(id,mechanism.statement);mechanisms.push({...structuredClone(mechanism),id});}
  for(const quantity of graph.quantities)if(!quantities.some(other=>other.conceptId===quantity.conceptId&&other.value===quantity.value))quantities.push(structuredClone(quantity));
  for(const visual of graph.sourceVisuals)if(!sourceVisuals.some(other=>other.id===visual.id))sourceVisuals.push(structuredClone(visual));
 }
 return {version:1,concepts,aliases,prerequisites,mechanisms,claims,terminology,quantities,evidence,sourceVisuals};
}

export async function compileKnowledge(input:KnowledgeInput,model:JsonModel,promptOptions:KnowledgePromptOptions={},signal?:AbortSignal):Promise<ConceptGraph>{
 if(!input.sourceText?.trim())throw new Error('Knowledge compilation requires source text');
 const instructions=[knowledgePrompt({language:input.language,repairNotes:input.repairFindings,...promptOptions}),skillDocInstruction('teaching-architect/references/knowledge-compiler.md')].filter(Boolean).join(' ');
 const value=await model.generate('knowledge',instructions,{prompt:input.prompt,sourceId:input.sourceId??'source',sourceText:input.sourceText},knowledgeGraphSchema,raw=>{
  const payload=raw as {evidence?:{id:string}[];claims?:{evidenceRefs?:string[]}[];mechanisms?:{evidenceRefs?:string[]}[];quantities?:{evidenceRefs?:string[]}[];concepts?:{evidenceRefs?:string[]}[]};
  /** Items referencing evidence the model never declared cannot be verified:
   *  drop those references (recorded) instead of failing the window. */
  const declared=new Set((payload.evidence??[]).map(e=>e.id));
  let dropped=0;
  for(const item of [...(payload.claims??[]),...(payload.mechanisms??[]),...(payload.quantities??[]),...(payload.concepts??[])]){
   const refs=item.evidenceRefs??[];
   const kept=refs.filter(id=>declared.has(id));
   dropped+=refs.length-kept.length;item.evidenceRefs=kept;
  }
  if(dropped)log('v2.knowledge.evidence-ref-heal',{dropped},'warn');
  return validateKnowledge(payload,input.evidenceScope??input.sourceText);
 },{signal});
 return value as ConceptGraph;
 return value as ConceptGraph;
}
