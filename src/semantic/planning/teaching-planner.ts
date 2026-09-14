import {teachingIntentSchema} from '../identity/runtime-schemas.js';
import {teachingIntentToPlan} from '../identity/intent-adapter.js';
import {teachingPlanSchema} from '../schemas.js';
import {validateTeachingPlan} from './validate.js';
import {teachingPrompt} from './prompt-builder.js';
import type {TeachingPlanV2,VisualArchetype} from '../types.js';
import type {JsonModel} from './model-adapter.js';
import type {SourceFigure} from '../../shared/types.js';
import type {ConceptGraph} from '../harness/contracts.js';
export interface TeachingInput {prompt:string;sourceText?:string;sourceId?:string;sourceFigures?:SourceFigure[];maxScenes?:number;allowedArchetypes:VisualArchetype[];language?:string;targetMinutes?:number;groundingPolicy?:'source-only'|'source-plus-verified'}
export async function planTeaching(input:TeachingInput,model:JsonModel,options:{repairFindings?:string[];conceptGraph?:ConceptGraph}={}):Promise<TeachingPlanV2>{
 if(!input.prompt.trim()||input.prompt.length>4000||(input.sourceText?.length??0)>120000)throw new Error('V2 prompt/source bounds exceeded');
 const maxScenes=input.maxScenes??1;if(!Number.isInteger(maxScenes)||maxScenes<1||maxScenes>24)throw new Error('V2 scene limit must be 1–24');
 const graph=options.conceptGraph;
 const knowledge=graph?{keys:graph.concepts.map(c=>c.id),terminology:Object.entries(graph.terminology).map(([key,term])=>`${key}: ${term.definition}`),requirements:[...graph.claims.map(c=>c.id),...graph.mechanisms.map(m=>m.id)]}:undefined;
 return await model.generate('teaching',teachingPrompt({maxScenes,hasSource:Boolean(input.sourceText),language:input.language,targetMinutes:input.targetMinutes,repairNotes:options.repairFindings,knowledge}),input,teachingIntentSchema,value=>{
  const {plan}=validateTeachingPlan(teachingIntentToPlan(value));if(plan.scenes.length>maxScenes)throw new Error('Too many scenes');
  for(const s of plan.scenes)if(s.candidateArchetypes.some(a=>!input.allowedArchetypes.includes(a)))throw new Error('Unavailable archetype');
  if(input.sourceText){for(const e of plan.evidenceRefs)if(e.sourceId!==(input.sourceId??'source')||!input.sourceText.includes(e.quote))throw new Error(`Fabricated evidence: ${e.id}`);if(!plan.evidenceRefs.length)throw new Error('Source-grounded plan requires evidence');}else if(plan.evidenceRefs.length)throw new Error('Prompt-only plan cannot invent evidence');
  if(graph){
   const keys=new Set(graph.concepts.map(c=>c.id)),evidenceIds=new Set(graph.evidence.map(e=>e.id)),requirements=new Set([...graph.claims.map(c=>c.id),...graph.mechanisms.map(m=>m.id)]);
   for(const c of plan.conceptRegistry)if(!keys.has(c.id))throw new Error(`Concept outside knowledge inventory: ${c.id}`);
   for(const e of plan.evidenceRefs)if(!evidenceIds.has(e.id))throw new Error(`Evidence outside knowledge inventory: ${e.id}`);
   for(const scene of plan.scenes)for(const conceptId of scene.requiredConceptIds)if(!keys.has(conceptId))throw new Error(`Required concept outside knowledge inventory: ${conceptId}`);
   for(const requirement of [...plan.requiredClaims,...plan.requiredMechanisms])if(!requirements.has(requirement.id))throw new Error(`Requirement outside knowledge inventory: ${requirement.id}`);
  }
  return plan;
 }) as TeachingPlanV2;
}
