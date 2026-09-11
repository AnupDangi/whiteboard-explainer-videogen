import {log} from './logger.js';
import type {Timing} from './types.js';
import {ensureKokoroServer,synthesizeAtServer} from './kokoro-speech.js';

/** Bounded, priority-ordered Kokoro worker pool.
 *
 *  Why this exists: one kokoro server serializes on kokoro-mlx's internal lock, and the
 *  job runner used to fire every scene of every chapter at once. Twenty queued requests
 *  meant the tail waited past any fixed ceiling and a 120 s timeout killed a fully
 *  planned, fully paid job. This pool bounds in-flight work to one request per worker,
 *  dispatches by scene order so scene 1 is always first, and measures QUEUE WAIT and
 *  SERVICE TIME separately — the old single 120 s budget conflated them, which is what
 *  fired. Pool size is measured (default 2: N>=3 degrades under memory pressure on one
 *  Metal GPU); a down worker is health-gated and skipped, never a failure source. */

export interface TtsPoolResult {audio:Buffer;timing:Timing;format?:'wav'|'mp3';worker:string;serviceMs:number;waitMs:number}
export interface TtsPoolRequest {key:string;priority:number;text:string;voice?:string}
export interface TtsPoolStats {enqueued:number;completed:number;failed:number;retries:number;cancelled:number}
export interface TtsPoolOptions {
  urls:string[];
  env?:NodeJS.ProcessEnv;
  fetcher?:typeof fetch;
  serviceTimeoutMs?:number;
  queueTimeoutMs?:number;
  maxRetries?:number;
  synthesize?:(url:string,text:string,voice:string|undefined,signal:AbortSignal)=>Promise<{audio:Buffer;timing:Timing;format?:'wav'|'mp3'}>;
  onEvent?:(event:string,data:Record<string,unknown>)=>void;
}
export interface TtsPool {
  enqueue(req:TtsPoolRequest):Promise<TtsPoolResult>;
  cancel(key:string):boolean;
  depth():number;
  stats():TtsPoolStats;
  close():void;
}

interface Entry {
  seq:number;key:string;priority:number;text:string;voice?:string;enqueuedAt:number;retries:number;
  settled:boolean;attempting:boolean;controller?:AbortController;queueTimer?:ReturnType<typeof setTimeout>;
  resolve:(r:TtsPoolResult)=>void;reject:(e:Error)=>void;
}

export function poolUrlsFromEnv(env:NodeJS.ProcessEnv):string[] {
  const raw=env.KOKORO_SERVER_URLS||env.KOKORO_SERVER_URL||'http://127.0.0.1:8765';
  const urls=raw.split(',').map(s=>s.trim().replace(/\/+$/,'')).filter(Boolean);
  return urls.length?urls:['http://127.0.0.1:8765'];
}

