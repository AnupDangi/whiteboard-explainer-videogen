import {log,logContext} from '../shared/logger.js';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,rename,readFile,stat,copyFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import type {CompiledSceneV2} from './types.js';
import type {JsonModel} from './planning/model-adapter.js';
import type {VisionJudge} from './vision-judge.js';
import type {V2Speech} from './speech.js';
import {generateV2} from './planning/generate.js';
import type {TeachingInput} from './planning/teaching-planner.js';
import {ingestSource} from '../explainer/sources.js';
import {loadModelRouter,loadModelFallbacks,DEFAULT_FAST_MODEL} from '../shared/model-router.js';
import {jobBudgetMs} from './harness/budget.js';
import {retrievalMode} from './planning/representation-external.js';
import type {SourceInput,SourceFigure} from '../shared/types.js';
import {FileStageJournal} from './harness/journal.js';
import {HARNESS_VERSION,type GateResult,type HarnessRunManifest,type LearnerProfile,type StageOwner} from './harness/contracts.js';
import {DEFAULT_STAGE_POLICIES} from './harness/stage.js';

export interface SemanticJobOptions {prompt:string;sourceText?:string;sourceId?:string;source?:SourceInput;sourceFigures?:SourceFigure[];maxScenes?:number;allowedArchetypes:string[];language?:string;narration:boolean;maxCostUsd?:number;autoMp4?:boolean;learnerProfile?:Partial<LearnerProfile>;groundingPolicy?:'source-only'|'source-plus-verified';targetMinutes?:number;harnessVersion?:string;resumeFrom?:string}
export interface SemanticSceneSnapshot {id:string;title:string;durationMs:number;timingKind:string;svg:string;compiledUrl?:string;audioUrl?:string;metrics:Record<string,number|undefined>;diagnostics:string[]}
export interface SemanticJobSnapshot {id:string;status:'queued'|'planning'|'streaming'|'complete'|'partial'|'error'|'cancelled'|'interrupted';revision:number;createdAt:number;prompt:string;language:string;scenes:SemanticSceneSnapshot[];availableMs:number;totalScenes?:number;firstPlayableMs?:number;completedMs?:number;error?:string;errorKind?:string;costUsd:number;calls:number;narration:boolean;autoMp4?:boolean;mp4Status?:'pending'|'ready'|'failed'|'withheld';mp4Url?:string;mp4Error?:string;harnessVersion:string;finalGate:'PENDING'|'PASS'|'FAIL'|'PARTIAL';publishable:boolean;currentStage?:string;stageOwner?:StageOwner;gates:GateResult[];manifestUrl?:string;learnerProgression?:{establishedConcepts:string[];checkpoints:number};continuityDecisions?:number;semanticRepairCount?:number;modelRoutes?:string[];groundingPolicy:'source-only'|'source-plus-verified';targetMinutes?:number;learnerProfile?:LearnerProfile;resumeFrom?:string;maxCostUsd?:number}
interface InternalSemanticJob extends SemanticJobSnapshot {controller?:AbortController;task?:Promise<void>;model?:JsonModel;judge?:VisionJudge;input?:TeachingInput;speech?:V2Speech;learnerProfile?:LearnerProfile;manifest?:HarnessRunManifest;resumeFrom?:string}

/** Failure taxonomy mirrors explainer/jobs.ts classifyError for the V2 stages. */
export function classifySemanticError(message:string):string{
  if(/aborted due to timeout|TimeoutError/i.test(message))return 'timeout';
  if(/content filter|provider refused/i.test(message))return 'provider-refused';
  if(/truncated|incomplete or refused|finish_reason/i.test(message))return 'provider-truncated';
  if(/budget|cost ceiling/i.test(message))return 'budget';
  if(/Speech|voice-engine/i.test(message))return 'speech';
  if(/requires 2|requires one|exceeds|Untaught|Uncovered|Unrepresented|never appears|Untimed|Equation walkthrough|Matrix operation|Hierarchy|Flow|Cycle|Trajectory|Timeline|Spatial|Structural/i.test(message))return 'plan';
  if(/No teaching asset|Unavailable semantic anchor|asset/i.test(message))return 'asset';
  if(/validation exhausted|schema|Unavailable|Missing|invented|changed/i.test(message))return 'plan';
  if(/OpenRouter|HTTP \d/i.test(message))return 'provider';
  return 'unknown';
}

