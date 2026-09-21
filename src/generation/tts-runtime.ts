import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {DegradationRecord,TaskPriority,TeachingBeat} from '../types/contracts.js';
import {segmentSentencesWithIndex,segmentWords} from '../core/language.js';
import type {Timing} from '../types/engine.js';

type TtsTimingSource='native'|'forced-aligned'|'estimated';

interface TtsRequest {
  requestId:string;
  jobId:string;
  text:string;
  language:string;
  voice:string;
  speed:number;
  modelVersion:string;
  priority:TaskPriority;
}

interface TtsWorkerResult {
  audio:Buffer;
  format:'wav'|'mp3';
  audioDurationMs:number;
  provider:string;
  voice:string;
  language:string;
  nativeTiming?:Timing;
}

interface TtsWorkerHealth {healthy:boolean;detail?:string;requestsServed?:number}

/** A worker is deliberately provider-neutral. Implementations may hold a model,
 * subprocess, socket or provider session open across many calls. */
interface WarmTtsWorker {
  readonly id:string;
  start?():Promise<void>;
  synthesize(request:TtsRequest,signal:AbortSignal):Promise<TtsWorkerResult>;
  health():Promise<TtsWorkerHealth>;
  cancel?(requestId:string):Promise<void>|void;
  stop():Promise<void>;
}

type WarmTtsWorkerFactory=(slot:number,generation:number)=>Promise<WarmTtsWorker>|WarmTtsWorker;

interface QueueItem {
  request:TtsRequest;
  controller:AbortController;
  sequence:number;
  resolve:(result:TtsWorkerResult)=>void;
  reject:(error:unknown)=>void;
  detach?:()=>void;
}

interface WorkerSlot {index:number;generation:number;worker?:WarmTtsWorker;busy?:QueueItem}

const abortError=(signal:AbortSignal)=>signal.reason instanceof Error?signal.reason:new DOMException('TTS request aborted','AbortError');

/**
 * Process-wide capacity belongs here rather than in each job. Workers are
 * retained, health-checked before use and replaced after an unhealthy result or
 * crash. Queue order is stable by P0..P4 then submission order.
 */
class WarmTtsPool {
  readonly capacity:number;
  readonly slots:WorkerSlot[];
  private readonly queue:QueueItem[]=[];
  private sequence=0;
  private started=false;
  private startPromise?:Promise<void>;
  private ready=false;
  private dispatchScheduled=false;
  private closed=false;
  constructor(capacity:number,private readonly factory:WarmTtsWorkerFactory){
    if(!Number.isInteger(capacity)||capacity<1||capacity>16)throw new Error('TTS pool capacity must be 1-16');
    this.capacity=capacity;
    this.slots=Array.from({length:capacity},(_,index)=>({index,generation:0}));
  }

  async start():Promise<void>{
    if(this.closed)throw new Error('TTS pool is closed');
    if(this.startPromise)return this.startPromise;
    this.started=true;
    this.startPromise=Promise.all(this.slots.map(slot=>this.replaceWorker(slot))).then(()=>{this.ready=true;}).catch(error=>{this.started=false;this.startPromise=undefined;throw error;});
    return this.startPromise;
  }

  async synthesize(request:TtsRequest,signal?:AbortSignal):Promise<TtsWorkerResult>{
    if(this.closed)throw new Error('TTS pool is closed');
    if(!request.text.trim())throw new Error('TTS text is required');
    if(!Number.isFinite(request.speed)||request.speed<=0)throw new Error('TTS speed must be positive');
    signal?.throwIfAborted();
    if(!this.ready)await this.start();
    return new Promise<TtsWorkerResult>((resolve,reject)=>{
      const controller=new AbortController();
      const item:QueueItem={request,controller,sequence:this.sequence++,resolve,reject};
      if(signal){
        const abort=()=>{controller.abort(signal.reason);this.removeQueued(item);void this.cancelActive(item);};
        signal.addEventListener('abort',abort,{once:true});
        item.detach=()=>signal.removeEventListener('abort',abort);
      }
      this.queue.push(item);
      this.queue.sort((a,b)=>a.request.priority-b.request.priority||a.sequence-b.sequence);
      this.scheduleDispatch();
    });
  }

  async cancelJob(jobId:string,reason:unknown=new DOMException('TTS job cancelled','AbortError')):Promise<number>{
    let cancelled=0;
    for(const item of [...this.queue])if(item.request.jobId===jobId){cancelled++;item.controller.abort(reason);this.removeQueued(item);}
    for(const slot of this.slots){const item=slot.busy;if(item?.request.jobId===jobId){cancelled++;item.controller.abort(reason);await slot.worker?.cancel?.(item.request.requestId);}}
    return cancelled;
  }

