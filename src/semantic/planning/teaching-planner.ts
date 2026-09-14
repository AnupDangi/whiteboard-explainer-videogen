import {teachingIntentSchema} from '../identity/runtime-schemas.js';
import {teachingIntentToPlan} from '../identity/intent-adapter.js';
import {teachingPlanSchema} from '../schemas.js';
import {validateTeachingPlan} from './validate.js';
import {teachingPrompt} from './prompt-builder.js';
import type {TeachingPlanV2,VisualArchetype} from '../types.js';
import type {JsonModel} from './model-adapter.js';
import type {SourceFigure} from '../../shared/types.js';
export interface TeachingInput {prompt:string;sourceText?:string;sourceId?:string;sourceFigures?:SourceFigure[];maxScenes?:number;allowedArchetypes:VisualArchetype[];language?:string;targetMinutes?:number;groundingPolicy?:'source-only'|'source-plus-verified'}
export async function planTeaching(input:TeachingInput,model:JsonModel,options:{repairFindings?:string[]}={}):Promise<TeachingPlanV2>{
 if(!input.prompt.trim()||input.prompt.length>4000||(input.sourceText?.length??0)>120000)throw new Error('V2 prompt/source bounds exceeded');
 const maxScenes=input.maxScenes??1;if(!Number.isInteger(maxScenes)||maxScenes<1||maxScenes>24)throw new Error('V2 scene limit must be 1–24');
 return await model.generate('teaching',teachingPrompt({maxScenes,hasSource:Boolean(input.sourceText),language:input.language,targetMinutes:input.targetMinutes,repairNotes:options.repairFindings}),input,teachingIntentSchema,value=>{
  const {plan}=validateTeachingPlan(teachingIntentToPlan(value));if(plan.scenes.length>maxScenes)throw new Error('Too many scenes');
  for(const s of plan.scenes)if(s.candidateArchetypes.some(a=>!input.allowedArchetypes.includes(a)))throw new Error('Unavailable archetype');
  if(input.sourceText){for(const e of plan.evidenceRefs)if(e.sourceId!==(input.sourceId??'source')||!input.sourceText.includes(e.quote))throw new Error(`Fabricated evidence: ${e.id}`);if(!plan.evidenceRefs.length)throw new Error('Source-grounded plan requires evidence');}else if(plan.evidenceRefs.length)throw new Error('Prompt-only plan cannot invent evidence');
  return plan;
 }) as TeachingPlanV2;
}
