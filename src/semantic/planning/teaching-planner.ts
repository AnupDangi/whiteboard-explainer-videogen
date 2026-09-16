import {teachingIntentSchema} from '../identity/runtime-schemas.js';
import {teachingIntentToPlan} from '../identity/intent-adapter.js';
import {teachingPlanSchema} from '../schemas.js';
import {validateTeachingPlan} from './validate.js';
import {log} from '../../shared/logger.js';
import {evidenceSupported,snapQuoteToSource} from './knowledge-compiler.js';
import {teachingPrompt} from './prompt-builder.js';
import {archetypeFits} from '../compiler/archetypes.js';
import type {TeachingPlanV2,VisualArchetype} from '../types.js';
import type {JsonModel} from './model-adapter.js';
import type {SourceFigure} from '../../shared/types.js';
import type {ConceptGraph} from '../harness/contracts.js';
export interface TeachingInput {prompt:string;sourceText?:string;sourceId?:string;evidenceScope?:string;sourceFigures?:SourceFigure[];maxScenes?:number;allowedArchetypes:VisualArchetype[];language?:string;targetMinutes?:number;groundingPolicy?:'source-only'|'source-plus-verified'}
/** Deterministic cognitive-load heal: a beat that introduces more than three
 *  concepts overflows into later beats that still have room, preserving order
 *  and every concept. Runs before validation so a load violation is repaired
 *  mechanically instead of failing (or paying for) a model retry. */
export function spreadExcessIntroductions(value:unknown):void{
 const scenes=(value as {scenes?:{beats?:{introduce?:string[]}[]}[]})?.scenes;
 if(!Array.isArray(scenes))return;
 const MAX=3;
 for(const scene of scenes){
  if(!Array.isArray(scene?.beats))continue;
  let carry:string[]=[];
  for(const beat of scene.beats){
   if(!Array.isArray(beat.introduce))beat.introduce=[];
   beat.introduce=[...carry,...beat.introduce];
   carry=beat.introduce.length>MAX?beat.introduce.splice(MAX):[];
  }
  /** No later beat had room: the overflow stays with the last beat so the
   *  validator still reports the real load problem instead of losing concepts. */
  if(carry.length&&scene.beats.length)scene.beats[scene.beats.length-1].introduce!.push(...carry);
 }
}
/** Deterministic state-mechanism heal: a mechanism marked requiresStateChange
 *  must transform one of its concepts on screen. If the model forgot, inject
 *  neutral→activated into the beat that teaches one of those concepts
 *  (recorded), instead of failing the whole plan. */