  async health():Promise<Array<TtsWorkerHealth&{id:string;slot:number;generation:number;busy:boolean}>>{
    return Promise.all(this.slots.map(async slot=>{
      if(!slot.worker)return {id:'unstarted',slot:slot.index,generation:slot.generation,busy:Boolean(slot.busy),healthy:false,detail:'not started'};
      try{return {id:slot.worker.id,slot:slot.index,generation:slot.generation,busy:Boolean(slot.busy),...(await slot.worker.health())};}
      catch(error){return {id:slot.worker.id,slot:slot.index,generation:slot.generation,busy:Boolean(slot.busy),healthy:false,detail:error instanceof Error?error.message:String(error)};}
    }));
  }

  async close():Promise<void>{
    if(this.closed)return;
    this.closed=true;
    const reason=new DOMException('TTS pool closed','AbortError');
    for(const item of [...this.queue]){item.controller.abort(reason);this.removeQueued(item);}
    for(const slot of this.slots)if(slot.busy){slot.busy.controller.abort(reason);await slot.worker?.cancel?.(slot.busy.request.requestId);}
    await Promise.allSettled(this.slots.map(slot=>slot.worker?.stop()));
  }

  private removeQueued(item:QueueItem):void{
    const index=this.queue.indexOf(item);
    if(index<0)return;
    this.queue.splice(index,1);item.detach?.();item.reject(abortError(item.controller.signal));
  }

  private async cancelActive(item:QueueItem):Promise<void>{
    const slot=this.slots.find(candidate=>candidate.busy===item);
    if(slot)await slot.worker?.cancel?.(item.request.requestId);
  }

  private scheduleDispatch():void{
    if(this.dispatchScheduled)return;
    this.dispatchScheduled=true;
    queueMicrotask(()=>{this.dispatchScheduled=false;this.dispatch();});
  }

  private dispatch():void{
    if(this.closed)return;
    for(const slot of this.slots){
      if(slot.busy)continue;
      let item:QueueItem|undefined;
      while((item=this.queue.shift())){
        if(item.controller.signal.aborted){item.detach?.();item.reject(abortError(item.controller.signal));continue;}
        break;
      }
      if(!item)return;
      slot.busy=item;
      void this.run(slot,item);
    }
  }

  private async run(slot:WorkerSlot,item:QueueItem):Promise<void>{
    try{
      if(!slot.worker)await this.replaceWorker(slot);
      let health=await slot.worker!.health();
      if(!health.healthy){await this.replaceWorker(slot);health=await slot.worker!.health();}
      if(!health.healthy)throw new Error(`TTS worker ${slot.worker!.id} is unhealthy${health.detail?`: ${health.detail}`:''}`);
      const result=await slot.worker!.synthesize(item.request,item.controller.signal);
      item.controller.signal.throwIfAborted();
      item.resolve(result);
    }catch(error){
      item.reject(error);
      if(!item.controller.signal.aborted)await this.replaceWorker(slot).catch(()=>undefined);
    }finally{
      item.detach?.();slot.busy=undefined;this.scheduleDispatch();
    }
  }

  private async replaceWorker(slot:WorkerSlot):Promise<void>{
    if(slot.worker)await slot.worker.stop().catch(()=>undefined);
    slot.generation++;
    const worker=await this.factory(slot.index,slot.generation);
    await worker.start?.();
    slot.worker=worker;
  }
}

interface TtsCacheValue extends TtsWorkerResult {timing:Timing;timingSource:TtsTimingSource;degradations:DegradationRecord[]}
interface TtsCache {get(key:string):Promise<TtsCacheValue|undefined>;set(key:string,value:TtsCacheValue):Promise<void>}

export class MemoryTtsCache implements TtsCache {
  private readonly values=new Map<string,TtsCacheValue>();
  async get(key:string):Promise<TtsCacheValue|undefined>{const value=this.values.get(key);return value?cloneCacheValue(value):undefined;}
  async set(key:string,value:TtsCacheValue):Promise<void>{this.values.set(key,cloneCacheValue(value));}
}

const cloneCacheValue=(value:TtsCacheValue):TtsCacheValue=>({...structuredClone({...value,audio:undefined}),audio:Buffer.from(value.audio)} as TtsCacheValue);

