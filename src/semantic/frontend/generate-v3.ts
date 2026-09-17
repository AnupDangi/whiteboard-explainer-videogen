import {log} from '../../shared/logger.js';
import {NARRATION_WPM} from '../../shared/language.js';
import type {SourceDocument} from '../../shared/types.js';
import type {JsonModel,StageCall,StageEvent} from '../planning/model-adapter.js';
import {compileScene} from '../compiler/compile-scene.js';
import {gateCompiled} from '../harness/gates.js';
import {stableHash} from '../harness/state.js';
import {HARNESS_VERSION,type HarnessRunManifest,type GateResult,type LearnerState} from '../harness/contracts.js';
import {buildBaseConceptGraph} from '../knowledge/index.js';
import {buildLessonPlan} from '../teacher/index.js';
import {runSceneWorkers,gateSceneIntent} from '../scene/worker.js';
import {narrationForScene} from '../scene/voice.js';
import {buildIndex,focusSet} from '../retrieval/sets.js';
import {sceneCacheKey} from '../cache/keys.js';
import type {CacheStore} from '../cache/store.js';
import {narratedSpeech} from '../semantic-timing.js';
import type {SpeechResult} from '../speech.js';
import type {SemanticChunk} from '../source/chunker.js';
import type {CompiledSceneV2,TeachingPlanV2,VisualSceneV2} from '../types.js';
import {healCounts} from '../planning/model-adapter.js';

/** The `semantic-v3` front end (`Architecture_plan.md` §16, §22-27, §65). One
 *  source pass, one teacher call, one scene-worker call per batch, then the
 *  existing trusted compiler and TTS. It yields the same per-scene result shape
 *  the V2 job loop consumes, so `SemanticJobStore` persists and publishes it
 *  unchanged. Nothing here fabricates a scene: a failed gate throws. */
export interface GenerateV3Input {
  prompt:string;
  targetMinutes?:number;
  language?:string;
  maxScenes?:number;
  allowedArchetypes?:string[];
}

export interface GenerateV3Options {
  speech?:(text:string)=>Promise<SpeechResult>;
  signal?:AbortSignal;
  runId?:string;
  /** Source/lesson/scene cache. A full hit buys zero model calls. */
  store?:CacheStore;
}

export interface V3SceneResult {
  plan:TeachingPlanV2;
  compiled:CompiledSceneV2;
  speech?:SpeechResult;
  gates:GateResult[];
  manifest:HarnessRunManifest;
  learnerAfter:LearnerState;
  healCounts:{normalization:number;safeDeterministic:number;semantic:number};
  metrics:{teachingMs?:number;visualModelMs?:number;directorMs?:number;narrationFinalizeMs?:number;ttsMs:number;compileMs:number;sceneReadyMs:number;criticMs?:number;criticRepairs?:number};
}

/** The compiler's geometry invariant (illegal overlap) is the one class it
 *  cannot repair itself. One bounded deterministic retry: flatten parent/child
 *  containment, which is the usual cause of a nested-object overlap, and
 *  recompile. Logged; a second failure surfaces visibly (`Architecture_plan.md`
 *  §2: code owns collision resolution). */
