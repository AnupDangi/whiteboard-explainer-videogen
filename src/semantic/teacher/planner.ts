import {assertSchema} from '../schemas.js';
import {RELATIONS} from '../types.js';
import {log} from '../../shared/logger.js';
import type {JsonModel} from '../planning/model-adapter.js';
import type {BaseConceptGraph,FocusedConceptGraph} from '../knowledge/types.js';
import {lessonPlanSchema} from './schema.js';
import {gateLessonPlan,scenesForDuration,depthGuidance,type LessonGate} from './gate.js';
import type {LessonBible,LessonPlan} from './types.js';

/** ONE Teacher Planner call (`Architecture_plan.md` §16). It receives the
 *  focused graph, the optional prompt, duration and audience, and returns the
 *  whole lesson architecture: `LessonGraph` + `LessonBible` + all
 *  `SceneContract`s. Never one planning call per scene (§16, §32). */
export interface TeacherInput {
  base:BaseConceptGraph;
  focus:FocusedConceptGraph;
  userPrompt:string;
  targetDurationSec:number;
  audience?:{level?:string;assumedKnowledge?:string[]};
  language?:string;
}

const INVARIANTS=[
  'A scene is one learner delta, not one concept node: cluster concepts pedagogically.',
  'Use only concept keys, mechanism ids and evidence refs present in the supplied graph; never invent them.',
  'Duration controls depth, not speaking speed.',
  'The title is a direct subject title; do not phrase it as a question unless the prompt asks for one.',
  'Analogies are pedagogical and must not become source claims.',
  'No coordinates, no SVG, no executable code, no URLs.',
].join(' ');

function instructions(input:TeacherInput):string{
  const expected=scenesForDuration(input.targetDurationSec);
  return `You are the teacher planner for a whiteboard lesson. Produce the entire lesson plan in one response: LessonGraph (title, goal, scenes, continuity, ending) and LessonBible (cross-scene consistency). ${INVARIANTS} Allowed relation types (use no others): ${RELATIONS.join(', ')}. Target about ${expected} scenes (band ${Math.max(1,Math.ceil(expected*0.5))}-${Math.ceil(expected*1.5)}); depth for this duration: ${depthGuidance(input.targetDurationSec)}. Language: ${input.language??'en'}.`;
}

export async function planLesson(input:TeacherInput,options:{model:JsonModel;signal?:AbortSignal;sessionId?:string}):Promise<{plan:LessonPlan;gate:LessonGate}>{
  const graphInput={
    request:{userPrompt:input.userPrompt,targetDurationSec:input.targetDurationSec,audience:input.audience??{},language:input.language??'en'},
    centralConcepts:input.base.centralConcepts,
    thesis:input.base.thesis,
    concepts:input.focus.concepts,
    claims:input.focus.claims,
    mechanisms:input.focus.mechanisms,
    prerequisites:input.focus.prerequisites,
    terminology:input.focus.terminology,
  };
  const raw=await options.model.generate('teacherPlanner',instructions(input),graphInput,lessonPlanSchema,(value)=>{assertSchema(value,lessonPlanSchema);return normalizePlan(value);},{...(options.signal?{signal:options.signal}:{}),...(options.sessionId?{sessionId:options.sessionId}:{})});
  const plan=raw as LessonPlan;
  const gate=gateLessonPlan(plan,{base:input.base,focus:input.focus,requestedDurationSec:input.targetDurationSec,userPrompt:input.userPrompt});
  if(gate.advisories.length)log('v3.teacher.advisory',{advisories:gate.advisories},'warn');
  if(!gate.passed)throw new Error(`Teacher gate failed: ${gate.findings.join('; ')}`);
  return {plan,gate};
}

interface RawBible {
  canonicalTerminology:Array<{key:string;definition:string}>;
  conceptIdentity:Array<{conceptId:string;canonicalName:string;aliases:string[]}>;
  visualIdentity:Array<{conceptId:string;representationFamily:string;colorRole?:string}>;
  analogies:Array<{conceptId:string;analogy:string}>;
  narrativeStyle:string;learnerLevel:string;persistentObjects:string[];
  introducedConceptsByScene:Array<{sceneId:string;conceptIds:string[]}>;forbiddenRepetition:string[];
}

function normalizePlan(raw:unknown):LessonPlan{
  const value=raw as {lessonGraph:LessonPlan['lessonGraph'];lessonBible:RawBible};
  const bible:LessonBible={
    canonicalTerminology:Object.fromEntries(value.lessonBible.canonicalTerminology.map(entry=>[entry.key,entry.definition])),
    conceptIdentity:Object.fromEntries(value.lessonBible.conceptIdentity.map(entry=>[entry.conceptId,{canonicalName:entry.canonicalName,aliases:entry.aliases??[]}])),
    visualIdentity:Object.fromEntries(value.lessonBible.visualIdentity.map(entry=>[entry.conceptId,{representationFamily:entry.representationFamily,...(entry.colorRole?{colorRole:entry.colorRole}:{})}])),
    analogies:Object.fromEntries(value.lessonBible.analogies.map(entry=>[entry.conceptId,{conceptId:entry.conceptId,analogy:entry.analogy,markedAsPedagogical:true as const}])),
    narrativeStyle:value.lessonBible.narrativeStyle,
    learnerLevel:value.lessonBible.learnerLevel,
    persistentObjects:value.lessonBible.persistentObjects,
    introducedConceptsByScene:Object.fromEntries(value.lessonBible.introducedConceptsByScene.map(entry=>[entry.sceneId,entry.conceptIds])),
    forbiddenRepetition:value.lessonBible.forbiddenRepetition,
  };
  return {lessonGraph:value.lessonGraph,lessonBible:bible};
}