/** Versioned, stable and intentionally excludes request/job identity. */
function ttsCacheKey(input:Pick<TtsRequest,'text'|'voice'|'language'|'speed'|'modelVersion'>):string{
  return createHash('sha256').update(JSON.stringify({
    text:input.text,
    voice:input.voice,
    language:input.language.toLowerCase(),
    speed:input.speed,
    modelVersion:input.modelVersion,
  })).digest('hex');
}

interface NarrationChunk {id:string;beatId?:string;text:string;index:number}

/** Beats are the first boundary. Oversized beats split only at deterministic
 * Unicode sentence boundaries; words are the final safety boundary. */
function chunkNarration(
  narration:string,
  beats:ReadonlyArray<Pick<TeachingBeat,'id'|'spokenText'>>|undefined,
  maxCharacters=700,
):NarrationChunk[]{
  if(!Number.isInteger(maxCharacters)||maxCharacters<32)throw new Error('TTS chunk limit must be at least 32 characters');
  const parts=beats?.length?beats.map(beat=>({beatId:beat.id,text:beat.spokenText.text.trim()})):[{text:narration.trim()}];
  const chunks:Array<Omit<NarrationChunk,'id'|'index'>>=[];
  for(const part of parts){
    if(!part.text)continue;
    for(const text of splitText(part.text,maxCharacters))chunks.push({...part,text});
  }
  return chunks.map((chunk,index)=>({...chunk,index,id:`tts-chunk-${String(index+1).padStart(4,'0')}`}));
}

function splitText(text:string,maxCharacters:number):string[]{
  if(text.length<=maxCharacters)return [text];
  const sentences=segmentSentencesWithIndex(text).map(segment=>segment.text);
  const units=sentences.length>1?sentences:segmentWords(text);
  const output:string[]=[];let current='';
  for(const unit of units){
    if(unit.length>maxCharacters){
      if(current){output.push(current);current='';}
      for(let start=0;start<unit.length;start+=maxCharacters)output.push(unit.slice(start,start+maxCharacters));
      continue;
    }
    const joined=current?`${current} ${unit}`:unit;
    if(joined.length>maxCharacters){output.push(current);current=unit;}else current=joined;
  }
  if(current)output.push(current);
  return output;
}

type ForcedAligner=(text:string,audio:Buffer,format:'wav'|'mp3',signal?:AbortSignal)=>Promise<Timing>;

async function resolveTtsTiming(
  text:string,
  result:TtsWorkerResult,
  estimate:(text:string,durationMs:number)=>Timing,
  align?:ForcedAligner,
  signal?:AbortSignal,
):Promise<Pick<TtsCacheValue,'timing'|'timingSource'|'degradations'>>{
  if(result.nativeTiming)return {timing:{...result.nativeTiming,timingSource:'native'},timingSource:'native',degradations:[]};
  if(align){
    try{return {timing:{...(await align(text,result.audio,result.format,signal)),timingSource:'forced-aligned'},timingSource:'forced-aligned',degradations:[]};}
    catch(error){
      return estimatedTiming(text,result.audioDurationMs,estimate,[degradation('tts.alignment_failed',error)]);
    }
  }
  return estimatedTiming(text,result.audioDurationMs,estimate,[degradation('tts.timing_estimated','No native timestamps or forced aligner were available')]);
}

function estimatedTiming(text:string,durationMs:number,estimate:(text:string,durationMs:number)=>Timing,degradations:DegradationRecord[]):Pick<TtsCacheValue,'timing'|'timingSource'|'degradations'>{
  return {timing:{...estimate(text,durationMs),timingSource:'estimated'},timingSource:'estimated',degradations};
}

const degradation=(code:string,error:unknown):DegradationRecord=>({code,stage:'tts',reason:error instanceof Error?error.message:String(error),at:new Date().toISOString(),recoverable:true});

interface SynthesizedChunk extends NarrationChunk,TtsCacheValue {cacheKey:string;cacheHit:boolean;offsetMs:number}
interface ChunkedNarrationResult {audio:Buffer;format:'wav';timing:Timing;timingSource:TtsTimingSource;chunks:SynthesizedChunk[];degradations:DegradationRecord[]}

/** Build an ffmpeg atempo chain for any positive speed factor. A single atempo
 * filter only accepts 0.5–2.0; chaining keeps large corrections valid while
 * preserving pitch (unlike PCM resampling). `factor` is input duration / target
 * duration, so values below one slow speech down to fill the planned slot. */