function compileWithRepair(scene:VisualSceneV2,timing:Parameters<typeof compileScene>[1],previous:CompiledSceneV2|undefined):CompiledSceneV2{
  const attempt=(candidate:VisualSceneV2)=>{try{return compileScene(candidate,timing,previous);}catch(error){return error as Error;}};
  const first=attempt(scene);
  if(!(first instanceof Error))return first;
  // Tier 1: flatten containment and force exactly one hero.
  const flattened=structuredClone(scene);
  for(const object of flattened.objects){delete object.parentId;object.children=[];}
  const heroes=flattened.objects.filter(object=>object.role==='hero');
  if(heroes.length!==1&&flattened.objects.length){for(const object of flattened.objects)object.role=object.role==='hero'?'support':object.role;(heroes[0]??flattened.objects[0]).role='hero';}
  const second=attempt(flattened);
  if(!(second instanceof Error)){log('v3.compile.heal',{scene:scene.id,tier:'flatten',reason:first.message},'warn');return second;}
  // Tier 2: a minimal single-object scene always compiles. Loud and last-resort,
  // so one bad model shape cannot cost the whole lesson (HANDOFF philosophy).
  const source=flattened.objects.find(object=>object.role==='hero')??flattened.objects[0];
  const id=source?.id??'obj_fallback';
  const narration=scene.beats.map(beat=>beat.narration).join(' ').replace(/\s+/g,' ').trim()||scene.title;
  const minimal:VisualSceneV2={version:2,id:scene.id,title:scene.title,teachingGoal:scene.teachingGoal,mentalModel:scene.mentalModel,archetype:'flow',objects:[{id,conceptId:source?.conceptId,label:(source?.label??scene.title).slice(0,80),role:'hero',primitiveRef:'label',children:[],state:'neutral',allowedStates:['neutral'],importance:'primary',collisionPolicy:'forbid'}],relations:[],beats:[{id:'b1',narration,actions:[{id:'a1',type:'draw',objectIds:[id],relationIds:[],durationMs:800,leadMs:0,easing:'linear'}]}],continuity:{keepFromPrevious:[],prepareForNext:[]}};
  log('v3.compile.degraded',{scene:scene.id,reason:second.message,objects:flattened.objects.length},'error');
  return compileScene(minimal,timing,previous);
}

const EMPTY_LEARNER:LearnerState={establishedConcepts:[],activeMentalModels:[],terminology:{},unresolvedQuestions:[],misconceptionsAddressed:[],checkpoints:[],provenance:[]};

/** Stable per-concept object ids. The compiler requires `keepFromPrevious` to
 *  name an id that exists in both the previous and the current scene, so the
 *  same concept must carry the same object id across scenes. The worker authors
 *  arbitrary ids; code owns identity, exactly as V2's `canonicalizeVisualScene`
 *  does. Pure and deterministic. */
export function canonicalizeSceneIds(scene:VisualSceneV2):void{
  const used=new Set<string>();
  const mapping=new Map<string,string>();
  for(const object of scene.objects){
    let next=object.conceptId?`obj_${object.conceptId}`:object.id;
    if(used.has(next))next=`${next}_${object.id}`;
    used.add(next);
    mapping.set(object.id,next);
  }
  for(const object of scene.objects){
    object.id=mapping.get(object.id)!;
    if(object.parentId)object.parentId=mapping.get(object.parentId)??object.parentId;
    object.children=object.children.map(child=>mapping.get(child)??child);
  }
  for(const relation of scene.relations){
    relation.from.objectId=mapping.get(relation.from.objectId)??relation.from.objectId;
    relation.to.objectId=mapping.get(relation.to.objectId)??relation.to.objectId;
  }
  for(const beat of scene.beats)for(const action of beat.actions)action.objectIds=action.objectIds.map(id=>mapping.get(id)??id);
}

/** Containment relations become real parent/child geometry before compile: the
 *  compiler places a `contain` child inside its parent, which is also the only
 *  way two nested objects may keep overlapping labels (`collisions.ts`). */
export function applyContainment(scene:VisualSceneV2):void{
  for(const relation of scene.relations){
    if(relation.relationType!=='contains'&&relation.relationType!=='part_of')continue;
    const parentId=relation.relationType==='contains'?relation.from.objectId:relation.to.objectId;
    const childId=relation.relationType==='contains'?relation.to.objectId:relation.from.objectId;
    const child=scene.objects.find(object=>object.id===childId);
    if(child&&scene.objects.some(object=>object.id===parentId)){child.parentId=parentId;child.collisionPolicy='contain';}
  }
}

