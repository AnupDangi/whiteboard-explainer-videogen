import {createHash,randomUUID} from 'node:crypto';
import {normalizeLessonRequest,type LessonRequest} from '../types/contracts.js';
import {SYSTEM_VERSIONS} from '../core/versions.js';
import type {DurableEvent,DurableJob,DurableTask,TaskPool,TaskPriority} from '../types/runtime.js';
import type {RuntimeRepository} from './repository.js';

const stableJson=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const requestHash=(request:LessonRequest)=>createHash('sha256').update(stableJson(request)).digest('hex');
export const durableTaskId=(jobId:string,name:string)=>{const hex=createHash('sha256').update(`${jobId}\0${name}`).digest('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;};
const uuidFor=durableTaskId;

export interface DurableJobView extends DurableJob {request:LessonRequest;events:DurableEvent[];tasks:DurableTask[]}
interface PipelineTaskSpec {name:string;kind:string;pool:TaskPool;priority:TaskPriority;dependsOn:string[]}

/** Fixed initial graph for the first-playable fast lane. Later module/scene tasks
 * are appended just in time by worker handlers from validated output artifacts. */
const INITIAL_PIPELINE:readonly PipelineTaskSpec[]=[
  {name:'ingest',kind:'source.ingest',pool:'ingest',priority:0,dependsOn:[]},
  {name:'brief',kind:'teaching.brief',pool:'llm',priority:0,dependsOn:['ingest']},
  {name:'first-plan',kind:'scene.plan.first',pool:'llm',priority:0,dependsOn:['brief']},
  {name:'first-tts',kind:'scene.tts.first',pool:'tts',priority:0,dependsOn:['first-plan']},
  {name:'first-compile',kind:'scene.compile.first',pool:'compile',priority:0,dependsOn:['first-plan','first-tts']},
  // The continuation plan must wait for the first scene to be committed. This
  // preserves the fast lane while making the remainder a real, ordered DAG.
  {name:'next-plan',kind:'scene.plan.next',pool:'llm',priority:1,dependsOn:['first-compile']},
  // Deep understanding is deliberately off the first-playable critical path. Each
  // graph level is persisted as its own resumable task so a worker restart can
  // continue from the last immutable artifact instead of rebuilding the lesson.
  {name:'deep-index',kind:'source.deep-index',pool:'llm',priority:4,dependsOn:['ingest']},
  {name:'graph-l0',kind:'concept-graph.l0',pool:'llm',priority:4,dependsOn:['ingest']},
  {name:'graph-l1',kind:'concept-graph.l1',pool:'llm',priority:4,dependsOn:['graph-l0','first-plan']},
  {name:'graph-l2',kind:'concept-graph.l2',pool:'llm',priority:4,dependsOn:['graph-l1','next-plan']},
  {name:'graph-l3',kind:'concept-graph.l3',pool:'llm',priority:4,dependsOn:['graph-l2','deep-index']},
];

export class DurableJobService {
  constructor(private readonly repository:RuntimeRepository){}

  async submit(value:unknown,idempotencyKey?:string):Promise<DurableJobView>{
    const request=normalizeLessonRequest(value);const hash=requestHash(request);const id=randomUUID();
    const job=await this.repository.createJob({id,request,schemaVersion:SYSTEM_VERSIONS.schema,budgetLimitUsd:request.generationBudget.maxCostUsd,idempotencyKey,requestHash:hash});
    const ids=new Map(INITIAL_PIPELINE.map(spec=>[spec.name,uuidFor(job.id,spec.name)]));
    for(const spec of INITIAL_PIPELINE)await this.repository.enqueueTask({
      id:ids.get(spec.name)!,jobId:job.id,kind:spec.kind,pool:spec.pool,priority:spec.priority,
      // Workers receive the immutable canonical request only on the first task. Later
      // tasks consume its content-addressed output artifacts, avoiding repeated source
      // bytes in queue rows and keeping logs free of prompt text.
      payload:spec.name==='ingest'?{request}: {requestVersion:request.version},
      dependencyIds:spec.dependsOn.map(name=>ids.get(name)!),
    });
    await this.repository.appendEvent({id:uuidFor(job.id,'event:queued'),jobId:job.id,type:'job.queued',payload:{schemaVersion:SYSTEM_VERSIONS.schema}});
    return (await this.get(job.id))!;
  }

  async get(id:string):Promise<DurableJobView|undefined>{
    const job=await this.repository.getJob(id);if(!job)return undefined;
    const [events,tasks]=await Promise.all([this.repository.listEvents(id,0,1000),this.repository.listTasks(id)]);
    return {...job,request:normalizeLessonRequest(job.request),events,tasks};
  }

  cancel(id:string):Promise<boolean>{return this.repository.cancelJob(id);}
  events(id:string,after=0):Promise<DurableEvent[]>{return this.repository.listEvents(id,after,1000);}

  /** Append one long-course module only when the playback horizon needs it. */
  async enqueueModule(jobId:string,moduleIndex:number,sceneCount:number):Promise<DurableTask[]>{
    if(!Number.isInteger(moduleIndex)||moduleIndex<0||!Number.isInteger(sceneCount)||sceneCount<1||sceneCount>20)throw new Error('Invalid module task request');
    if(!await this.repository.getJob(jobId))throw new Error('Job not found');
    const briefId=uuidFor(jobId,'brief');
    const planId=uuidFor(jobId,`module:${moduleIndex}:plan`);
    const created:DurableTask[]=[];
    created.push(await this.repository.enqueueTask({id:planId,jobId,kind:'module.plan',pool:'llm',priority:1,payload:{moduleIndex},dependencyIds:[briefId]}));
    for(let sceneIndex=0;sceneIndex<sceneCount;sceneIndex++){
      const ttsId=uuidFor(jobId,`module:${moduleIndex}:scene:${sceneIndex}:tts`);
      const compileId=uuidFor(jobId,`module:${moduleIndex}:scene:${sceneIndex}:compile`);
      created.push(await this.repository.enqueueTask({id:ttsId,jobId,kind:'scene.tts',pool:'tts',priority:1,payload:{moduleIndex,sceneIndex},dependencyIds:[planId]}));
      created.push(await this.repository.enqueueTask({id:compileId,jobId,kind:'scene.compile',pool:'compile',priority:1,payload:{moduleIndex,sceneIndex},dependencyIds:[planId,ttsId]}));
    }
    await this.repository.appendEvent({id:uuidFor(jobId,`event:module:${moduleIndex}:queued`),jobId,type:'module.queued',payload:{moduleIndex,sceneCount}});
    return created;
  }

  async enqueueExport(jobId:string):Promise<DurableTask>{
    const job=await this.repository.getJob(jobId);if(!job)throw new Error('Job not found');
    if(job.status!=='complete')throw new Error('Job must be complete before export');
    const tasks=await this.repository.listTasks(jobId);const dependencies=tasks.filter(task=>task.kind.startsWith('scene.compile')&&task.status==='succeeded').map(task=>task.id);
    const task=await this.repository.enqueueTask({id:uuidFor(jobId,'export'),jobId,kind:'export.render',pool:'render',priority:3,payload:{format:'mp4'},dependencyIds:dependencies});
    await this.repository.appendEvent({id:uuidFor(jobId,'event:export-queued'),jobId,type:'export.queued',payload:{taskId:task.id}});
    return task;
  }
}
