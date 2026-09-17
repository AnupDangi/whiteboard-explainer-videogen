import {createHash} from 'node:crypto';
import type {CacheStore} from '../cache/store.js';
import {lessonCacheKey} from '../cache/keys.js';
import {baseGraphHash} from '../knowledge/reducer.js';
import type {BaseConceptGraph,FocusedConceptGraph} from '../knowledge/types.js';
import type {JsonModel} from '../planning/model-adapter.js';
import {planLesson} from './planner.js';
import {gateLessonPlan,type LessonGate} from './gate.js';
import type {LessonPlan} from './types.js';

/** W3 orchestrator: focused graph + prompt + duration → one teacher call →
 *  cached `LessonGraph` + `LessonBible` + `SceneContract[]`. The lesson cache is
 *  keyed by the base-graph hash, prompt, duration, audience and language, so two
 *  lessons on the same source share the expensive graph but not the lesson plan
 *  (`Architecture_plan.md` §15, §42-43). */
export interface BuildLessonOptions {
  base:BaseConceptGraph;
  focus:FocusedConceptGraph;
  userPrompt:string;
  targetDurationSec:number;
  audience?:{level?:string;assumedKnowledge?:string[]};
  language?:string;
  model:JsonModel;
  store?:CacheStore;
  signal?:AbortSignal;
  sessionId?:string;
}

export interface LessonResult {plan:LessonPlan;gate:LessonGate;cached:boolean}

const hash=(value:string):string=>createHash('sha256').update(value).digest('hex');

export async function buildLessonPlan(options:BuildLessonOptions):Promise<LessonResult>{
  const key=lessonCacheKey({
    baseGraphHash:baseGraphHash(options.base),
    userPromptHash:hash(options.userPrompt),
    targetDurationSec:options.targetDurationSec,
    audienceHash:hash(JSON.stringify(options.audience??{})),
    language:options.language??'en',
  });
  const cached=options.store?await options.store.get<LessonPlan>(key):undefined;
  if(cached){
    try{
      const gate=gateLessonPlan(cached,{base:options.base,focus:options.focus,requestedDurationSec:options.targetDurationSec,userPrompt:options.userPrompt});
      if(gate.passed)return {plan:cached,gate,cached:true};
    }catch{/* malformed cache entry is treated as a miss */ }
  }
  const {plan,gate}=await planLesson({base:options.base,focus:options.focus,userPrompt:options.userPrompt,targetDurationSec:options.targetDurationSec,...(options.audience?{audience:options.audience}:{}),...(options.language?{language:options.language}:{}),},{model:options.model,...(options.signal?{signal:options.signal}:{}),...(options.sessionId?{sessionId:options.sessionId}:{})});
  if(options.store)await options.store.put(key,plan,{validated:true,kind:'lesson-plan'});
  return {plan,gate,cached:false};
}
