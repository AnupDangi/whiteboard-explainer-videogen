import {stageFailure} from '../repair.js';
import {planTeaching,type TeachingInput} from './teaching-planner.js';
import {selectVisualModel} from './visual-model.js';
import {directVisual} from './visual-director.js';
import {finalizeNarration} from './narration.js';
import {compileScene} from '../compiler/compile-scene.js';
import {criticRepair} from '../critic-repair.js';
import {canonicalizeVisualScene} from '../identity/canonicalize.js';
import {assetCandidates} from './visual-director.js';
import type {JsonModel} from './model-adapter.js';
import type {CompiledSceneV2,VisualTiming} from '../types.js';
import type {VisionJudge} from '../vision-judge.js';
import type {SpeechResult} from '../speech.js';
import {randomUUID} from 'node:crypto';
import type {StageJournal} from '../harness/journal.js';
import {TeachingHarness} from '../harness/teaching-harness.js';
import {advanceLearnerState,conceptGraphFromPlan,contractsFromScene,defaultLearnerProfile,deriveContinuityDecisions,initialLearnerState,stableHash,whiteboardPlanFromContracts} from '../harness/state.js';
import {LessonSemanticRegistry} from '../harness/registry.js';
import {gateBoardAlignment,gateCompiled,gateConceptGraph,gateLesson,gateTeachingContracts,gateVisual,gateWhiteboard} from '../harness/gates.js';
import {HARNESS_VERSION,type LearnerProfile} from '../harness/contracts.js';
import type {GateResult,HarnessStage} from '../harness/contracts.js';
import {renderSVG} from '../renderer/render-svg.js';
import {compileKnowledge,chapterWindows,mergeGroundedPlans,attachSourceVisuals} from './knowledge-compiler.js';
import type {TeachingPlanV2} from '../types.js';

export interface StageMetrics {
  teachingMs:number;
  visualModelMs:number;
  directorMs:number;
  narrationFinalizeMs:number;
  ttsMs:number;
  compileMs:number;
  sceneReadyMs:number;
  criticMs?:number;
  criticRepairs?:number;
}

