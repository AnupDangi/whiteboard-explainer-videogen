import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {ingestSources} from '../ingest/sources.js';
import {blocksToContentList} from '../ingest/deep-index/content-list.js';
import {indexContentList} from '../ingest/deep-index/deep-indexer.js';
import {buildL0DocumentGraph} from '../ingest/concept-graph.js';
import {buildL1RetrievedGraph,buildL2LessonGraph,buildL3GlobalGraph} from '../ingest/concept-graph.js';
import {expandTeachingArchitectureNarration,planTeachingArchitecture,lowerTeachingArchitectureToPlan,type TeachingArchitecturePlan} from '../planning/teaching-planner.js';
import {compileScene,estimateTiming} from '../generation/engine.js';
import {retimeWavAudio,scaleTimingToDuration} from '../generation/tts-runtime.js';
import {normalizeLessonRequest} from '../types/contracts.js';
import type {LessonRequest,SourceIR} from '../types/contracts.js';
import type {SourceDocument} from '../types/engine.js';
import type {ArtifactStore} from './artifacts.js';
import type {DurableTask} from '../types/runtime.js';
import type {RuntimeRepository} from './repository.js';
import type {TaskHandler,WorkerResult} from './worker.js';
import type {BudgetLedger} from '../gateway/budget-ledger.js';
import type {PaidSpeechGateway} from '../gateway/paid-speech-gateway.js';
import type {RagGateway} from '../gateway/rag-gateway.js';
import type {LLMGateway} from '../gateway/llm-gateway.js';
import {durableTaskId} from './job-service.js';
import type {CompiledScene,Timing} from '../types/engine.js';

interface DurableHandlerContext {
  repository:RuntimeRepository;
  artifacts:ArtifactStore;
  workingDir:string;
  budgetLedger?:BudgetLedger;
  budgetLimitUsd?:number;
  /** Optional paid provider boundary. If absent, the worker records an explicit
   * estimated-timing degradation instead of silently claiming native audio. */
  paidSpeech?:PaidSpeechGateway;
  ragGateway?:RagGateway;
  visionGateway?:LLMGateway;
}

const jsonBytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
// Compiled handlers live at dist/src/runtime; three levels reach the project
// root where the export script and output directory reside.
const projectRoot=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
/** Preserve the committed scene proportions while making the final integer clock
 * sum exactly equal to the lesson target. The last scene absorbs rounding so the
 * durable lane cannot accumulate millisecond drift. */
const exactSceneTargets=(scenes:readonly {durationMs?:number}[],lessonTargetMs:number):number[]=>{
  const raw=scenes.map(scene=>Number.isFinite(scene.durationMs)&&Number(scene.durationMs)>0?Math.round(Number(scene.durationMs)):0);
  const total=raw.reduce((sum,value)=>sum+value,0);
  if(!Number.isFinite(lessonTargetMs)||lessonTargetMs<=0||!raw.length)return raw;
  if(!total){
    const base=Math.floor(lessonTargetMs/raw.length);
    return raw.map((_,index)=>index===raw.length-1?lessonTargetMs-base*(raw.length-1):base);
  }
  let assigned=0;
  return raw.map((value,index)=>{
    const target=index===raw.length-1?Math.max(0,lessonTargetMs-assigned):Math.max(0,Math.floor(lessonTargetMs*value/total));
    assigned+=target;return target;
  });
};
const sourceIRs=(document:SourceDocument):SourceIR[]=>document.sourceIRs??(document.sourceIR?[document.sourceIR]:[]);
const readJson=async<T>(context:DurableHandlerContext,hash:string):Promise<T>=>{
  const bytes=await context.artifacts.get(hash);if(!bytes)throw new Error(`Artifact ${hash} is unavailable`);
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
};
const priorTask=async(context:DurableHandlerContext,task:DurableTask,kind:string)=>{
  const tasks=await context.repository.listTasks(task.jobId);
  const found=tasks.find(candidate=>candidate.kind===kind&&candidate.status==='succeeded'&&candidate.outputArtifactHash);
  if(!found?.outputArtifactHash)throw new Error(`${task.kind} requires ${kind} output`);
  return found.outputArtifactHash;
};
const sourceForTask=async(context:DurableHandlerContext,task:DurableTask)=>readJson<SourceDocument>(context,await priorTask(context,task,'source.ingest'));
const requestForTask=async(context:DurableHandlerContext,task:DurableTask)=>{
  const job=await context.repository.getJob(task.jobId);if(!job)throw new Error(`Unknown durable job ${task.jobId}`);
  return normalizeLessonRequest(job.request);
};

