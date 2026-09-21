import type {TaskPool} from '../types/runtime.js';
import type {RuntimeRepository} from './repository.js';
import {DisposableWorker,type TaskHandler} from './worker.js';

interface DurableRuntimeLauncherOptions {
  pools:TaskPool[];
  workerCount?:number;
  workerIdPrefix?:string;
  leaseMs?:number;
  idleMs?:number;
  reapMs?:number;
}

/** Owns the process-level lifecycle around stateless leased workers. It is a
 * deliberately small shell: PostgreSQL remains the source of truth, workers
 * can be stopped and restarted safely, and the reaper makes crashed leases
 * visible without requiring a second service. */
export class DurableRuntimeLauncher {
  private readonly repository:RuntimeRepository;
  private readonly handler:TaskHandler;
  private readonly options:Required<DurableRuntimeLauncherOptions>;
  private controllers:AbortController[]=[];
  private runs:Promise<void>[]=[];
  private reaper?:ReturnType<typeof setInterval>;
  private started=false;

  constructor(repository:RuntimeRepository,handler:TaskHandler,options:DurableRuntimeLauncherOptions){
    const workerCount=options.workerCount??1;
    if(!Number.isInteger(workerCount)||workerCount<1||workerCount>32)throw new Error('workerCount must be between 1 and 32');
    const reapMs=options.reapMs??Math.max(100,Math.floor((options.leaseMs??30_000)/2));
    if(!Number.isFinite(reapMs)||reapMs<25)throw new Error('reapMs must be at least 25ms');
    this.repository=repository;this.handler=handler;
    this.options={pools:[...options.pools],workerCount,workerIdPrefix:options.workerIdPrefix??'lesson-worker',leaseMs:options.leaseMs??30_000,idleMs:options.idleMs??250,reapMs};
  }

  start():void {
    if(this.started)return;
    this.started=true;
    this.reaper=setInterval(()=>void this.repository.reapExpiredLeases().catch(()=>{}),this.options.reapMs);
    this.reaper.unref?.();
    for(let index=0;index<this.options.workerCount;index++){
      const controller=new AbortController();
      const worker=new DisposableWorker(this.repository,this.handler,{workerId:`${this.options.workerIdPrefix}-${index+1}`,pools:this.options.pools,leaseMs:this.options.leaseMs,idleMs:this.options.idleMs});
      this.controllers.push(controller);
      this.runs.push(worker.run(controller.signal).catch(()=>{}));
    }
  }

  async stop(reason:unknown=new Error('Runtime launcher stopped')):Promise<void>{
    if(!this.started)return;
    this.started=false;
    if(this.reaper)clearInterval(this.reaper);
    this.reaper=undefined;
    for(const controller of this.controllers)controller.abort(reason);
    await Promise.allSettled(this.runs);
    this.controllers=[];this.runs=[];
  }
}