function atempoFilterChain(factor:number):string {
  if(!Number.isFinite(factor)||factor<=0)throw new Error('Audio tempo factor must be positive');
  let remaining=factor;const filters:string[]=[];
  while(remaining<0.5){filters.push('atempo=0.5');remaining/=0.5;}
  while(remaining>2){filters.push('atempo=2.0');remaining/=2;}
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(',');
}

function wavDurationMs(audio:Buffer):number {
  if(audio.length<44||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw new Error('Audio retiming requires a PCM WAV buffer');
  const byteRate=audio.readUInt32LE(28);const dataSize=audio.toString('ascii',36,40)==='data'?audio.readUInt32LE(40):0;
  if(!byteRate||!dataSize)return 0;
  return Math.round(dataSize/byteRate*1000);
}

interface RetimedAudio {audio:Buffer;durationMs:number;factor:number;changed:boolean}

/** Align a WAV to the deterministic planner slot. This is an actual audio
 * operation, not a metadata-only duration lie: ffmpeg's atempo filter changes
 * the PCM while preserving pitch. If the difference is negligible, the source
 * buffer is reused to keep cache/output bytes stable. */
export async function retimeWavAudio(audio:Buffer,actualDurationMs:number,targetDurationMs:number,signal?:AbortSignal):Promise<RetimedAudio> {
  if(!Number.isFinite(actualDurationMs)||actualDurationMs<=0||!Number.isFinite(targetDurationMs)||targetDurationMs<=0)throw new Error('Audio durations must be positive');
  const factor=actualDurationMs/targetDurationMs;
  if(Math.abs(factor-1)<0.01)return {audio,durationMs:actualDurationMs,factor,changed:false};
  const filter=atempoFilterChain(factor);
  const output=await new Promise<Buffer>((resolve,reject)=>{
    let settled=false;const chunks:Buffer[]=[];let stderr='';
    const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-i','pipe:0','-af',filter,'-f','wav','pipe:1'],{stdio:['pipe','pipe','pipe'],signal});
    child.stdout.on('data',chunk=>chunks.push(Buffer.from(chunk)));child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    const fail=(error:unknown)=>{if(settled)return;settled=true;reject(error instanceof Error?error:new Error(String(error)));};
    child.on('error',fail);
    child.on('close',code=>{if(settled)return;if(code!==0){fail(new Error(`ffmpeg audio retime failed (${code}): ${stderr.trim().slice(0,240)}`));return;}settled=true;resolve(Buffer.concat(chunks));});
    child.stdin.end(audio);
  });
  const durationMs=wavDurationMs(output)||Math.round(targetDurationMs);
  return {audio:output,durationMs,factor,changed:true};
}

/** Scale word anchors after a real audio retime. */
export function scaleTimingToDuration(timing:Timing,targetDurationMs:number):Timing {
  if(!Number.isFinite(targetDurationMs)||targetDurationMs<=0)throw new Error('Target timing duration must be positive');
  const source=Math.max(1,timing.durationMs),scale=targetDurationMs/source;
  return {...timing,durationMs:Math.round(targetDurationMs),words:timing.words.map(word=>({word:word.word,startMs:Math.max(0,Math.min(Math.round(targetDurationMs),Math.round(word.startMs*scale))),endMs:Math.max(0,Math.min(Math.round(targetDurationMs),Math.round(word.endMs*scale)))}))};
}

export async function synthesizeChunkedNarration(options:{
  narration:string;
  beats?:ReadonlyArray<Pick<TeachingBeat,'id'|'spokenText'>>;
  jobId:string;
  language:string;
  voice:string;
  speed:number;
  modelVersion:string;
  pool:WarmTtsPool;
  cache:TtsCache;
  estimate:(text:string,durationMs:number)=>Timing;
  align?:ForcedAligner;
  signal?:AbortSignal;
  maxCharacters?:number;
}):Promise<ChunkedNarrationResult>{
  const chunks=chunkNarration(options.narration,options.beats,options.maxCharacters);
  if(!chunks.length)throw new Error('Narration has no speakable text');
  const completed=await Promise.all(chunks.map(async chunk=>{
    const request:TtsRequest={requestId:`${options.jobId}:${chunk.id}`,jobId:options.jobId,text:chunk.text,language:options.language,voice:options.voice,speed:options.speed,modelVersion:options.modelVersion,priority:chunk.index===0?0:1};
    const cacheKey=ttsCacheKey(request),cached=await options.cache.get(cacheKey);
    if(cached)return {...chunk,...cached,cacheKey,cacheHit:true,offsetMs:0};
    const raw=await options.pool.synthesize(request,options.signal);
    if(raw.format!=='wav')throw new Error('Chunked concatenation currently requires WAV audio');
    const resolved=await resolveTtsTiming(chunk.text,raw,options.estimate,options.align,options.signal);
    const value:TtsCacheValue={...raw,...resolved};await options.cache.set(cacheKey,value);
    return {...chunk,...value,cacheKey,cacheHit:false,offsetMs:0};
  }));
  let offsetMs=0;const words:Timing['words']=[];
  for(const chunk of completed){chunk.offsetMs=offsetMs;for(const word of chunk.timing.words)words.push({...word,startMs:word.startMs+offsetMs,endMs:word.endMs+offsetMs});offsetMs+=chunk.timing.durationMs;}
  const timingSource=completed.every(chunk=>chunk.timingSource==='native')?'native':completed.some(chunk=>chunk.timingSource==='estimated')?'estimated':'forced-aligned';
  return {audio:joinWav(completed.map(chunk=>chunk.audio)),format:'wav',timing:{kind:'chunked',timingSource,words,durationMs:offsetMs},timingSource,chunks:completed,degradations:completed.flatMap(chunk=>chunk.degradations)};
}

/** Deterministic PCM WAV concatenation. Format fields must match exactly. */
function joinWav(buffers:readonly Buffer[]):Buffer{
  if(!buffers.length)throw new Error('At least one WAV chunk is required');
  const parsed=buffers.map(parseWav);
  const format=parsed[0].format;
  for(const item of parsed.slice(1))if(!item.format.equals(format))throw new Error('WAV chunks have incompatible PCM formats');
  const data=Buffer.concat(parsed.map(item=>item.data));
  const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+data.length,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);format.copy(header,20);header.write('data',36);header.writeUInt32LE(data.length,40);
  return Buffer.concat([header,data]);
}