const planForTask=async(context:DurableHandlerContext,task:DurableTask,kind:string)=>readJson<{scenes:Array<{id:string;narration:string;durationMs?:number}>}>(context,await priorTask(context,task,kind));

/** The first/continuation tasks are intentionally split for fast playback, but
 * their clock must still be allocated from the committed whole lesson. */
const fullPlanForTask=async(context:DurableHandlerContext,task:DurableTask):Promise<{scenes:Array<{id:string;narration:string;durationMs?:number}>}|undefined>=>{
  try {
    const brief=await readJson<TeachingArchitecturePlan>(context,await priorTask(context,task,'teaching.brief'));
    return lowerTeachingArchitectureToPlan(brief);
  } catch { return undefined; }
};

const timingForScene=(value:unknown,sceneId:string):{timing:Timing;audioArtifactHash?:string;format?:string}|undefined=>{
  if(!Array.isArray(value))return undefined;
  const found=value.find(item=>item&&typeof item==='object'&&(item as {sceneId?:unknown}).sceneId===sceneId) as {timing?:Timing;audioArtifactHash?:string;format?:string}|undefined;
  return found?.timing?{timing:found.timing,audioArtifactHash:found.audioArtifactHash,format:found.format}:undefined;
};

async function putJson(context:DurableHandlerContext,kind:string,value:unknown):Promise<string>{
  const reference=await context.artifacts.put(jsonBytes(value),{kind,mediaType:'application/json',version:'runtime-v1'});
  await context.repository.putArtifact(reference);
  return reference.hash;
}

/**
 * Minimal production handlers for the first durable lane. They deliberately
 * commit immutable JSON artifacts and leave model/scene work to specialized
 * handlers, so a missing optional sidecar is a visible degraded task rather
 * than a fake success.
 */