const MAX_ACTIVE=2,ARCHETYPE_PATTERN=/^[a-z_]+$/;

/** Local single-process V2 job worker: durable snapshots, one scene pushed per
 *  generateV2 yield so the client can start playing before later scenes finish. */
export class SemanticJobStore {
  root:string; factories:{model:(env:NodeJS.ProcessEnv,options?:{jobId:string;maxCostUsd?:number;signal:AbortSignal})=>JsonModel;judge?:(env:NodeJS.ProcessEnv)=>VisionJudge;speech?:(language:string,signal?:AbortSignal)=>V2Speech|Promise<V2Speech>};
  jobs=new Map<string,InternalSemanticJob>();
  queue:string[]=[];
  outputDir:string;
  constructor(root:string,factories:{model:(env:NodeJS.ProcessEnv,options?:{jobId:string;maxCostUsd?:number;signal:AbortSignal})=>JsonModel;judge?:(env:NodeJS.ProcessEnv)=>VisionJudge;speech?:(language:string,signal?:AbortSignal)=>V2Speech|Promise<V2Speech>},outputDir?:string){
    this.root=root;this.factories=factories;this.outputDir=outputDir??join(process.cwd(),'output');
  }
  snapshot(job:InternalSemanticJob):SemanticJobSnapshot{const {controller,task,model,judge,input,speech,manifest,...data}=job;return structuredClone(data);}
  async save(job:InternalSemanticJob,type:string){
    job.revision++;
    const path=join(this.root,job.id,'job.json');
    await writeFile(path+'.tmp',JSON.stringify(this.snapshot(job),null,2));await rename(path+'.tmp',path);
    log('semantic-job.'+type,{jobId:job.id,status:job.status,revision:job.revision,readyScenes:job.scenes.length,availableMs:job.availableMs,error:job.error},job.status==='error'?'error':'info');
  }
  async create(options:SemanticJobOptions){
    const controller=new AbortController();
    let sourceText=options.sourceText,sourceId=options.sourceId,sourceFigures=options.sourceFigures;
    if(options.source){
      if(sourceText!==undefined)throw new Error('Provide source or sourceText, not both');
      const doc=await ingestSource(options.source,controller.signal);
      const sourceMax=Number(process.env?.V2_SOURCE_MAX_CHARS??200000);
sourceText=doc.text.length>sourceMax?doc.text.slice(0,sourceMax).replace(/\s+\S*$/,''):doc.text;
      sourceId=`src_${doc.sha256.slice(0,28)}`;
      sourceFigures=doc.figures;
      if(doc.text.length>sourceText.length)log('semantic-job.source-truncated',{chars:doc.text.length,kept:sourceText.length});
    }
    if(!options.prompt?.trim()||options.prompt.length>4000||(sourceText?.length??0)>200000)throw new Error('V2 prompt/source bounds exceeded');
    const maxScenes=options.maxScenes??Math.min(24,Math.max(1,Math.ceil((options.targetMinutes??.5)*2)));if(!Number.isInteger(maxScenes)||maxScenes<1||maxScenes>24)throw new Error('V2 scene limit must be 1–24');
    if(!Array.isArray(options.allowedArchetypes)||!options.allowedArchetypes.length||options.allowedArchetypes.some(a=>!ARCHETYPE_PATTERN.test(a)))throw new Error('allowedArchetypes required');
    if(typeof options.narration!=='boolean')throw new Error('Invalid narration option');
    if(options.autoMp4!==undefined&&typeof options.autoMp4!=='boolean')throw new Error('Invalid autoMp4 option');
    if(options.harnessVersion!==undefined&&options.harnessVersion!==HARNESS_VERSION)throw new Error(`Unsupported harness version: ${options.harnessVersion}`);
    if(options.resumeFrom!==undefined){
      if(!/^[a-f0-9-]{36}$/.test(options.resumeFrom))throw new Error('Invalid resumeFrom job id');
      const previous=await this.get(options.resumeFrom);
      if(!previous)throw new Error(`Resume source job ${options.resumeFrom} not found`);
      if(previous.harnessVersion!==HARNESS_VERSION)throw new Error(`Resume source harness ${previous.harnessVersion} does not match ${HARNESS_VERSION}`);
    }
    if(options.groundingPolicy!==undefined&&!['source-only','source-plus-verified'].includes(options.groundingPolicy))throw new Error('Invalid grounding policy');
    retrievalMode(process.env.VISUAL_ICONS);
    if(options.targetMinutes!==undefined&&(!Number.isFinite(options.targetMinutes)||options.targetMinutes<1||options.targetMinutes>60))throw new Error('Target minutes must be 1–60');
    const configuredCostCeiling=Number(process.env.V2_MAX_JOB_COST_USD??2);if(!Number.isFinite(configuredCostCeiling)||configuredCostCeiling<=0||configuredCostCeiling>100)throw new Error('Invalid V2_MAX_JOB_COST_USD');
    if(options.maxCostUsd!==undefined&&(!Number.isFinite(options.maxCostUsd)||options.maxCostUsd<=0||options.maxCostUsd>configuredCostCeiling))throw new Error(`Budget must be above $0 and at most $${configuredCostCeiling}`);
    const language=options.language??'en';if(!/^[a-zA-Z-]{2,16}$/.test(language))throw new Error('Invalid language');
    if(options.learnerProfile?.level&&!['novice','beginner','intermediate','advanced'].includes(options.learnerProfile.level))throw new Error('Invalid learner level');
    for(const values of [options.learnerProfile?.goals,options.learnerProfile?.assumedKnowledge,options.learnerProfile?.constraints])if(values!==undefined&&(!Array.isArray(values)||values.length>32||values.some(value=>typeof value!=='string'||!value.trim()||value.length>200)))throw new Error('Invalid learner profile');
    const profile: LearnerProfile={level:options.learnerProfile?.level??'beginner',goals:options.learnerProfile?.goals??[],language:options.learnerProfile?.language??language,assumedKnowledge:options.learnerProfile?.assumedKnowledge??[],constraints:options.learnerProfile?.constraints};
    const job:InternalSemanticJob={id:randomUUID(),status:'queued',revision:0,createdAt:Date.now(),prompt:options.prompt,language,scenes:[],availableMs:0,costUsd:0,calls:0,narration:options.narration,harnessVersion:HARNESS_VERSION,finalGate:'PENDING',publishable:false,gates:[],groundingPolicy:options.groundingPolicy??'source-only',targetMinutes:options.targetMinutes,learnerProfile:profile,...(options.autoMp4?{autoMp4:true}:{}),...(options.resumeFrom?{resumeFrom:options.resumeFrom}:{}),...(options.maxCostUsd!==undefined?{maxCostUsd:options.maxCostUsd}:{})};
    job.controller=controller;
    const env=process.env;job.model=this.factories.model(env,{jobId:job.id,maxCostUsd:options.maxCostUsd,signal:controller.signal});job.judge=env.V2_CRITIC==='on'?this.factories.judge?.(env):undefined;
    job.speech=options.narration?await this.factories.speech?.(language,controller.signal):undefined;
    job.input={prompt:options.prompt,sourceText,sourceId,sourceFigures,maxScenes,allowedArchetypes:options.allowedArchetypes as TeachingInput['allowedArchetypes'],language,targetMinutes:options.targetMinutes,groundingPolicy:options.groundingPolicy??'source-only'};
    if(options.narration&&!job.speech)throw new Error('Speech provider unavailable');
    await mkdir(join(this.root,job.id),{recursive:true});this.jobs.set(job.id,job);
    if(options.resumeFrom){
      try{await copyFile(join(this.root,options.resumeFrom,'stage-journal.ndjson'),join(this.root,job.id,'stage-journal.ndjson'));log('semantic-job.resume-journal-copied',{jobId:job.id,resumeFrom:options.resumeFrom});}
      catch(e){log('semantic-job.resume-fresh',{jobId:job.id,resumeFrom:options.resumeFrom,reason:String(e instanceof Error?e.message:e)});}
    }
    /** Routing and feature flags are logged up front: a stage silently running
     *  on a weak route, or icon retrieval left on, must be visible at job start
     *  rather than inferred from failures later. */
    log('semantic-job.routes',{jobId:job.id,routes:loadModelRouter(process.env,process.env.OPENROUTER_MODEL??DEFAULT_FAST_MODEL),fallbacks:loadModelFallbacks(process.env),visualIcons:retrievalMode(process.env.VISUAL_ICONS),jobBudgetMs:jobBudgetMs(options.targetMinutes,process.env),critic:process.env.V2_CRITIC==='on'});
    log('semantic-job.created',{jobId:job.id,language,maxScenes,narration:options.narration,archetypes:options.allowedArchetypes.length,...(options.source?{sourceKind:options.source.kind}:{}),...(sourceText!==undefined?{sourceChars:sourceText.length}:{})});
    const active=[...this.jobs.values()].filter(entry=>entry!==job&&['planning','streaming'].includes(entry.status));
    if(active.length>=MAX_ACTIVE){job.status='queued';this.queue.push(job.id);log('semantic-job.queued',{jobId:job.id,activeJobs:active.length});await this.save(job,'queued');}
    else this.start(job);
    return this.snapshot(job);
  }
  private start(job:InternalSemanticJob){
    job.status='planning';/** `logDir` is what makes the per-job log.jsonl land beside the job: V2 keeps
    *  its jobs under `.data/semantic/<id>`, and the logger's default of
    *  `.data/<id>` produced a silently empty file for every semantic job. */
    job.task=logContext.run({...logContext.getStore(),jobId:job.id,logDir:join(this.root,job.id)},()=>this.run(job,job.controller!.signal)).finally(()=>{void this.dequeue();});
  }
  private async dequeue(){
    if(!this.queue.length)return;
    const active=[...this.jobs.values()].filter(entry=>['planning','streaming'].includes(entry.status));
    if(active.length>=MAX_ACTIVE)return;
    const nextId=this.queue.shift();const next=nextId?this.jobs.get(nextId):undefined;
    if(!next)return;
    log('semantic-job.dequeued',{jobId:next.id,activeJobs:active.length});
    this.start(next);
  }
  private async persistScene(job:InternalSemanticJob,scene:CompiledSceneV2,audio?:Buffer,format?:string):Promise<SemanticSceneSnapshot>{
    const audioUrl=audio?`/media/semantic/${job.id}/${scene.scene.id}.${format??'wav'}`:undefined;
    if(audio)await this.writeArtifact(join(this.root,job.id,`${scene.scene.id}.${format??'wav'}`),audio);
    await this.writeArtifact(join(this.root,job.id,`${scene.scene.id}.json`),JSON.stringify(scene,null,2));
    return {id:scene.scene.id,title:scene.scene.title,durationMs:scene.durationMs,timingKind:scene.timing.kind,svg:scene.scene.id,compiledUrl:`/media/semantic/${job.id}/${scene.scene.id}.json`,audioUrl,metrics:{teachingMs:undefined,...scene.scene?{}:{}},diagnostics:scene.diagnostics};
  }
  async writeArtifact(path:string,content:string|Buffer){await writeFile(path+'.tmp',content);await rename(path+'.tmp',path);}
  /** Render the finished job to a single MP4. Loud on failure; callers record it. */
  async exportMp4(id:string):Promise<{output:string;size:string}>{
    const job=await this.get(id);
    if(!job)throw new Error('Job not found');
    if(job.status!=='complete'||job.finalGate!=='PASS'||!job.publishable||!job.scenes.length)throw new Error(`Job ${id} is not publishable; only complete PASS jobs export`);
    const outputPath=join(this.outputDir,`${id}.mp4`);
    await mkdir(this.outputDir,{recursive:true});
    await new Promise<void>((resolve,reject)=>{
      const proc=spawn('node',['dist/scripts/export-semantic-job.js','--job',id,'--out',outputPath,'--fps','12','--data-root',this.root],{stdio:'pipe',cwd:process.cwd()});
      let err='';
      proc.stderr.on('data',d=>err+=d.toString());
      proc.on('error',e=>reject(e instanceof Error?e:new Error(String(e))));
      proc.on('close',code=>code===0?resolve():reject(new Error(`Semantic export exited ${code}: ${err}`.trim())));
    });
    const size=Math.round((await stat(outputPath)).size/1024)+' KB';
    return {output:`/output/${id}.mp4`,size};
  }
  /** Best-effort background assembly after playable scenes commit. Never fails the job. */
  private async autoAssemble(job:InternalSemanticJob):Promise<void>{
    job.mp4Status='pending';delete job.mp4Url;delete job.mp4Error;
    await this.save(job,'mp4-pending').catch(e=>log('semantic-job.mp4-pending-failed',{jobId:job.id,error:String(e)},'error'));
    try{
      const result=await this.exportMp4(job.id);
      job.mp4Status='ready';job.mp4Url=result.output;
      log('semantic-job.mp4-ready',{jobId:job.id,...result});
    }catch(e){
      job.mp4Status='failed';job.mp4Error=e instanceof Error?e.message:String(e);
      log('semantic-job.mp4-failed',{jobId:job.id,error:job.mp4Error},'error');
    }
    await this.save(job,'mp4-'+job.mp4Status!).catch(e=>log('semantic-job.persistence-failed',{jobId:job.id,error:String(e)},'error'));
  }
  async run(job:InternalSemanticJob,signal:AbortSignal){
    try{
      job.status='planning';await this.save(job,'planning');
      const journal=new FileStageJournal(join(this.root,job.id,'stage-journal.ndjson'));
      const stageMap={teaching:'knowledge-compiler','visual-model':'representation-guide',representation:'source-visual-grounding',director:'visual-director','narration-finalize':'whiteboard-planner',tts:'tts-alignment',compile:'compiler',critic:'pedagogy-critic'} as const;
      for await(const result of generateV2(job.input!,job.model!,{speech:job.speech?(text:string)=>job.speech!(text):undefined,signal,judge:job.judge,criticEnv:process.env,journal,resume:Boolean(job.resumeFrom),runId:job.id,learnerProfile:job.learnerProfile,onTelemetry:event=>{const stage=(event.details?.harnessStage as keyof typeof DEFAULT_STAGE_POLICIES|undefined)??stageMap[event.stage];job.currentStage=stage;job.stageOwner=DEFAULT_STAGE_POLICIES[stage].owner;}})){
        signal.throwIfAborted();
        const scene=result.compiled;
        let audio:Buffer|undefined,format:string|undefined;
        if(result.speech){audio=result.speech.audio;format=result.speech.format;}
        const snapshot=await this.persistScene(job,scene,audio,format);
        snapshot.metrics={teachingMs:result.metrics.teachingMs,visualModelMs:result.metrics.visualModelMs,directorMs:result.metrics.directorMs,narrationFinalizeMs:result.metrics.narrationFinalizeMs,ttsMs:result.metrics.ttsMs,compileMs:result.metrics.compileMs,sceneReadyMs:result.metrics.sceneReadyMs,criticMs:result.metrics.criticMs,criticRepairs:result.metrics.criticRepairs};
        signal.throwIfAborted();
        job.scenes.push(snapshot);job.availableMs+=scene.durationMs;
        job.costUsd=Number((job.model!.calls.reduce((s,c)=>s+(c.costUsd??0),0)).toFixed(6));job.calls=job.model!.calls.length;
        if(!job.firstPlayableMs){job.firstPlayableMs=Date.now()-job.createdAt;log('semantic-job.first-playable',{jobId:job.id,firstPlayableMs:job.firstPlayableMs,sceneId:scene.scene.id});}
        job.totalScenes=result.plan.scenes.length;
        job.gates=result.gates;job.manifest=result.manifest;job.manifestUrl=`/media/semantic/${job.id}/harness-manifest.json`;job.learnerProgression={establishedConcepts:result.learnerAfter.establishedConcepts,checkpoints:result.learnerAfter.checkpoints.length};job.continuityDecisions=result.compiled.scene.continuity.transitions?.length??result.compiled.scene.continuity.keepFromPrevious.length;job.modelRoutes=[...new Set(job.model!.calls.map(c=>c.model))];job.semanticRepairCount=result.healCounts.semantic;
        await this.writeArtifact(join(this.root,job.id,'harness-manifest.json'),JSON.stringify(result.manifest,null,2));
        job.status='streaming';await this.save(job,'scene-ready');
      }
      const targetMs=job.targetMinutes?job.targetMinutes*60000:undefined,ratio=targetMs?job.availableMs/targetMs:1;
      if(targetMs){const passed=ratio>=.85&&ratio<=1.15,durationGate:GateResult={stage:'tts-alignment',passed,findings:passed?[]:[{stage:'tts-alignment',code:'TIMING',severity:'hard',message:`Prepared duration ${Math.round(job.availableMs/1000)}s is outside the requested ${job.targetMinutes} minute window`,context:{targetMs,actualMs:job.availableMs,acceptedRatio:[.85,1.15]}}]};job.gates.push(durationGate);if(job.manifest){job.manifest.gates.push(durationGate);job.manifest.status=passed?'PASS':'FAIL';await this.writeArtifact(join(this.root,job.id,'harness-manifest.json'),JSON.stringify(job.manifest,null,2));}}
      const durationPassed=!targetMs||(ratio>=.85&&ratio<=1.15);job.status=durationPassed?'complete':'partial';job.finalGate=durationPassed?'PASS':'FAIL';job.publishable=durationPassed;job.completedMs=Date.now()-job.createdAt;job.currentStage='render';job.stageOwner='renderer';
      if(!durationPassed){job.error=`Prepared duration ${Math.round(job.availableMs/1000)}s did not satisfy the requested ${job.targetMinutes} minute duration gate.`;job.errorKind='timing';job.mp4Status='withheld';job.mp4Error='Final duration gate did not pass; MP4 publication withheld.';}
      const callTotals=(job.model?.calls??[]).reduce((totals,call)=>({costUsd:totals.costUsd+call.costUsd,promptTokens:totals.promptTokens+call.promptTokens,completionTokens:totals.completionTokens+call.completionTokens}),{costUsd:0,promptTokens:0,completionTokens:0});
      log('semantic-job.summary',{jobId:job.id,status:job.status,wallMs:job.completedMs,firstPlayableMs:job.firstPlayableMs,scenes:job.scenes.length,costUsd:Number(callTotals.costUsd.toFixed(6)),calls:job.calls,promptTokens:callTotals.promptTokens,completionTokens:callTotals.completionTokens,modelRoutes:[...new Set((job.model?.calls??[]).map(call=>call.model))],finalGate:job.finalGate,mp4Status:job.mp4Status});
      await this.save(job,'complete');
    }catch(error){
      const partial=!signal.aborted&&job.scenes.length>0;
      job.status=signal.aborted?'cancelled':(partial?'partial':'error');
      job.error=signal.aborted?'Cancelled by user':(error instanceof Error?error.message:String(error));
      job.errorKind=signal.aborted?'cancel':classifySemanticError(job.error);
      job.finalGate=signal.aborted?'PARTIAL':'FAIL';job.publishable=false;job.mp4Status=job.scenes.length?'withheld':job.mp4Status;job.mp4Error=job.scenes.length?'Final teaching gate did not pass; MP4 publication withheld.':job.mp4Error;
      log('semantic-job.failure',{jobId:job.id,errorKind:job.errorKind,error:job.error},signal.aborted?'warn':'error');
      job.costUsd=Number((job.model?.calls.reduce((s,c)=>s+(c.costUsd??0),0)??0).toFixed(6));job.calls=job.model?.calls.length??0;
      await this.save(job,job.status).catch(e=>log('semantic-job.persistence-failed',{jobId:job.id,error:String(e)},'error'));
    }
    if(job.autoMp4&&job.status==='complete'&&job.finalGate==='PASS'&&job.publishable&&job.scenes.length&&!signal.aborted){
      await this.autoAssemble(job);
    }
  }
  async get(id:string):Promise<SemanticJobSnapshot|null>{
    if(!/^[a-f0-9-]{36}$/.test(id))return null;
    if(this.jobs.has(id))return this.snapshot(this.jobs.get(id)!);
    try{const job=JSON.parse(await readFile(join(this.root,id,'job.json'),'utf8'));
      if(['queued','planning','streaming'].includes(job.status)){job.status='interrupted';job.error='Server restarted; create a new job. Prepared scenes remain playable.';}
      return job;
    }catch{return null;}
  }
  /** Resume a failed/interrupted job from its last validated journal boundary. */
  async retry(id:string):Promise<SemanticJobSnapshot>{
    const previous=await this.get(id);
    if(!previous)throw new Error('Job not found');
    const directory=join(this.root,id);
    const files=await readdir(directory).catch(()=>[] as string[]);
    const ingestArtifact=files.find(file=>file.startsWith('stage-001-ingest')&&file.endsWith('-input.json'));
    if(!ingestArtifact)throw new Error(`Job ${id} has no ingest artifact to resume from`);
    const input=JSON.parse(await readFile(join(directory,ingestArtifact),'utf8')) as TeachingInput;
    if(!Array.isArray(input.allowedArchetypes)||!input.allowedArchetypes.length)throw new Error(`Job ${id} has no archetypes recorded`);
    return this.create({prompt:input.prompt,sourceText:input.sourceText,sourceId:input.sourceId,sourceFigures:input.sourceFigures,maxScenes:input.maxScenes,allowedArchetypes:input.allowedArchetypes as string[],language:input.language??previous.language,narration:previous.narration,targetMinutes:previous.targetMinutes,groundingPolicy:previous.groundingPolicy,maxCostUsd:previous.maxCostUsd,learnerProfile:previous.learnerProfile?{...previous.learnerProfile}:undefined,autoMp4:previous.autoMp4,resumeFrom:id});
  }
  async cancel(id:string){log('semantic-job.cancel-requested',{jobId:id});const job=this.jobs.get(id);if(!job)return false;if(job.status==='queued'){this.queue=this.queue.filter(entry=>entry!==id);job.status='cancelled';await this.save(job,'cancelled').catch(()=>null);return true;}job.controller?.abort();await job.task;return true;}
  async close(){log('semantic-jobs.shutdown',{jobs:this.jobs.size});for(const job of this.jobs.values())job.controller?.abort();await Promise.allSettled([...this.jobs.values()].map(j=>j.task));}
}
