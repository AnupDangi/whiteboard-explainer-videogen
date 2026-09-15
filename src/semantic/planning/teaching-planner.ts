import {teachingIntentSchema} from '../identity/runtime-schemas.js';
import {teachingIntentToPlan} from '../identity/intent-adapter.js';
import {teachingPlanSchema} from '../schemas.js';
import {validateTeachingPlan} from './validate.js';
import {log} from '../../shared/logger.js';
import {evidenceSupported,snapQuoteToSource} from './knowledge-compiler.js';
import {teachingPrompt} from './prompt-builder.js';
import type {TeachingPlanV2,VisualArchetype} from '../types.js';
import type {JsonModel} from './model-adapter.js';
import type {SourceFigure} from '../../shared/types.js';
import type {ConceptGraph} from '../harness/contracts.js';
export interface TeachingInput {prompt:string;sourceText?:string;sourceId?:string;evidenceScope?:string;sourceFigures?:SourceFigure[];maxScenes?:number;allowedArchetypes:VisualArchetype[];language?:string;targetMinutes?:number;groundingPolicy?:'source-only'|'source-plus-verified'}
/** Primary-representation bounds each archetype compiler enforces (see
 *  compiler/archetypes.ts). A plan whose scene cannot fit any of its candidate
 *  archetypes is guaranteed to fail the visual director, so it is rejected at
 *  the teaching layer where the owner can repair it. */
const ARCHETYPE_CAPACITY:Partial<Record<VisualArchetype,[number,number]>>={flow:[2,8],cycle:[3,6],transformation:[2,4],comparison:[2,4],numbered_steps:[2,7],equation_walkthrough:[2,6],matrix_operation:[3,6],branch:[2,10],cause_effect:[2,10],state_machine:[2,10],hierarchy:[2,12],timeline:[2,6],trajectory:[3,6]};
export async function planTeaching(input:TeachingInput,model:JsonModel,options:{repairFindings?:string[];conceptGraph?:ConceptGraph;chapter?:{index:number;count:number;priorConcepts:string[];maxScenes:number};signal?:AbortSignal}={}):Promise<TeachingPlanV2>{
 if(!input.prompt.trim()||input.prompt.length>4000||(input.sourceText?.length??0)>120000)throw new Error('V2 prompt/source bounds exceeded');
 const maxScenes=options.chapter?.maxScenes??input.maxScenes??1;if(!Number.isInteger(maxScenes)||maxScenes<1||maxScenes>24)throw new Error('V2 scene limit must be 1–24');
 const graph=options.conceptGraph;
 const knowledge=graph?{keys:graph.concepts.map(c=>c.id),terminology:Object.entries(graph.terminology).map(([key,term])=>`${key}: ${term.definition}`),requirements:[...graph.claims.map(c=>c.id),...graph.mechanisms.map(m=>m.id)],evidence:[...graph.evidence.map(e=>e.id),...graph.sourceVisuals.map(v=>v.id)]}:undefined;
 const chapter=options.chapter?`This is chapter ${options.chapter.index} of ${options.chapter.count} of one longer lesson. Plan scenes for this chapter only, on one shared mental model. Prefix every scene id with ch${options.chapter.index}_. These concepts are already established in earlier chapters and may be reused as continuity: ${options.chapter.priorConcepts.join(', ')||'none'}. Keep canonical identity, terminology and representation vocabulary stable with those earlier scenes.`:'';
 return await model.generate('teaching',teachingPrompt({maxScenes,hasSource:Boolean(input.sourceText),language:input.language,targetMinutes:input.targetMinutes,repairNotes:options.repairFindings,knowledge,chapter}),input,teachingIntentSchema,value=>{
  const {plan}=validateTeachingPlan(teachingIntentToPlan(value),new Set(options.chapter?.priorConcepts??[]));if(plan.scenes.length>maxScenes)throw new Error('Too many scenes');
  for(const s of plan.scenes)if(s.candidateArchetypes.some(a=>!input.allowedArchetypes.includes(a)))throw new Error('Unavailable archetype');
  for(const s of plan.scenes){
   const fits=s.candidateArchetypes.some(a=>{const capacity=ARCHETYPE_CAPACITY[a];return !capacity||(s.requiredConceptIds.length>=capacity[0]&&s.requiredConceptIds.length<=capacity[1]);});
   if(!fits)throw new Error(`Scene ${s.id} requires ${s.requiredConceptIds.length} primary concepts, which no candidate archetype (${s.candidateArchetypes.join('/')}) can represent; merge or split concepts`);
  }
  if(input.sourceText){
   const scope=input.evidenceScope??input.sourceText;
   for(const e of plan.evidenceRefs){
    if(e.sourceId!==(input.sourceId??'source'))throw new Error(`Fabricated evidence: ${e.id}`);
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
