import {randomUUID} from 'node:crypto';
import type {DegradationRecord,DurableEvent,DurableTask,TaskPool} from '../types/runtime.js';
import type {RuntimeRepository} from './repository.js';

export interface WorkerResult {
  outputArtifactHash?:string;
  degradation?:DegradationRecord;
  events?:Array<{type:string;payload?:unknown;artifacts?:DurableEvent['artifacts']}>;
}
export type TaskHandler=(task:DurableTask,signal:AbortSignal)=>Promise<WorkerResult>;
interface DisposableWorkerOptions {workerId:string;pools:TaskPool[];leaseMs?:number;idleMs?:number}

/** Stateless worker shell. All ownership lives in the repository lease; killing
 * this process leaves no authoritative state behind, so the reaper can retry it. */
export class DisposableWorker {
  readonly workerId:string;
  readonly pools:TaskPool[];
  readonly leaseMs:number;
  readonly idleMs:number;
  constructor(private readonly repository:RuntimeRepository,private readonly handler:TaskHandler,options:DisposableWorkerOptions){
    if(!options.workerId)throw new Error('workerId is required');
    this.workerId=options.workerId;this.pools=[...options.pools];this.leaseMs=options.leaseMs??30_000;this.idleMs=options.idleMs??250;
  }

  async runOnce(parentSignal?:AbortSignal):Promise<DurableTask|undefined>{
    parentSignal?.throwIfAborted();
    const task=await this.repository.claimTask({workerId:this.workerId,pools:this.pools,leaseMs:this.leaseMs});
    if(!task)return undefined;
    const controller=new AbortController();
    const abort=()=>controller.abort(parentSignal?.reason??new Error('Worker stopping'));
    parentSignal?.addEventListener('abort',abort,{once:true});
    const heartbeat=setInterval(()=>void this.repository.heartbeatTask(task.id,this.workerId,this.leaseMs).then(ok=>{if(!ok)controller.abort(new Error('Task lease lost'));}).catch(error=>controller.abort(error)),Math.max(25,Math.floor(this.leaseMs/3)));
    heartbeat.unref?.();
    try{
      const result=await this.handler(task,controller.signal);
      controller.signal.throwIfAborted();
      const completed=await this.repository.completeTask({taskId:task.id,workerId:this.workerId,outputArtifactHash:result.outputArtifactHash,degradation:result.degradation});
      if(!completed)throw new Error('Task lease expired before completion');
      for(const event of result.events??[])await this.repository.appendEvent({id:randomUUID(),jobId:task.jobId,type:event.type,payload:event.payload,artifacts:event.artifacts});
      await this.finalizeJobIfReady(task.jobId);
    }catch(error){
      const status=await this.repository.failTask({taskId:task.id,workerId:this.workerId,error:error instanceof Error?error.message:String(error)});
      if(status==='failed')await this.repository.setJobStatus(task.jobId,'failed',error instanceof Error?error.message:String(error));
    }finally{
      clearInterval(heartbeat);parentSignal?.removeEventListener('abort',abort);
    }
    return task;
  }

  private async finalizeJobIfReady(jobId:string):Promise<void>{
    const tasks=await this.repository.listTasks(jobId);
    if(tasks.some(candidate=>candidate.status==='failed')){
      await this.repository.setJobStatus(jobId,'failed',tasks.find(candidate=>candidate.status==='failed')?.lastError);
      return;
    }
    if(tasks.length&&tasks.every(candidate=>candidate.status==='succeeded')){
      const degraded=tasks.find(candidate=>candidate.degradation);
      await this.repository.setJobStatus(jobId,degraded?'partial':'complete',degraded?.degradation?.reason);
    }
  }

  async run(signal:AbortSignal):Promise<void>{
    while(!signal.aborted){
      const task=await this.runOnce(signal);if(task)continue;
      await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,this.idleMs);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});}).catch(()=>{});
    }
  }
}