export interface TelemetryEvent {
  stage: 'teaching' | 'visual-model' | 'representation' | 'director' | 'narration-finalize' | 'tts' | 'compile' | 'critic';
  status: 'started' | 'success' | 'failure';
  elapsedMs?: number;
  atMs?: number;
  error?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GenerateOptions {
  speech?:(text:string)=>Promise<SpeechResult>;
  signal?:AbortSignal;
  judge?:VisionJudge;
  criticEnv?:NodeJS.ProcessEnv;
  onTelemetry?:(event:TelemetryEvent)=>void;
  journal?:StageJournal;
  resume?:boolean;
  runId?:string;
  learnerProfile?:LearnerProfile;
}

export async function* generateV2(input:TeachingInput,model:JsonModel,options:GenerateOptions={}){
 const start=performance.now();
 let previous:CompiledSceneV2|undefined;
 const runId=options.runId??randomUUID(),harness=new TeachingHarness({runId,input,journal:options.journal}),gates=harness.gates;
 const learnerProfile=structuredClone(options.learnerProfile??defaultLearnerProfile(input.language));
 let learnerState=initialLearnerState(learnerProfile);
 const telemetry=(stage:TelemetryEvent['stage'],status:TelemetryEvent['status'],extra:Partial<TelemetryEvent>={})=>options.onTelemetry?.({stage,status,...extra,atMs:performance.now()-start});
 const passGate=(stage:HarnessStage):GateResult=>({stage,passed:true,findings:[]});
 await harness.execute({resume:options.resume,stage:'ingest',input,run:()=>({sourceId:input.sourceId??null,sourceChars:input.sourceText?.length??0,promptChars:input.prompt.length,language:input.language}),gate:()=>passGate('ingest')});
 const teachingStart=performance.now();
 telemetry('teaching','started');
 let plan,conceptGraph;
 try{
   const beforeCalls=model.calls.length;
   const buildKnowledge=async(repairFindings?:string[])=>{
    if(input.sourceText){
     const graph=attachSourceVisuals(await compileKnowledge({prompt:input.prompt,sourceText:input.sourceText,sourceId:input.sourceId,language:input.language,repairFindings},model),input.sourceFigures,input.sourceId);
     const windows=chapterWindows(input.sourceText);
     const perWindow=Math.max(1,Math.floor((input.maxScenes??1)/windows.length));
     const planned:TeachingPlanV2[]=[];let prior:string[]=[];
     for(const [index,window] of windows.entries()){
      const chapterPlan=await planTeaching({...input,sourceText:window.text,maxScenes:perWindow},model,{repairFindings,conceptGraph:graph,chapter:{index:index+1,count:windows.length,priorConcepts:prior,maxScenes:perWindow}});
      planned.push(chapterPlan);prior=[...new Set([...prior,...chapterPlan.scenes.flatMap(scene=>scene.requiredConceptIds)])];
     }
     return {plan:mergeGroundedPlans(graph,planned.map((plan,index)=>({window:windows[index],plan}))),conceptGraph:graph};
    }
    const generated=await planTeaching(input,model,{repairFindings});
    const sourceVisuals=(input.sourceFigures??[]).map((figure,index)=>({id:`source-visual:${index+1}`,sourceId:input.sourceId??'source',page:figure.page,caption:figure.caption,provenance:`source-${figure.kind}`}));
    return {plan:generated,conceptGraph:conceptGraphFromPlan(generated,sourceVisuals)};
   };
   const stage=await harness.execute({resume:options.resume,stage:'knowledge-compiler',input,run:()=>buildKnowledge(),repair:async({error,gate})=>{const findings=gate.findings.filter(f=>f.severity==='hard').map(f=>`${f.code}: ${f.message}`);if(!findings.length)throw error;return buildKnowledge(findings);},gate:value=>gateConceptGraph(value.conceptGraph),model:()=>model.calls.at(-1)?.model,promptHash:stableHash({stage:'knowledge-compiler',version:HARNESS_VERSION}),skillHash:stableHash('knowledge-compiler'),usage:()=>{const calls=model.calls.slice(beforeCalls);return {costUsd:calls.reduce((n,c)=>n+c.costUsd,0),promptTokens:calls.reduce((n,c)=>n+c.promptTokens,0),completionTokens:calls.reduce((n,c)=>n+c.completionTokens,0)};}});
  plan=stage.output.plan;conceptGraph=stage.output.conceptGraph;
  telemetry('teaching','success',{elapsedMs:performance.now()-teachingStart,details:{harnessStage:'knowledge-compiler',harnessVersion:HARNESS_VERSION}});
 }catch(e){telemetry('teaching','failure',{error:e instanceof Error?e.message:String(e),elapsedMs:performance.now()-teachingStart});throw stageFailure(e,'teaching');}
 const teachingMs=performance.now()-teachingStart;
 const semanticRegistry=new LessonSemanticRegistry(conceptGraph);
 const criticEnabled=(options.criticEnv??process.env).V2_CRITIC==='on'&&Boolean(options.judge);
 const lessonArchitecture=[];let projectedState=structuredClone(learnerState);
 for(const semantic of plan.scenes){const learnerBefore=structuredClone(projectedState);const architect=await harness.execute({resume:options.resume,stage:'teaching-architect',input:{scene:semantic,learnerState:projectedState,conceptGraph},run:()=>contractsFromScene(semantic,plan,projectedState),gate:contracts=>gateTeachingContracts(contracts,projectedState,conceptGraph)});const board=await harness.execute({resume:options.resume,stage:'whiteboard-planner',input:{contracts:architect.output,scene:semantic},run:()=>whiteboardPlanFromContracts(semantic,architect.output),gate:value=>gateWhiteboard(value,semantic)});projectedState=advanceLearnerState(projectedState,architect.output,conceptGraph);lessonArchitecture.push({semantic,learnerBefore,contracts:architect.output,board:board.output});}
 for(const lessonScene of lessonArchitecture){
  options.signal?.throwIfAborted();
  const {semantic,learnerBefore,contracts,board}=lessonScene;
  let at=performance.now();
  telemetry('visual-model','started');
  let mentalModel;
  try{mentalModel=selectVisualModel(semantic,plan.conceptRegistry,{keepFromPrevious:[],prepareForNext:previous?.scene.objects.map(o=>o.conceptId).filter((id):id is string=>Boolean(id))??[]},input.allowedArchetypes);telemetry('visual-model','success',{elapsedMs:performance.now()-at});}catch(e){telemetry('visual-model','failure',{error:e instanceof Error?e.message:String(e),elapsedMs:performance.now()-at});throw stageFailure(e,'visual-model');}
  const visualModelMs=performance.now()-at;
  at=performance.now();
  telemetry('representation','started');
  let candidates:ReturnType<typeof assetCandidates>,groundedSourceVisualIds:string[]=[];
  try{
   const representationStage=await harness.execute({resume:options.resume,stage:'representation-guide',input:{semantic,mentalModel},run:()=>assetCandidates(semantic,plan.conceptRegistry,mentalModel),gate:value=>({stage:'representation-guide',passed:value.every(candidate=>candidate.candidates.length>0||Boolean(candidate.representation)),findings:value.filter(candidate=>!candidate.candidates.length&&!candidate.representation).map(candidate=>({stage:'representation-guide',code:'REPRESENTATION_DEGRADATION' as const,severity:'hard' as const,message:`No representation for ${candidate.conceptId}`}))})});candidates=representationStage.output;
   const warnings=candidates.flatMap(candidate=>candidate.warnings);
   const groundingStage=await harness.execute({resume:options.resume,stage:'source-visual-grounding',input:{semantic,conceptGraph,representationWarnings:warnings,groundingPolicy:input.groundingPolicy??'source-only'},run:()=>({policy:input.groundingPolicy??'source-only',sourceVisualIds:conceptGraph.sourceVisuals.map(v=>v.id)}),gate:()=>passGate('source-visual-grounding')});groundedSourceVisualIds=groundingStage.output.sourceVisualIds;
   telemetry('representation','success',{elapsedMs:performance.now()-at,details:{warnings,fallbackCount:warnings.length}});
  }catch(e){telemetry('representation','failure',{error:e instanceof Error?e.message:String(e),elapsedMs:performance.now()-at});throw stageFailure(e,'representation');}
  at=performance.now();
  telemetry('director','started');
  let directed:Awaited<ReturnType<typeof directVisual>>;
  try{const beforeDirectorCalls=model.calls.length;const buildDirected=async(repairNotes?:string[])=>{const value=await directVisual(semantic,plan.conceptRegistry,mentalModel,model,previous,input.language,{candidates,sourceVisualIds:groundedSourceVisualIds,repairNotes,whiteboardPlan:board});value.scene=canonicalizeVisualScene(semantic.id,value.scene,plan.conceptRegistry);
    // Bridge semantic continuity (concept keys) to runtime continuity (object ids).
    // Per-scene canonical ids differ, so resolve each kept concept to the current
    // object with the same appearance; the compiler then reuses previous geometry
    // and rejects appearance changes as persistent-identity violations.
    if(previous&&semantic.continuity.keepFromPrevious.length){
     const keep=new Set<string>();
     for(const key of semantic.continuity.keepFromPrevious){
      const before=previous.objects.filter(o=>o.conceptId===key),now=value.scene.objects.filter(o=>o.conceptId===key);
      for(const n of now){const p=before.find(b=>b.role===n.role&&b.assetRef===n.assetRef&&b.representation?.family===n.representation?.family&&b.primitiveRef===n.primitiveRef);if(p)keep.add(n.id);}
     }
     value.scene.continuity.keepFromPrevious=[...keep];
    }
    value.scene.continuity.transitions=deriveContinuityDecisions(value.scene,previous,semanticRegistry.snapshot());
    return value;};
   const directorGate=(value:Awaited<ReturnType<typeof buildDirected>>)=>{const visual=gateVisual(value.scene,semanticRegistry.snapshot()),boardGate=gateBoardAlignment(board,value.scene);return {stage:'visual-director' as const,passed:visual.passed&&boardGate.passed,findings:[...visual.findings,...boardGate.findings]};};
   const visualStage=await harness.execute({resume:options.resume,stage:'visual-director',input:{semantic,mentalModel,whiteboardPlan:board,registry:semanticRegistry.snapshot(),candidates,groundedSourceVisualIds},run:()=>buildDirected(),repair:async({error,gate})=>{const findings=gate.findings.filter(f=>f.severity==='hard').map(f=>`${f.code}: ${f.message}`);if(!findings.length)throw error;return buildDirected(findings);},gate:directorGate,model:()=>model.calls.at(-1)?.model,promptHash:stableHash({stage:'visual-director',version:HARNESS_VERSION}),skillHash:stableHash('visual-director'),usage:()=>{const calls=model.calls.slice(beforeDirectorCalls);return {costUsd:calls.reduce((n,c)=>n+c.costUsd,0),promptTokens:calls.reduce((n,c)=>n+c.promptTokens,0),completionTokens:calls.reduce((n,c)=>n+c.completionTokens,0)};}});directed=visualStage.output;
    telemetry('director','success',{elapsedMs:performance.now()-at});}catch(e){telemetry('director','failure',{error:e instanceof Error?e.message:String(e),elapsedMs:performance.now()-at});throw stageFailure(e,'director');}
  const directorMs=performance.now()-at;
  at=performance.now();
  telemetry('narration-finalize','started');
  let narration;
  try{narration=finalizeNarration(semantic,directed.scene);telemetry('narration-finalize','success',{elapsedMs:performance.now()-at});}catch(e){telemetry('narration-finalize','failure',{error:e instanceof Error?e.message:String(e),elapsedMs:performance.now()-at});throw stageFailure(e,'narration-finalize');}
  const narrationFinalizeMs=performance.now()-at;
  // P0-E execution DAG: speech and visual compile run concurrently after the
  // narration freeze. The estimated compile lands first (firstVisualReady) while
  // TTS is still running; the final timeline rebinds when speech timing arrives.
  options.signal?.throwIfAborted();
  telemetry('tts','started');telemetry('compile','started');
  const ttsStart=performance.now(),compileStart=performance.now();
  const ttsPromise=(async()=>{try{const s=options.speech?await options.speech(narration.text):undefined;telemetry('tts','success',{elapsedMs:performance.now()-ttsStart,timingKind:s?.timing.kind});return s;}catch(e){telemetry('tts','failure',{error:e instanceof Error?e.message:String(e),elapsedMs:performance.now()-ttsStart});throw stageFailure(e,'tts');}})();
  const visualPromise=(async()=>{try{const c=compileScene(directed.scene,undefined,previous);telemetry('compile','success',{elapsedMs:performance.now()-compileStart,diagnostics:c.diagnostics,preliminary:true});return c;}catch(e){telemetry('compile','failure',{error:e instanceof Error?e.message:String(e),elapsedMs:performance.now()-compileStart});throw stageFailure(e,'compile');}})();
  let speech:Awaited<typeof ttsPromise>,compiled:Awaited<typeof visualPromise>;
  try{[speech,compiled]=await Promise.all([ttsPromise,visualPromise]);}catch(e){options.signal?.throwIfAborted();throw e;}
  const ttsMs=performance.now()-ttsStart;
  if(speech?.timing){
   options.signal?.throwIfAborted();const rebindStart=performance.now();
   try{compiled=compileScene(directed.scene,speech.timing,previous);telemetry('compile','success',{elapsedMs:performance.now()-rebindStart,diagnostics:compiled.diagnostics});}catch(e){telemetry('compile','failure',{error:e instanceof Error?e.message:String(e),elapsedMs:performance.now()-rebindStart});throw stageFailure(e,'compile');}
  }
  let compileMs=performance.now()-compileStart;
  await harness.execute({resume:options.resume,stage:'compiler',input:directed.scene,run:()=>compiled,gate:gateCompiled});
  await harness.execute({resume:options.resume,stage:'tts-alignment',input:{narrationHash:stableHash(narration),enabled:Boolean(options.speech)},run:()=>speech?{provider:speech.provider??'unknown',timingSource:speech.timingSource??speech.timing.timingSource??'estimated',durationMs:speech.timing.durationMs,wordCount:speech.timing.words.length}:{provider:'none',timingSource:'estimated',durationMs:compiled.durationMs,wordCount:compiled.timing.words.length},gate:()=>passGate('tts-alignment')});
  let criticMs:number|undefined,criticRepairs:number|undefined;
  if(criticEnabled){
   at=performance.now();
   telemetry('critic','started');
   try{
    const outcome=await criticRepair(compiled,{judge:options.judge!,model,registry:plan.conceptRegistry,semantic,mentalModel,previous});
    compiled=outcome.scene;criticMs=performance.now()-at;criticRepairs=outcome.repaired?1:0;
    telemetry('critic','success',{elapsedMs:criticMs,repairs:criticRepairs});
   }catch(e){
    telemetry('critic','failure',{error:e instanceof Error?e.message:String(e),elapsedMs:performance.now()-at});
    throw e;
   }
  }
  semanticRegistry.observeScene(directed.scene,compiled);
  learnerState=advanceLearnerState(learnerState,contracts,conceptGraph);
  await harness.execute({resume:options.resume,stage:'pedagogy-critic',input:{plan,learnerBefore,learnerAfter:learnerState,scene:compiled.scene},run:()=>gateLesson(plan,gates),gate:value=>value});
  await harness.execute({resume:options.resume,stage:'render',input:{sceneId:compiled.scene.id,compiledHash:stableHash(compiled)},run:()=>({sceneId:compiled.scene.id,finalFrameHash:stableHash(renderSVG(compiled,compiled.durationMs,{cursor:false,captions:true}))}),gate:()=>passGate('render')});
  previous=compiled;
  const manifest=harness.manifest({config:{learnerProfile,criticEnabled},schema:{planVersion:plan.version,sceneVersion:directed.scene.version},assets:directed.scene.objects.map(o=>o.assetRef??o.primitiveRef),promptSkills:{stages:['knowledge-compiler','teaching-architect','whiteboard-planner','visual-director','pedagogy-critic']},costUsd:model.calls.reduce((n,c)=>n+c.costUsd,0)});
  yield {plan,semantic,mentalModel,directed,narration,compiled,speech,conceptGraph,learnerBefore,learnerAfter:structuredClone(learnerState),teachingContracts:contracts,whiteboardPlan:board,registry:semanticRegistry.snapshot(),gates:[...gates],manifest,metrics:{teachingMs,visualModelMs,directorMs,narrationFinalizeMs,ttsMs,compileMs,sceneReadyMs:performance.now()-start,criticMs,criticRepairs} satisfies StageMetrics};
 }
}
