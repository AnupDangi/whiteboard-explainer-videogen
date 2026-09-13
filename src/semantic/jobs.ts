import {log,logContext} from '../shared/logger.js';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {CompiledSceneV2} from './types.js';
import type {JsonModel} from './planning/model-adapter.js';
import type {VisionJudge} from './vision-judge.js';
import type {V2Speech} from './speech.js';
import {generateV2} from './planning/generate.js';
import type {TeachingInput} from './planning/teaching-planner.js';

export interface SemanticJobOptions {prompt:string;sourceText?:string;sourceId?:string;maxScenes?:number;allowedArchetypes:string[];language?:string;narration:boolean;maxCostUsd?:number}
export interface SemanticSceneSnapshot {id:string;title:string;durationMs:number;timingKind:string;svg:string;audioUrl?:string;metrics:Record<string,number|undefined>;diagnostics:string[]}
export interface SemanticJobSnapshot {id:string;status:'queued'|'planning'|'streaming'|'complete'|'partial'|'error'|'cancelled';revision:number;createdAt:number;prompt:string;language:string;scenes:SemanticSceneSnapshot[];availableMs:number;totalScenes?:number;firstPlayableMs?:number;completedMs?:number;error?:string;errorKind?:string;costUsd:number;calls:number;narration:boolean}
interface InternalSemanticJob extends SemanticJobSnapshot {controller?:AbortController;task?:Promise<void>;model?:JsonModel;judge?:VisionJudge;input?:TeachingInput;speech?:V2Speech}

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
  root:string; factories:{model:(env:NodeJS.ProcessEnv)=>JsonModel;judge?:(env:NodeJS.ProcessEnv)=>VisionJudge;speech?:(language:string)=>V2Speech|Promise<V2Speech>};
  jobs=new Map<string,InternalSemanticJob>();
  constructor(root:string,factories:{model:(env:NodeJS.ProcessEnv)=>JsonModel;judge?:(env:NodeJS.ProcessEnv)=>VisionJudge;speech?:(language:string)=>V2Speech|Promise<V2Speech>}){
    this.root=root;this.factories=factories;
  }
  snapshot(job:InternalSemanticJob):SemanticJobSnapshot{const {controller,task,model,judge,input,speech,...data}=job;return structuredClone(data);}
  async save(job:InternalSemanticJob,type:string){
    job.revision++;
    const path=join(this.root,job.id,'job.json');
    await writeFile(path+'.tmp',JSON.stringify(this.snapshot(job),null,2));await rename(path+'.tmp',path);
    log('semantic-job.'+type,{jobId:job.id,status:job.status,revision:job.revision,readyScenes:job.scenes.length,availableMs:job.availableMs,error:job.error},job.status==='error'?'error':'info');
  }
  async create(options:SemanticJobOptions){
    if(!options.prompt?.trim()||options.prompt.length>4000||(options.sourceText?.length??0)>32000)throw new Error('V2 prompt/source bounds exceeded');
    const maxScenes=options.maxScenes??1;if(!Number.isInteger(maxScenes)||maxScenes<1||maxScenes>8)throw new Error('V2 scene limit must be 1–8');
    if(!Array.isArray(options.allowedArchetypes)||!options.allowedArchetypes.length||options.allowedArchetypes.some(a=>!ARCHETYPE_PATTERN.test(a)))throw new Error('allowedArchetypes required');
    if(typeof options.narration!=='boolean')throw new Error('Invalid narration option');
    if(options.maxCostUsd!==undefined&&(!Number.isFinite(options.maxCostUsd)||options.maxCostUsd<=0||options.maxCostUsd>2))throw new Error('Budget must be above $0 and at most $2');
    const language=options.language??'en';if(!/^[a-zA-Z-]{2,16}$/.test(language))throw new Error('Invalid language');
    const active=[...this.jobs.values()].filter(j=>['queued','planning','streaming'].includes(j.status));
    if(active.length>=MAX_ACTIVE)throw new Error(`${MAX_ACTIVE} semantic jobs already active; wait or cancel one.`);
    const job:InternalSemanticJob={id:randomUUID(),status:'queued',revision:0,createdAt:Date.now(),prompt:options.prompt,language,scenes:[],availableMs:0,costUsd:0,calls:0,narration:options.narration};
    this.jobs.set(job.id,job);await mkdir(join(this.root,job.id),{recursive:true});
    const env=process.env;job.model=this.factories.model(env);job.judge=env.V2_CRITIC==='on'?this.factories.judge?.(env):undefined;
    job.speech=options.narration?await this.factories.speech?.(language):undefined;
    job.input={prompt:options.prompt,sourceText:options.sourceText,sourceId:options.sourceId,maxScenes,allowedArchetypes:options.allowedArchetypes as TeachingInput['allowedArchetypes']};
    const controller=new AbortController();job.controller=controller;
    log('semantic-job.created',{jobId:job.id,language,maxScenes,narration:options.narration,archetypes:options.allowedArchetypes.length});
    job.task=logContext.run({...logContext.getStore(),jobId:job.id},()=>this.run(job,controller.signal));
    return this.snapshot(job);
  }
  private persistScene(job:InternalSemanticJob,scene:CompiledSceneV2,audio?:Buffer,format?:string):SemanticSceneSnapshot{
    const audioUrl=audio?`/media/semantic/${job.id}/${scene.scene.id}.${format??'wav'}`:undefined;
    if(audio)writeFile(join(this.root,job.id,`${scene.scene.id}.${format??'wav'}`),audio).catch(e=>log('semantic-job.audio-write-failed',{error:String(e)},'warn'));
    writeFile(join(this.root,job.id,`${scene.scene.id}.json`),JSON.stringify(scene,null,2)).catch(e=>log('semantic-job.scene-write-failed',{error:String(e)},'warn'));
    return {id:scene.scene.id,title:scene.scene.title,durationMs:scene.durationMs,timingKind:scene.timing.kind,svg:scene.scene.id,audioUrl,metrics:{teachingMs:undefined,...scene.scene?{}:{}},diagnostics:scene.diagnostics};
  }
  async run(job:InternalSemanticJob,signal:AbortSignal){
    try{
      job.status='planning';await this.save(job,'planning');
      for await(const result of generateV2(job.input!,job.model!,{speech:job.speech?(text:string)=>job.speech!(text):undefined,signal,judge:job.judge,criticEnv:process.env})){
        signal.throwIfAborted();
        const scene=result.compiled;
        let audio:Buffer|undefined,format:string|undefined;
        if(result.speech){audio=result.speech.audio;format=result.speech.format;}
        const snapshot=this.persistScene(job,scene,audio,format);
        snapshot.metrics={teachingMs:result.metrics.teachingMs,visualModelMs:result.metrics.visualModelMs,directorMs:result.metrics.directorMs,narrationFinalizeMs:result.metrics.narrationFinalizeMs,ttsMs:result.metrics.ttsMs,compileMs:result.metrics.compileMs,sceneReadyMs:result.metrics.sceneReadyMs,criticMs:result.metrics.criticMs,criticRepairs:result.metrics.criticRepairs};
        job.scenes.push(snapshot);job.availableMs+=scene.durationMs;
        job.costUsd=Number((job.costUsd+job.model!.calls.reduce((s,c)=>s+c.costUsd,0)).toFixed(6));job.calls=job.model!.calls.length;
        if(!job.firstPlayableMs){job.firstPlayableMs=Date.now()-job.createdAt;log('semantic-job.first-playable',{jobId:job.id,firstPlayableMs:job.firstPlayableMs,sceneId:scene.scene.id});}
        if(!job.totalScenes)job.totalScenes=job.input!.maxScenes;
        job.status='streaming';await this.save(job,'scene-ready');
      }
      job.status='complete';job.completedMs=Date.now()-job.createdAt;
      log('semantic-job.summary',{jobId:job.id,status:job.status,wallMs:job.completedMs,firstPlayableMs:job.firstPlayableMs,scenes:job.scenes.length,costUsd:job.costUsd,calls:job.calls});
      await this.save(job,'complete');
    }catch(error){
      const partial=!signal.aborted&&job.scenes.length>0;
      job.status=signal.aborted?'cancelled':(partial?'partial':'error');
      job.error=signal.aborted?'Cancelled by user':(error instanceof Error?error.message:String(error));
      job.errorKind=signal.aborted?'cancel':classifySemanticError(job.error);
      log('semantic-job.failure',{jobId:job.id,errorKind:job.errorKind,error:job.error},signal.aborted?'warn':'error');
      await this.save(job,job.status);
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
  async cancel(id:string){log('semantic-job.cancel-requested',{jobId:id});const job=this.jobs.get(id);if(!job)return false;job.controller?.abort();await job.task;return true;}
  async close(){log('semantic-jobs.shutdown',{jobs:this.jobs.size});for(const job of this.jobs.values())job.controller?.abort();await Promise.allSettled([...this.jobs.values()].map(j=>j.task));}
}