export function healStateMechanisms(value:unknown):void{
 const plan=value as {requiredMechanisms?:{id:string;requiresStateChange?:boolean;conceptKeys?:string[]}[];scenes?:{beats?:{introduce?:string[];reinforce?:string[];transform?:{conceptKey:string;fromState?:string;toState:string}[]}[]}[]};
 if(!plan?.requiredMechanisms||!Array.isArray(plan.scenes))return;
 const transformed=new Set<string>();
 for(const scene of plan.scenes)for(const beat of scene.beats??[])for(const t of beat.transform??[])transformed.add(t.conceptKey);
 for(const mechanism of plan.requiredMechanisms){
  if(!mechanism.requiresStateChange)continue;
  if((mechanism.conceptKeys??[]).some(key=>transformed.has(key)))continue;
  for(const scene of plan.scenes){
   for(const beat of scene.beats??[]){
    const target=(mechanism.conceptKeys??[]).find(key=>beat.introduce?.includes(key)||beat.reinforce?.includes(key));
    if(!target)continue;
    beat.transform=beat.transform??[];
    beat.transform.push({conceptKey:target,fromState:'neutral',toState:'activated'});
    log('v2.plan.state-heal',{mechanism:mechanism.id,concept:target});
    transformed.add(target);
    break;
   }
   if((mechanism.conceptKeys??[]).some(key=>transformed.has(key)))break;
  }
 }
}
export async function planTeaching(input:TeachingInput,model:JsonModel,options:{repairFindings?:string[];conceptGraph?:ConceptGraph;chapter?:{index:number;count:number;priorConcepts:string[];maxScenes:number};signal?:AbortSignal}={}):Promise<TeachingPlanV2>{
 if(!input.prompt.trim()||input.prompt.length>4000||(input.sourceText?.length??0)>120000)throw new Error('V2 prompt/source bounds exceeded');
 const maxScenes=options.chapter?.maxScenes??input.maxScenes??1;if(!Number.isInteger(maxScenes)||maxScenes<1||maxScenes>24)throw new Error('V2 scene limit must be 1–24');
 const graph=options.conceptGraph;
 const knowledge=graph?{keys:graph.concepts.map(c=>c.id),terminology:Object.entries(graph.terminology).map(([key,term])=>`${key}: ${term.definition}`),requirements:[...graph.claims.map(c=>c.id),...graph.mechanisms.map(m=>m.id)],evidence:[...graph.evidence.map(e=>e.id),...graph.sourceVisuals.map(v=>v.id)]}:undefined;
 const chapter=options.chapter?`This is chapter ${options.chapter.index} of ${options.chapter.count} of one longer lesson. Plan scenes for this chapter only, on one shared mental model. Prefix every scene id with ch${options.chapter.index}_. These concepts are already established in earlier chapters and may be reused as continuity: ${options.chapter.priorConcepts.join(', ')||'none'}. Keep canonical identity, terminology and representation vocabulary stable with those earlier scenes.`:'';
   /** evidenceScope is validation-only (the full source); sending it to the
  *  model burned ~30k prompt tokens per teaching call. The model quotes from
  *  its chapter window; the verbatim gate still checks against the full scope. */
 const modelInput={...input,evidenceScope:undefined};
 return await model.generate('teaching',teachingPrompt({maxScenes,hasSource:Boolean(input.sourceText),language:input.language,targetMinutes:input.targetMinutes,repairNotes:options.repairFindings,knowledge,chapter}),modelInput,teachingIntentSchema,value=>{
   spreadExcessIntroductions(value);healStateMechanisms(value);
   const {plan}=validateTeachingPlan(teachingIntentToPlan(value),new Set(options.chapter?.priorConcepts??[]));if(plan.scenes.length>maxScenes)throw new Error('Too many scenes');
  for(const s of plan.scenes){
   /** The archetype list is harness-owned: the job constrains it, so a scene
    *  naming unavailable families is clamped to the allowed ones (recorded). */
   const clamped=s.candidateArchetypes.filter(a=>input.allowedArchetypes.includes(a));
   if(!clamped.length){log('v2.plan.archetype-heal',{scene:s.id,dropped:s.candidateArchetypes,to:[input.allowedArchetypes[0]]},'warn');s.candidateArchetypes=[input.allowedArchetypes[0] as VisualArchetype];}
   else if(clamped.length<s.candidateArchetypes.length){log('v2.plan.archetype-heal',{scene:s.id,dropped:s.candidateArchetypes.filter(a=>!input.allowedArchetypes.includes(a))},'warn');s.candidateArchetypes=clamped as VisualArchetype[];}
  }
  for(const s of plan.scenes){
   const fits=s.candidateArchetypes.some(a=>archetypeFits(a,s.requiredConceptIds.length));
   if(!fits)throw new Error(`Scene ${s.id} requires ${s.requiredConceptIds.length} primary concepts, which no candidate archetype (${s.candidateArchetypes.join('/')}) can represent; merge or split concepts`);
  }
  if(input.sourceText){
   const scope=input.evidenceScope??input.sourceText;
   for(const e of plan.evidenceRefs){
    /** Book-keeping bridge: the model may echo the default sourceId ('source')
     *  instead of the document id; the quote still has to be verbatim in the
     *  scope (checked next), so the field is bridged (recorded) rather than
     *  throwing a misleading 'Fabricated evidence'. */
    const expectedSourceId=input.sourceId??'source';
    if(e.sourceId!==expectedSourceId)e.sourceId=expectedSourceId;
    if(evidenceSupported(scope,e.quote))continue;
    const snapped=snapQuoteToSource(scope,e.quote);
    if(!snapped)throw new Error(`Fabricated evidence: ${e.id}`);
    log('v2.evidence.snapped',{id:e.id,stage:'teaching',paraphrase:e.quote.slice(0,80),source:snapped.slice(0,80)});e.quote=snapped;
   }
   if(!plan.evidenceRefs.length)throw new Error('Source-grounded plan requires evidence');
  }else if(plan.evidenceRefs.length)throw new Error('Prompt-only plan cannot invent evidence');
  if(graph){
   const keys=new Set(graph.concepts.map(c=>c.id)),evidenceIds=new Set([...graph.evidence.map(e=>e.id),...graph.sourceVisuals.map(v=>v.id)]),requirements=new Set([...graph.claims.map(c=>c.id),...graph.mechanisms.map(m=>m.id)]);
   for(const c of plan.conceptRegistry)if(!keys.has(c.id))throw new Error(`Concept outside knowledge inventory: ${c.id}`);
   for(const e of plan.evidenceRefs)if(!evidenceIds.has(e.id))throw new Error(`Evidence outside knowledge inventory: ${e.id}`);
   for(const scene of plan.scenes)for(const conceptId of scene.requiredConceptIds)if(!keys.has(conceptId))throw new Error(`Required concept outside knowledge inventory: ${conceptId}`);
   for(const requirement of [...plan.requiredClaims,...plan.requiredMechanisms])if(!requirements.has(requirement.id))throw new Error(`Requirement outside knowledge inventory: ${requirement.id}`);
  }
  return plan;
 },{signal:options.signal}) as TeachingPlanV2;
}