export async function* generateV3(doc:SourceDocument,input:GenerateV3Input,model:JsonModel,options:GenerateV3Options={}):AsyncGenerator<V3SceneResult>{
  const started=Date.now();
  const targetDurationSec=(input.targetMinutes??1)*60;
  /** Stable OpenRouter session ids (`Architecture_plan.md` §53): all source
   *  knowledge maps stick to one provider cache, all lesson stages to another. */
  const sourceSession=`source:${doc.sha256.slice(0,24)}`;
  const lessonSession=`lesson:${stableHash({source:doc.sha256,prompt:input.prompt,duration:targetDurationSec}).slice(0,24)}`;
  const frontStart=Date.now();
  const knowledge=await buildBaseConceptGraph({doc,objective:input.prompt,model,sessionId:sourceSession,...(options.store?{store:options.store}:{}),...(options.signal?{signal:options.signal}:{})});
  const lesson=await buildLessonPlan({base:knowledge.base,focus:knowledge.focus,userPrompt:input.prompt,targetDurationSec,...(input.language?{language:input.language}:{}),model,sessionId:lessonSession,...(options.store?{store:options.store}:{}),...(options.signal?{signal:options.signal}:{})});
  if(!lesson.gate.passed)throw new Error(`Teacher gate failed: ${lesson.gate.findings.join('; ')}`);
  const teachingMs=Date.now()-frontStart;
  const contracts=lesson.plan.lessonGraph.scenes.slice(0,Math.max(1,Math.min(input.maxScenes??lesson.plan.lessonGraph.scenes.length,120)));
  // The job's archetype allowlist must bind the v3 path too: intersect each
  // contract's candidates and refuse a scene that has none left.
  const allowed=new Set(input.allowedArchetypes??[]);
  if(allowed.size){
    for(const contract of contracts){
      contract.candidateArchetypes=[...new Set(contract.candidateArchetypes.filter(archetype=>allowed.has(archetype)))] as typeof contract.candidateArchetypes;
      if(!contract.candidateArchetypes.length)throw new Error(`Scene ${contract.id} has no archetype allowed by the requested set`);
    }
  }

  const index=buildIndex(knowledge.chunks);
  const evidence:Record<string,SemanticChunk[]>={};
  for(const contract of contracts)evidence[contract.id]=focusSet(index,{objective:`${contract.learningDelta} ${contract.narrationIntent}`,topK:8});

  /** Scene tier (`Architecture_plan.md` §42, §51): a scene intent is cached only
   *  after it passed `gateSceneIntent`, keyed by the lesson graph + contract. A
   *  full hit buys no scene-worker call. */
  const lessonHash=stableHash(lesson.plan.lessonGraph);
  const keyOf=(contract:{id:string})=>sceneCacheKey({lessonGraphHash:lessonHash,sceneContractHash:stableHash(contract)});
  const contractById=new Map(contracts.map(contract=>[contract.id,contract]));
  const cachedIntents:Record<string,VisualSceneV2>={};
  if(options.store){
    for(const contract of contracts){
      const cached=await options.store.get<VisualSceneV2>(keyOf(contract));
      if(cached&&gateSceneIntent(cached,contract,{graph:knowledge.base}).passed)cachedIntents[contract.id]=cached;
    }
  }
  const missing=contracts.filter(contract=>!cachedIntents[contract.id]);
  const fresh=missing.length?await runSceneWorkers(missing,{graph:knowledge.base,bible:lesson.plan.lessonBible,evidence,...(input.language?{language:input.language}:{}),...(options.signal?{signal:options.signal}:{})},{model,sessionId:lessonSession}):[];
  if(options.store)for(const scene of fresh)await options.store.put(keyOf(contractById.get(scene.id)!),scene,{validated:true,kind:'scene-intent'});
  let scenes=contracts.map(contract=>cachedIntents[contract.id]??fresh.find(scene=>scene.id===contract.id)!);

  /** One bounded length repair (`Architecture_plan.md` §61): a scene worker
   *  under- or over-writes narration, and without TTS the estimated duration is
   *  words / NARRATION_WPM. The target is the REQUESTED duration, not the sum of
   *  the teacher's per-scene guesses — otherwise a teacher that budgets 78s for
   *  a 60s request suppresses the repair and the job gate fails. If the total is
   *  outside ±20% of the request, re-ask once with the measured count. */
  const targetWords=targetDurationSec*NARRATION_WPM/60;
  const wordCount=(list:VisualSceneV2[])=>list.reduce((sum,scene)=>sum+narrationForScene(scene).split(/\s+/).filter(Boolean).length,0);
  if(targetWords>0){
    const total=wordCount(scenes);
    /** Trigger inside the job's ±15% window (with margin) so the repair runs
     *  before the job gate would fail, not after. */
    if(total<targetWords*0.88||total>targetWords*1.12){
      const repairNote=`The previous narration totalled ${total} words; the target is about ${Math.round(targetWords)}. Rewrite every scene so the whole lesson is near that total (${total<targetWords?'expand each scene':'trim each scene'}).`;
      log('v3.scene.length-repair',{total,target:Math.round(targetWords)},'warn');
      const repaired=await runSceneWorkers(contracts,{graph:knowledge.base,bible:lesson.plan.lessonBible,evidence,repairNote,...(input.language?{language:input.language}:{}),...(options.signal?{signal:options.signal}:{})},{model,sessionId:lessonSession});
      const repairedWords=wordCount(repaired);
      if(Math.abs(repairedWords-targetWords)<=Math.abs(total-targetWords)){
        if(options.store)for(const scene of repaired)await options.store.put(keyOf(contractById.get(scene.id)!),scene,{validated:true,kind:'scene-intent'});
        scenes=repaired;
      }
    }
  }

  const plan={version:2,lessonGoal:lesson.plan.lessonGraph.lessonGoal,learnerAssumption:'',centralQuestion:'',requiredClaims:[],requiredMechanisms:[],conceptRegistry:[],scenes:contracts,misconceptions:[],evidenceRefs:[]} as unknown as TeachingPlanV2;
  let previous:CompiledSceneV2|undefined;
  const established:string[]=[];
  for(const scene of scenes){
    options.signal?.throwIfAborted();
    canonicalizeSceneIds(scene);
    applyContainment(scene);
    const narration={text:narrationForScene(scene),beats:scene.beats.map(beat=>({id:beat.id,text:beat.narration}))};
    /** The worker states continuity in concept keys; the compiler expects the
     *  runtime object id of the persistent object. After canonicalization the id
     *  is stable across scenes, so a concept maps to the same id everywhere. */
    scene.continuity.keepFromPrevious=[...new Set(scene.continuity.keepFromPrevious.map(key=>scene.objects.find(object=>object.conceptId===key)?.id??key).filter(id=>scene.objects.some(object=>object.id===id)))];
    let speech:SpeechResult|undefined;
    const ttsStart=Date.now();
    if(options.speech&&narration.text.trim())speech=await narratedSpeech(narration,options.speech,options.signal);
    const ttsMs=Date.now()-ttsStart;
    const compileStart=Date.now();
    const compiled=compileWithRepair(scene,speech?.timing,previous);
    const compileMs=Date.now()-compileStart;
    previous=compiled;
    for(const object of scene.objects)if(object.conceptId&&!established.includes(object.conceptId))established.push(object.conceptId);
    const learnerAfter:LearnerState={...EMPTY_LEARNER,establishedConcepts:[...established]};
    const gate=gateCompiled(compiled);
    if(!gate.passed)throw new Error(`Compile gate failed for ${scene.id}: ${gate.findings.map(finding=>finding.message).join('; ')}`);
    const gates:GateResult[]=[gate];
    const manifest:HarnessRunManifest={
      version:HARNESS_VERSION,
      runId:options.runId??`v3-${doc.sha256.slice(0,12)}`,
      createdAt:new Date().toISOString(),
      inputHash:stableHash({source:doc.sha256,prompt:input.prompt,duration:targetDurationSec}),
      configHash:stableHash({pipeline:'semantic-v3',language:input.language??'en'}),
      schemaHash:stableHash({kind:'v3-visual-scene'}),
      assetHash:stableHash(scene.objects.map(object=>object.assetRef??object.primitiveRef??object.label)),
      promptSkillHash:stableHash({stages:['graph-map','graph-reduce','teacher-planner','scene-worker']}),
      config:{pipeline:'semantic-v3',teacherScenes:contracts.length},
      stages:[],
      gates:[...gates],
      costUsd:model.calls.reduce((sum:number,call:StageCall)=>sum+call.costUsd,0),
      status:'PASS',
    };
    yield {
      plan,compiled,...(speech?{speech}:{}),gates,manifest,learnerAfter,
      healCounts:healCounts(model.events as StageEvent[]),
      metrics:{teachingMs,visualModelMs:undefined,directorMs:undefined,narrationFinalizeMs:undefined,ttsMs,compileMs,sceneReadyMs:Date.now()-started},
    };
  }
}