export function createTtsPool(options:TtsPoolOptions):TtsPool {
  const env=options.env??process.env;
  const fetcher=options.fetcher??fetch;
  const urls=[...options.urls];
  const serviceTimeoutMs=options.serviceTimeoutMs??60_000;
  const queueTimeoutMs=options.queueTimeoutMs??180_000;
  const maxRetries=options.maxRetries??1;
  const emit=(event:string,data:Record<string,unknown>)=>{if(options.onEvent)options.onEvent(event,data);};
  const synthesize=options.synthesize??(async(url:string,text:string,voice:string|undefined,signal:AbortSignal)=>{
    await ensureKokoroServer(url,env,fetcher);
    const r=await synthesizeAtServer(url,text,voice,signal,fetcher);
    return {audio:r.audio,timing:r.timing,format:r.format};
  });

  const queue:Entry[]=[];
  const inFlight=new Map<string,Entry>();
  const stats:TtsPoolStats={enqueued:0,completed:0,failed:0,retries:0,cancelled:0};
  let seq=0,closed=false;
  let waiters:Array<()=>void>=[];
  const notify=()=>{const w=waiters;waiters=[];for(const r of w)r();};
  const waitForWork=()=>new Promise<void>(res=>waiters.push(res));
  const remove=(entry:Entry)=>{const i=queue.indexOf(entry);if(i>=0)queue.splice(i,1);};

  const armQueueTimeout=(entry:Entry)=>{
    if(entry.queueTimer)clearTimeout(entry.queueTimer);
    entry.queueTimer=setTimeout(()=>{
      if(entry.settled||entry.attempting)return;
      entry.settled=true;stats.failed++;remove(entry);
      emit('tts.queue-timeout',{key:entry.key,queueTimeoutMs,depth:queue.length});
      entry.reject(new Error(`Kokoro speech queue timeout after ${queueTimeoutMs} ms (workers down or overloaded)`));
      notify();
    },queueTimeoutMs);
    entry.queueTimer.unref?.();
  };

  const pickNext=():Entry|undefined=>{
    if(!queue.length)return undefined;
    queue.sort((a,b)=>a.priority-b.priority||a.seq-b.seq);
    return queue.shift();
  };

  async function run(url:string,entry:Entry){
    entry.attempting=true;
    if(entry.queueTimer){clearTimeout(entry.queueTimer);entry.queueTimer=undefined;}
    inFlight.set(entry.key,entry);
    const waitMs=Math.round(performance.now()-entry.enqueuedAt);
    entry.controller=new AbortController();
    const signal=AbortSignal.any([entry.controller.signal,AbortSignal.timeout(serviceTimeoutMs)]);
    const started=performance.now();
    try{
      const r=await synthesize(url,entry.text,entry.voice,signal);
      if(entry.settled)return;
      entry.settled=true;stats.completed++;
      emit('tts.dispatch',{key:entry.key,worker:url,waitMs,serviceMs:Math.round(performance.now()-started)});
      entry.resolve({...r,worker:url,serviceMs:Math.round(performance.now()-started),waitMs});
    }catch(error){
      if(entry.settled)return;
      if(entry.retries<maxRetries){
        entry.retries++;stats.retries++;
        emit('tts.retry',{key:entry.key,worker:url,attempt:entry.retries,error:error instanceof Error?error.message:String(error)});
        entry.attempting=false;
        entry.controller=undefined;
        entry.enqueuedAt=performance.now();
        entry.seq=seq++;
        queue.push(entry);
        armQueueTimeout(entry);
        notify();
      }else{
        entry.settled=true;stats.failed++;
        emit('tts.failed',{key:entry.key,worker:url,error:error instanceof Error?error.message:String(error)});
        entry.reject(error instanceof Error?error:new Error(String(error)));
      }
    }finally{
      inFlight.delete(entry.key);
      entry.attempting=false;
      notify();
    }
  }

  async function worker(url:string){
    while(!closed){
      const entry=pickNext();
      if(!entry){if(closed)return;await waitForWork();continue;}
      await run(url,entry);
    }
  }

  for(const url of urls)worker(url).catch(error=>log('tts.pool-worker-crashed',{url,error},'error'));

  return {
    enqueue(req:TtsPoolRequest):Promise<TtsPoolResult>{
      if(closed)return Promise.reject(new Error('Speech pool is closed'));
      return new Promise<TtsPoolResult>((resolve,reject)=>{
        const entry:Entry={seq:seq++,key:req.key,priority:req.priority,text:req.text,voice:req.voice,enqueuedAt:performance.now(),retries:0,settled:false,attempting:false,resolve,reject};
        stats.enqueued++;queue.push(entry);armQueueTimeout(entry);notify();
      });
    },
    cancel(key:string):boolean{
      const entry=inFlight.get(key)??queue.find(e=>e.key===key&&!e.settled);
      if(!entry||entry.settled)return false;
      entry.settled=true;stats.cancelled++;
      if(entry.queueTimer)clearTimeout(entry.queueTimer);
      entry.controller?.abort();remove(entry);
      entry.reject(new Error('Speech cancelled'));
      notify();
      return true;
    },
    depth:()=>queue.length+inFlight.size,
    stats:()=>({...stats}),
    close:()=>{
      closed=true;
      for(const entry of [...queue]){entry.settled=true;if(entry.queueTimer)clearTimeout(entry.queueTimer);entry.reject(new Error('Speech pool closed'));}
      queue.length=0;
      for(const entry of inFlight.values())entry.controller?.abort();
      notify();
    },
  };
}