export function createDefaultTaskHandler(context:DurableHandlerContext):TaskHandler{
  return async(task:DurableTask,signal:AbortSignal):Promise<WorkerResult>=>{
    signal.throwIfAborted();
    if(task.kind==='source.ingest'){
      const request=(task.payload as {request?:LessonRequest}).request;
      if(!request)throw new Error('source.ingest task is missing its canonical request');
      // Prompt-only lessons carry their text in `instruction`; normalizeLessonRequest folds
      // prompt sources out of `sources`, so rebuild one here before ingesting.
      const sources=request.sources.length?request.sources:[{kind:'prompt' as const,text:request.instruction??''}];
      const document=await ingestSources(sources,signal,{gateway:context.visionGateway,jobId:task.jobId,budgetLimitUsd:request.generationBudget.maxCostUsd});
      const hash=await putJson(context,'source-document',document);
      return {outputArtifactHash:hash,events:[{type:'source.ready',payload:{artifactHash:hash,sourceCount:sourceIRs(document).length}}]};
    }
    if(task.kind==='concept-graph.l0'){
      const document=await sourceForTask(context,task);
      const source=sourceIRs(document)[0];if(!source)throw new Error('source document has no readable SourceIR');
      const graph=buildL0DocumentGraph(source);const hash=await putJson(context,'concept-graph-l0',graph);
      return {outputArtifactHash:hash,events:[{type:'concept-graph.ready',payload:{level:'L0',artifactHash:hash}}]};
    }
    if(task.kind==='source.deep-index'){
      const document=await sourceForTask(context,task);
      const items=sourceIRs(document).flatMap(source=>blocksToContentList(source.blocks));
      const result=await indexContentList({contentList:items,filePath:`${context.workingDir}/${task.jobId}.json`,workingDir:context.workingDir,docId:document.identity?.id,...(context.budgetLedger?{gateway:{ledger:context.budgetLedger,ragGateway:context.ragGateway,jobId:task.jobId,budgetLimitUsd:context.budgetLimitUsd??1}}:{})});
      if(!result||result.ok!==true){
        const degradation={code:result?'deep-index-failed':'deep-index-unavailable',stage:'source.deep-index',reason:result?.error??'Deep index is disabled or unavailable in this runtime',at:new Date().toISOString(),recoverable:true} as const;
        return {degradation,events:[{type:'task.degraded',payload:{kind:task.kind,code:degradation.code,reason:degradation.reason}}]};
      }
      const hash=await putJson(context,'deep-index-manifest',result);
      return {outputArtifactHash:hash,events:[{type:'deep-index.ready',payload:{artifactHash:hash,items:result.items??0}}]};
    }
    if(task.kind==='teaching.brief'){
      const request=await requestForTask(context,task);const document=await sourceForTask(context,task);
      const architecture=expandTeachingArchitectureNarration(planTeachingArchitecture(request,sourceIRs(document)));
      const hash=await putJson(context,'teaching-brief',architecture);
      return {outputArtifactHash:hash,events:[{type:'teaching.brief.ready',payload:{artifactHash:hash,subject:architecture.brief.subject}}]};
    }
    if(task.kind==='scene.plan.first'||task.kind==='scene.plan.next'||task.kind==='module.plan'){
      const briefHash=await priorTask(context,task,'teaching.brief');
      const architecture=await readJson<TeachingArchitecturePlan>(context,briefHash);
      const plan=lowerTeachingArchitectureToPlan(architecture);
      const selected=task.kind==='scene.plan.first'?{...plan,scenes:plan.scenes.slice(0,1)}:task.kind==='scene.plan.next'?{...plan,scenes:plan.scenes.slice(1)}:plan;
      const hash=await putJson(context,'scene-plan',selected);
      // The continuation graph is created from the immutable plan exactly once.
      // Enqueueing here keeps the initial fast lane small while making the full
      // lesson resumable and visible to the durable worker.
      if(task.kind==='scene.plan.next'&&selected.scenes.length){
        const ttsId=durableTaskId(task.jobId,'scene:tts.next');
        await context.repository.enqueueTask({id:ttsId,jobId:task.jobId,kind:'scene.tts.next',pool:'tts',priority:1,payload:{sceneCount:selected.scenes.length},dependencyIds:[task.id]});
        await context.repository.enqueueTask({id:durableTaskId(task.jobId,'scene:compile.next'),jobId:task.jobId,kind:'scene.compile.next',pool:'compile',priority:1,payload:{sceneCount:selected.scenes.length},dependencyIds:[task.id,ttsId]});
      }
      return {outputArtifactHash:hash,events:[{type:'scene.plan.ready',payload:{artifactHash:hash,kind:task.kind,scenes:selected.scenes.length}}]};
    }
    if(task.kind==='scene.tts.first'||task.kind==='scene.tts'||task.kind==='scene.tts.next'||task.kind==='first-tts'){
      const first=task.kind==='scene.tts.first'||task.kind==='first-tts';
      const next=task.kind==='scene.tts.next';
      const planHash=await priorTask(context,task,first?'scene.plan.first':next?'scene.plan.next':'module.plan');
      const plan=await readJson<{scenes:Array<{id:string;narration:string;durationMs?:number}>}>(context,planHash);
      const request=await requestForTask(context,task);
      const lessonTargetMs=request.durationMinutes*60_000;
      const fullPlan=first||next?await fullPlanForTask(context,task):undefined;
      const fullCount=fullPlan?.scenes.length??plan.scenes.length;
      // compileScene reserves a deterministic 650ms visual tail per scene. TTS
      // therefore owns the lesson target minus those tails, so compiled playback
      // (audio + visual tail) lands exactly on the requested duration.
      const fullAudioTargetMs=first||next?Math.max(fullCount,lessonTargetMs-fullCount*650):lessonTargetMs;
      let targetLessonMs=fullAudioTargetMs;
      if(next){
        const tasks=await context.repository.listTasks(task.jobId);
        const firstTts=tasks.find(candidate=>(candidate.kind==='scene.tts.first'||candidate.kind==='first-tts')&&candidate.status==='succeeded'&&candidate.outputArtifactHash);
        if(firstTts?.outputArtifactHash){
          const firstTiming=await readJson<Array<{actualDurationMs?:number}>>(context,firstTts.outputArtifactHash);
          const firstActual=firstTiming.reduce((sum,item)=>sum+(Number(item.actualDurationMs)||0),0);
          targetLessonMs=Math.max(1,targetLessonMs-firstActual);
        }
      }
      const referenceScenes=fullPlan?.scenes??plan.scenes;
      const referenceTargets=exactSceneTargets(referenceScenes,fullAudioTargetMs);
      let sceneTargets=first?referenceTargets.slice(0,1):next?referenceTargets.slice(1):exactSceneTargets(plan.scenes,lessonTargetMs);
      if(next&&fullPlan){
        const baseline=sceneTargets.reduce((sum,value)=>sum+value,0);
        let assigned=0;
        sceneTargets=sceneTargets.map((value,index)=>{
          const target=index===sceneTargets.length-1?Math.max(1,targetLessonMs-assigned):Math.max(1,Math.floor(targetLessonMs*value/Math.max(1,baseline)));
          assigned+=target;return target;
        });
      }
      const timings=[] as Array<{sceneId:string;timing:ReturnType<typeof estimateTiming>;targetDurationMs?:number;actualDurationMs:number;durationDeltaMs:number;audioArtifactHash?:string;format?:string}>;
      const degradations=[] as NonNullable<WorkerResult['degradation']>[];
      for(const [index,scene] of plan.scenes.entries()){
        const targetDurationMs=sceneTargets[index]||undefined;
        if(context.paidSpeech){
          const result=await context.paidSpeech.synthesize({jobId:task.jobId,taskId:task.id,providerRequestId:`${task.id}:${scene.id}`,text:scene.narration,voiceId:request.stylePreferences.voiceId,limitUsd:request.generationBudget.maxCostUsd,signal});
          let audioBytes=result.audio, timing=result.timing, actualDurationMs=result.timing.durationMs;
          if(targetDurationMs&&result.format==='wav'&&Math.abs(actualDurationMs-targetDurationMs)>1){
            const retimed=await retimeWavAudio(result.audio,actualDurationMs,targetDurationMs,signal);
            audioBytes=retimed.audio;actualDurationMs=retimed.durationMs;timing=scaleTimingToDuration(timing,targetDurationMs);
          }else if(targetDurationMs&&Math.abs(actualDurationMs-targetDurationMs)>1){
            degradations.push({code:'tts-duration-mismatch',stage:'scene.tts',reason:`${result.format} audio is ${actualDurationMs}ms but the committed scene target is ${targetDurationMs}ms; format cannot be retimed in the durable worker`,at:new Date().toISOString(),recoverable:true});
          }
          const audio=await context.artifacts.put(audioBytes,{kind:'scene-audio',mediaType:result.format==='mp3'?'audio/mpeg':'audio/wav',version:'runtime-v1'});
          await context.repository.putArtifact(audio);
          timings.push({sceneId:scene.id,timing,targetDurationMs,actualDurationMs,durationDeltaMs:targetDurationMs?actualDurationMs-targetDurationMs:0,audioArtifactHash:audio.hash,format:result.format??'wav'});
        }else{
          const estimated=estimateTiming(scene.narration);
          const timing=targetDurationMs?scaleTimingToDuration(estimated,targetDurationMs):estimated;
          const actualDurationMs=timing.durationMs;
          timings.push({sceneId:scene.id,timing,targetDurationMs,actualDurationMs,durationDeltaMs:targetDurationMs?actualDurationMs-targetDurationMs:0});
        }
      }
      // Keep the long-standing array artifact shape for existing consumers; each
      // entry carries its committed target/actual clock and the event carries the
      // job-level exactness summary.
      const actualDurationMs=timings.reduce((sum,item)=>sum+item.actualDurationMs,0);
      const durationDeltaMs=actualDurationMs-targetLessonMs;
      const hash=await putJson(context,'tts-timing',timings);
      const estimatedDegradation=context.paidSpeech?undefined:{code:'tts-provider-unconfigured',stage:'scene.tts',reason:'Durable TTS worker used deterministic estimated timing because no paid speech gateway was configured',at:new Date().toISOString(),recoverable:true} as const;
      const clockDegradation=Math.abs(durationDeltaMs)>1?{code:'tts-lesson-duration-mismatch',stage:'scene.tts',reason:`durable TTS timeline is ${actualDurationMs}ms but the lesson target is ${lessonTargetMs}ms`,at:new Date().toISOString(),recoverable:true} as const:undefined;
      const degradation=degradations[0]??clockDegradation??estimatedDegradation;
      return {outputArtifactHash:hash,degradation,events:[{type:'scene.tts.ready',payload:{artifactHash:hash,scenes:timings.length,lessonTargetMs:targetLessonMs,actualDurationMs,durationDeltaMs,timingSource:context.paidSpeech?'provider':'deterministic-estimate',degraded:Boolean(degradation)}}]};
    }
    if(task.kind==='scene.compile.first'||task.kind==='scene.compile'||task.kind==='scene.compile.next'){
      const first=task.kind==='scene.compile.first';
      const next=task.kind==='scene.compile.next';
      const planHash=await priorTask(context,task,first?'scene.plan.first':next?'scene.plan.next':'module.plan');
      const plan=await readJson<{scenes:Array<any>}>(context,planHash);
      const ttsHash=await priorTask(context,task,first?'scene.tts.first':next?'scene.tts.next':'scene.tts');
      const timings=await readJson<unknown>(context,ttsHash);
      const compiled:CompiledScene[]=[];
      for(const scene of plan.scenes){
        const matched=timingForScene(timings,scene.id);
        let compiledScene=compileScene(scene,matched?.timing);
        if(matched?.audioArtifactHash){
          const audio=await context.artifacts.get(matched.audioArtifactHash);
          if(audio){
            const ext=matched.format==='mp3'?'mp3':'wav';
            const directory=join(context.workingDir,task.jobId);await mkdir(directory,{recursive:true});
            await writeFile(join(directory,`${scene.id}.${ext}`),audio);
            compiledScene={...compiledScene,audioUrl:`/media/${task.jobId}/${scene.id}.${ext}`};
          }
        }
        compiled.push(compiledScene);
      }
      const hash=await putJson(context,'compiled-scenes',compiled);
      return {outputArtifactHash:hash,events:[{type:'scene.playable',payload:{artifactHash:hash,scenes:compiled.length}}]};
    }
    if(task.kind==='concept-graph.l1'||task.kind==='concept-graph.l2'||task.kind==='concept-graph.l3'){
      const document=await sourceForTask(context,task);const sources=sourceIRs(document);const source=sources[0];
      if(!source)throw new Error('concept graph requires a readable SourceIR');
      const headings=sources.flatMap(item=>item.blocks.filter(block=>block.type==='heading').map(block=>({id:block.id,label:block.text,sourceBlockIds:[block.id]})));
      const graph=task.kind==='concept-graph.l1'
        ?buildL1RetrievedGraph(document.sha256,headings)
        :task.kind==='concept-graph.l2'
          ?buildL2LessonGraph(document.sha256,{version:1,requirements:[],notFitting:[]},[])
          :buildL3GlobalGraph(document.sha256,headings);
      const hash=await putJson(context,`concept-graph-${task.kind.slice(-2)}`,graph);
      return {outputArtifactHash:hash,events:[{type:'concept-graph.ready',payload:{level:task.kind.slice(-2).toUpperCase(),artifactHash:hash}}]};
    }
    if(task.kind==='export.render'){
      const job=await context.repository.getJob(task.jobId);
      const compileTasks=(await context.repository.listTasks(task.jobId)).filter(candidate=>candidate.kind.startsWith('scene.compile')&&candidate.status==='succeeded'&&candidate.outputArtifactHash).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
      if(!job||job.status!=='complete'){
        const degradation={code:'export-blocked-incomplete-job',stage:'export.render',reason:`Export requires a complete durable job; current status is ${job?.status??'missing'}`,at:new Date().toISOString(),recoverable:true} as const;
        return {degradation,events:[{type:'task.degraded',payload:{kind:task.kind,code:degradation.code,reason:degradation.reason}}]};
      }
      if(!compileTasks.length){
        const degradation={code:'export-missing-compiled-scenes',stage:'export.render',reason:'Export requires at least one succeeded compiled-scene artifact',at:new Date().toISOString(),recoverable:true} as const;
        return {degradation,events:[{type:'task.degraded',payload:{kind:task.kind,code:degradation.code,reason:degradation.reason}}]};
      }
      const compiled=[] as CompiledScene[];
      for(const candidate of compileTasks){
        const value=await readJson<CompiledScene[]>(context,candidate.outputArtifactHash!);
        compiled.push(...value);
      }
      const request=normalizeLessonRequest(job.request);
      const availableMs=compiled.reduce((sum,scene)=>sum+scene.durationMs,0);
      const targetMs=request.durationMinutes*60000;
      // Never publish a playable artifact whose audio clock is materially shorter
      // or longer than the requested lesson. The compile lane normally makes this
      // exact; this guard protects resumed/manual jobs and keeps partial exports
      // auditable instead of silently shipping the wrong duration.
      if(availableMs<Math.round(targetMs*.9)||availableMs>targetMs){
        const degradation={code:'export-duration-mismatch',stage:'export.render',reason:`Compiled duration ${availableMs}ms is outside the allowed 90–100% window for ${targetMs}ms`,at:new Date().toISOString(),recoverable:true} as const;
        return {degradation,events:[{type:'task.degraded',payload:{kind:task.kind,code:degradation.code,reason:degradation.reason,availableMs,targetMs}}]};
      }
      const snapshot={id:job.id,status:'complete',revision:0,createdAt:job.createdAt,mode:'model',targetMinutes:request.durationMinutes,plannerBudgetUsd:job.budgetLimitUsd,ttsCharacters:0,timingMode:'durable',simulatedDelayMs:0,scenes:compiled,availableMs,events:[],title:compiled[0]?.title??request.instruction??'Lesson',totalScenes:compiled.length,actualMinutes:availableMs/60000,request,captionMode:request.stylePreferences.captionMode??'off'};
      const directory=join(context.workingDir,task.jobId);await mkdir(directory,{recursive:true});
      const inputPath=join(directory,'job.json');await writeFile(inputPath,JSON.stringify(snapshot));
      const outputDir=join(projectRoot,'output');await mkdir(outputDir,{recursive:true});
      const outputPath=join(outputDir,`${task.jobId}.mp4`);const clipsDir=join(outputDir,`${task.jobId}.clips`);
      const child=spawn(process.execPath,[resolve(projectRoot,'dist/scripts/export.js'),'--input',inputPath,'--out',outputPath,'--clips-dir',clipsDir,'--fps','12','--width','1280'],{cwd:projectRoot,stdio:['ignore','pipe','pipe']});
      let stderr='';child.stderr?.on('data',chunk=>stderr+=String(chunk));
      const [code]=await once(child,'close') as [number|null];
      if(code!==0)throw new Error(`Durable MP4 export failed (${code}): ${stderr.slice(-1200)}`);
      const video=await readFile(outputPath);const reference=await context.artifacts.put(video,{kind:'lesson-export',mediaType:'video/mp4',version:'runtime-v1'});await context.repository.putArtifact(reference);
      const info=await stat(outputPath);
      const hash=await putJson(context,'export-manifest',{version:1,status:'ready',format:'mp4',output:`/output/${task.jobId}.mp4`,artifactHash:reference.hash,sizeBytes:info.size,durationMs:snapshot.availableMs,completedAt:new Date().toISOString()});
      return {outputArtifactHash:hash,events:[{type:'export.ready',payload:{artifactHash:hash,videoArtifactHash:reference.hash,output:`/output/${task.jobId}.mp4`,durationMs:snapshot.availableMs}}]};
    }
    throw new Error(`No durable handler registered for ${task.kind}`);
  };
}