function parseWav(buffer:Buffer):{format:Buffer;data:Buffer}{
  if(buffer.length<44||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE'||buffer.toString('ascii',12,16)!=='fmt '||buffer.readUInt32LE(16)!==16||buffer.toString('ascii',36,40)!=='data')throw new Error('Only canonical PCM WAV chunks can be concatenated');
  const length=buffer.readUInt32LE(40);if(44+length>buffer.length)throw new Error('Truncated WAV chunk');
  return {format:buffer.subarray(20,36),data:buffer.subarray(44,44+length)};
}

interface RemainingDurationItem {id:string;targetDurationMs:number;required?:boolean}
interface DurationRebalance {remainingMs:number;allocations:Record<string,number>;notFitting:string[];partial:boolean}

/** Audio is authoritative. Only uncommitted targets are changed. */
export function rebalanceRemainingDurations(input:{lessonTargetMs:number;committedActualMs:readonly number[];uncommitted:readonly RemainingDurationItem[]}):DurationRebalance{
  if(!Number.isFinite(input.lessonTargetMs)||input.lessonTargetMs<0)throw new Error('Lesson target must be non-negative');
  const used=input.committedActualMs.reduce((sum,value)=>sum+Math.max(0,value),0),remainingMs=Math.max(0,input.lessonTargetMs-used);
  const positive=input.uncommitted.map(item=>({...item,targetDurationMs:Math.max(0,item.targetDurationMs)}));
  const total=positive.reduce((sum,item)=>sum+item.targetDurationMs,0),allocations:Record<string,number>={};
  if(total>0&&remainingMs>0){let assigned=0;positive.forEach((item,index)=>{const value=index===positive.length-1?remainingMs-assigned:Math.floor(remainingMs*item.targetDurationMs/total);allocations[item.id]=value;assigned+=value;});}
  else for(const item of positive)allocations[item.id]=0;
  const notFitting=positive.filter(item=>item.required&&allocations[item.id]===0).map(item=>item.id);
  return {remainingMs,allocations,notFitting,partial:notFitting.length>0||used>input.lessonTargetMs};
}

interface ApmPolicy {marginMs:number;state:'healthy'|'low'|'underrun';priority:TaskPriority;pausePriorities:TaskPriority[]}

/** Positive APM means already-playable audio remains ahead of the playhead. */
export function apmPriorityPolicy(playableThroughMs:number,playbackPositionMs:number,lowWaterMs=15_000):ApmPolicy{
  const marginMs=playableThroughMs-playbackPositionMs;
  if(marginMs<=0)return {marginMs,state:'underrun',priority:0,pausePriorities:[2,3,4]};
  if(marginMs<lowWaterMs)return {marginMs,state:'low',priority:1,pausePriorities:[3,4]};
  return {marginMs,state:'healthy',priority:2,pausePriorities:[]};
}
