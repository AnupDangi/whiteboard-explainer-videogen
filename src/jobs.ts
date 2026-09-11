import {log,logContext} from './logger.js';
import type {GenerationOptions,Usage,SourceDocument,SourceInput,Plan,JobSnapshot,InternalJob,Providers,Timing} from './types.js';
import {ingestSource} from './sources.js';
import {detectFigures,describeFigures} from './figures.js';
import type {FigureCandidate} from './figures.js';
import {buildDocumentMap,readCachedMap,writeCachedMap} from './document-map.js';
import {generateChapters,validateDuration} from './planner.js';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixtures} from './fixtures.js';
import {validatePlan,compileScene,durationOf} from './engine.js';
import {generateKokoroSpeech} from './kokoro-speech.js';
import {createTtsPool,poolUrlsFromEnv} from './tts-pool.js';
import {generateSpeech} from './providers.js';
import {semaphore} from './concurrency.js';
import {staticIntervalMs,connectorThroughNode} from './progression.js';

/** P5 failure taxonomy: one coarse kind per job failure so later evaluation can group
 *  and count them without regex archaeology over error messages. Ordered most-specific
 *  first: a transport timeout is a timeout even though the message says "operation
 *  was aborted"; a truncated completion is not a content refusal. */
export function classifyError(message:string):string {
  if(/aborted due to timeout|TimeoutError/i.test(message))return 'timeout';
  if(/content filter|provider refused/i.test(message))return 'provider-refused';
  if(/truncated|incomplete or refused|finish_reason/i.test(message))return 'provider-truncated';
  if(/Source|PDF|HTTPS|redirect|Link must|readable|OCR/i.test(message))return 'source';
  if(/Speech|Kokoro|TTS|ElevenLabs/i.test(message))return 'speech';
  if(/Anchor|outline|Expected two scenes|Chapter contains|Teaching checks|Visual checks|fallback exhausted|budget|Invalid (conceptId|evidenceIds|visualIntent|node|kind)/i.test(message))return 'plan';
  if(/schema|OpenRouter|HTTP \d/i.test(message))return 'provider';
  if(/ffmpeg|sharp|export/i.test(message))return 'media';
  return 'unknown';
}

/** A6: bump this whenever a change to schema.ts's shapes/kinds or engine.ts's compiler/
 *  renderer could make an old saved job.json render differently under the current code —
 *  lets a report distinguish "replayed under its original code" from "replayed under updated
 *  code" without re-deriving history from git log (docs/OPTIMIZATION_PLAN.md §4 GenerationManifest,
 *  bounded to a version string for this pass — see docs/REVIEW_CORPUS.md). */
export const GENERATION_MANIFEST_VERSION='v1-2026-09-10';

/** Uploaded-PDF sources can start figure detection before extraction finishes; URL
 *  sources can't (their PDF-ness is only known after ingest, and ingest discards bytes). */
function sourceIsPdf(source?:SourceInput):boolean {return source?.kind==='pdf';}

/** Local single-process worker. Durable snapshots, not a distributed queue. */
export class JobStore {
  root:string; jobs:Map<string,InternalJob>; providers:Providers;
  constructor(root:string,providers:Providers={}) {this.root=root;this.jobs=new Map();this.providers=providers;}
  async create(options:GenerationOptions) {
    if(!['fixture','model'].includes(options.mode))throw new Error('Unknown generation mode');
    if(options.mode==='fixture'&&!fixtures[options.fixture||''])throw new Error('Unknown fixture');
    if(options.mode==='model'){validateDuration(options.durationMinutes??1);if(!options.source&&!options.prompt?.trim())throw new Error('A source is required');}
    if(options.maxCostUsd!==undefined&&(!Number.isFinite(options.maxCostUsd)||options.maxCostUsd<=0||options.maxCostUsd>10))throw new Error('Budget must be above $0 and at most $10');
    const delayMs=options.delayMs??0;
    if(!Number.isFinite(delayMs)||delayMs<0||delayMs>20000)throw new Error('Delay must be 0–20000 ms');
    if(typeof options.narration!=='boolean')throw new Error('Invalid narration option');
    if(options.ttsProvider&&!['elevenlabs','kokoro'].includes(options.ttsProvider))throw new Error('Unknown TTS provider');
    if(options.visualCritic!==undefined&&typeof options.visualCritic!=='boolean')throw new Error('Invalid visual critic option');
    if(options.cachePrompts!==undefined&&typeof options.cachePrompts!=='boolean')throw new Error('Invalid cache prompts option');
    if(options.voiceId&& !/^[a-zA-Z0-9_-]{1,100}$/.test(options.voiceId))throw new Error('Invalid voice ID');
    const active=[...this.jobs.values()].filter(j=>['queued','planning','preparing'].includes(j.status));
    if(active.length>=2)throw new Error('Two jobs already active; wait or cancel one.');
    const job:InternalJob={id:randomUUID(),status:'queued',revision:0,createdAt:Date.now(),mode:options.mode,
      targetMinutes:options.durationMinutes??1,plannerBudgetUsd:options.maxCostUsd??1,ttsCharacters:0,
      timingMode:options.narration?(options.ttsProvider==='elevenlabs'?'provider-aligned':'kokoro-aligned'):'estimated',simulatedDelayMs:delayMs,scenes:[],availableMs:0,events:[],manifestVersion:GENERATION_MANIFEST_VERSION};
    this.jobs.set(job.id,job);await mkdir(join(this.root,job.id),{recursive:true});
    await this.save(job,'queued');
    const controller=new AbortController();job.controller=controller;
    log('job.created',{jobId:job.id,mode:options.mode,fixture:options.fixture,narration:options.narration,ttsProvider:options.ttsProvider||'kokoro',voiceId:options.voiceId||process.env.ELEVENLABS_VOICE_ID,targetMinutes:job.targetMinutes,budgetUsd:job.plannerBudgetUsd,simulatedDelayMs:delayMs});
    job.task=logContext.run({...logContext.getStore(),jobId:job.id},()=>this.run(job,{...options,delayMs},controller.signal));
    return this.snapshot(job);
  }
  snapshot(job:InternalJob):JobSnapshot {const {controller,task,...data}=job;return structuredClone(data);}
  async save(job:InternalJob,type:string) {
    job.revision++;job.events.push({sequence:job.revision,type,atMs:Date.now()-job.createdAt,availableMs:job.availableMs});
    const path=join(this.root,job.id,'job.json');await writeFile(path+'.tmp',JSON.stringify(this.snapshot(job),null,2));await rename(path+'.tmp',path);
    log('job.'+type,{jobId:job.id,status:job.status,revision:job.revision,elapsedMs:Date.now()-job.createdAt,readyScenes:job.scenes.length,totalScenes:job.totalScenes,availableMs:job.availableMs,error:job.error},job.status==='error'?'error':'info');
  }
  async run(job:InternalJob,options:GenerationOptions,signal:AbortSignal) {
    // Concurrent scene tasks must never call save() directly (it writes job.json via a shared
    // .tmp path; two in-flight writers race and can corrupt or drop a snapshot). Funnel every
    // save through one chain so it stays sequential regardless of which task requests it.
    let saveChain:Promise<void>=Promise.resolve();
    const queueSave=(type:string)=>{saveChain=saveChain.then(()=>this.save(job,type));return saveChain;};
    // Phase 0 spans: per-scene TTS wall ms, keyed by scene id. Written synchronously into
    // the map from each scene task (no await between read and write), then persisted once
    // on completion or failure alongside the planner spans already on job.usage.
    const ttsMsByScene:Record<string,number>={};
    const persistSpans=()=>{job.spans={...job.usage?.spans,ttsMsByScene:{...ttsMsByScene}};};
    // TTS reliability: one bounded, priority-ordered Kokoro pool per job. The old fan-out
    // fired all 20 scenes at one serialized server and the tail tripped a fixed deadline,
    // killing a fully planned job. This pool caps in-flight work at one request per worker,
    // dispatches by chapter/scene order so scene 1 is first, and measures queue wait and
    // service time separately. Character reservation moves to enqueue, so speculative
    // synthesis can no longer blow TTS_MAX_CHARACTERS_PER_JOB before the cap is checked.
    const usePool=!!(options.narration&&options.ttsProvider!=='elevenlabs');
    const pool=usePool?createTtsPool({
      urls:poolUrlsFromEnv(process.env),
      env:process.env,
      ...(this.providers.speech?{synthesize:(_url:string,text:string,voice:string|undefined,signal:AbortSignal)=>this.providers.speech!(text,{signal,voiceId:voice})}:{}),
      onEvent:(event,data)=>log(event,data),
    }):null;
    const reservedByScene=new Map<string,number>();
    const reserveCharacters=(sceneId:string,chars:number):boolean=>{
      const prev=reservedByScene.get(sceneId)||0;
      const next=job.ttsCharacters-prev+chars;
      const cap=Number(process.env.TTS_MAX_CHARACTERS_PER_JOB||40000);
      if(!Number.isFinite(cap)||next>cap)return false;
      job.ttsCharacters=next;reservedByScene.set(sceneId,chars);return true;
    };
    const releaseCharacters=(sceneId:string):void=>{
      const prev=reservedByScene.get(sceneId);if(prev===undefined)return;
      job.ttsCharacters=Math.max(0,job.ttsCharacters-prev);reservedByScene.delete(sceneId);
    };
    // Phase 12: overlap TTS with the Visual Director call. Narration is immutable the moment
    // content validates. Keyed by (sceneId, narration) so a stale speculative result from a
    // regenerated chapter is never reused; regenerating cancels the superseded pool entry so
    // a discarded narration stops holding a worker.
    const speculativeSpeech=new Map<string,{narration:string;promise:Promise<{audio:Buffer;timing:Timing;format?:'wav'|'mp3'}>;priority:number}>();
    const onContentReady=usePool&&pool
      ?(chapter:number,scenes:Array<{id:string;narration:string}>)=>{
          scenes.forEach((s,i)=>{
            const priority=chapter*100+i;
            if(speculativeSpeech.has(s.id))pool.cancel(s.id);
            if(!reserveCharacters(s.id,s.narration.length)){
              log('speech.characters-exceeded',{sceneId:s.id,cap:Number(process.env.TTS_MAX_CHARACTERS_PER_JOB||40000)},'warn');
              return;
            }
            const promise=pool.enqueue({key:s.id,priority,text:s.narration,voice:options.voiceId});
            promise.catch(()=>{}); // the commit path consumes it; prevent an unhandled rejection for discarded results
            speculativeSpeech.set(s.id,{narration:s.narration,promise,priority});
          });
        }
      :undefined;
    try {
      job.status='planning';await this.save(job,'planning');
      let sourceDocument!:SourceDocument;
      if(options.mode==='model'&&!this.providers.plan){
        log('source.started',{kind:options.source?.kind||'prompt'});
        // Parallel parsing: pdftotext extraction and pdftohtml figure detection are
        // independent poppler processes over the same bytes — run them concurrently
        // instead of serially. Figure description stays fail-soft and bounded.
        const base64=options.source?.base64;
        const canDetect=sourceIsPdf(options.source)&&base64&&!this.providers.plan&&process.env.OPENROUTER_API_KEY;
        const ingestPromise=ingestSource(options.source||{kind:'prompt',text:options.prompt},signal);
        const detectPromise=canDetect?detectFigures(Buffer.from(base64,'base64')).catch((e:unknown)=>{log('source.figures-detected-failed',{error:e instanceof Error?e.message:String(e)},'warn');return [] as FigureCandidate[];}):null;
        sourceDocument=await ingestPromise;
        log('source.ready',{kind:sourceDocument.kind,characters:sourceDocument.text.length});
        // LD2: build (or sha256-cache) the hierarchical document map so the outline can
        // plan over a section tree instead of raw text (LD5). Fail-soft: a map problem
        // must never fail the job — the planner still works off raw text.
        try{
          const cached=await readCachedMap(this.root,sourceDocument.sha256);
          const map=cached??buildDocumentMap(sourceDocument);
          if(!cached)await writeCachedMap(this.root,sourceDocument.sha256,map);
          sourceDocument.map=map;
          log('source.map-built',{sections:map.sections.length,kind:map.kind,cached:!!cached});
        }catch(mapError){log('source.map-failed',{error:mapError instanceof Error?mapError.message:String(mapError)},'warn');}
        // Pre-extracted figures ride in via options (enriched text sources lose the
        // original bytes; the caller detects+describes before handing off). When they
        // exist, skip the in-worker pipeline entirely — describing twice doubles cost
        // and latency for zero new information.
        if(options.figures?.length)sourceDocument.figures=options.figures;
        else if(detectPromise){
          const candidates=await detectPromise;
          log('source.figures-detected',{count:candidates.length});
          if(candidates.length){
            sourceDocument.figures=await describeFigures(Buffer.from(base64!,'base64'),candidates,{env:process.env});
            log('source.figures-described',{count:sourceDocument.figures.length,kinds:sourceDocument.figures.map(f=>f.kind)});
          }
        }
        job.source={kind:sourceDocument.kind,label:sourceDocument.label,sha256:sourceDocument.sha256,characters:sourceDocument.text.length};
        await writeFile(join(this.root,job.id,'source.json'),JSON.stringify(sourceDocument));
      }
      const plans=options.mode==='fixture'?[validatePlan(fixtures[options.fixture||''])]:this.providers.plan?[await this.providers.plan(options.prompt||'',{signal})]:generateChapters(sourceDocument,{signal,durationMinutes:options.durationMinutes??1,maxCostUsd:options.maxCostUsd??1,visualCritic:options.visualCritic??false,sessionId:job.id,cachePrompts:options.cachePrompts??true,cacheDir:this.root,onUsage:(usage:Usage)=>{job.usage=usage;log('planner.usage',{...usage});},onResponse:async(value,index)=>{await writeFile(join(this.root,job.id,`planner-${index}.json`),JSON.stringify(value,null,2));},onContentReady});
      job.totalScenes=options.mode==='model'&&!this.providers.plan?(options.durationMinutes??1)*2:undefined;
      for await(const plan of plans){
        signal.throwIfAborted();job.title=plan.title;job.totalScenes??=plan.scenes.length;job.status='preparing';await queueSave('chapter-ready');
        // Fan out TTS+compile for every scene in this chapter with bounded concurrency, then
        // commit to job.scenes strictly in original order — availableMs/revision must stay
        // monotonic, and a failure must never let a later scene commit ahead of an earlier one.
        const sceneLimit=Math.min(plan.scenes.length,3);
        const sceneSem=semaphore(sceneLimit);
        const sceneTasks=plan.scenes.map(source=>{
          const task=(async()=>{
            await sceneSem.acquire();
            try {
              signal.throwIfAborted();
              const delayMs=options.delayMs??0;
              log('scene.started',{sceneId:source.id,characters:source.narration.length,simulatedDelayMs:delayMs});
              await delay(delayMs,undefined,{signal});
              let timing,audioUrl,degradedReason:string|undefined;
              if(options.narration) {
                // Reserve synchronously (idempotent per scene — the speculative enqueue
                // already reserved; this adjusts if narration changed). A breach is fatal.
                if(!reserveCharacters(source.id,source.narration.length))throw new Error('Narration character budget exceeded');
                await queueSave('speech-started');
                try {
                  const speechStarted=performance.now();
                  let speech:{audio:Buffer;timing:Timing;format?:'wav'|'mp3'};
                  if(pool){
                    const speculative=speculativeSpeech.get(source.id);
                    speech=await ((speculative&&speculative.narration===source.narration)
                      ? speculative.promise
                      : pool.enqueue({key:source.id,priority:plan.scenes.indexOf(source),text:source.narration,voice:options.voiceId}));
                  } else {
                    speech=await (this.providers.speech||(options.ttsProvider==='elevenlabs'?generateSpeech:generateKokoroSpeech))(source.narration,{signal,voiceId:options.voiceId});
                  }
                  signal.throwIfAborted();timing=speech.timing;
                  ttsMsByScene[source.id]=Math.round(performance.now()-speechStarted);
                  log('speech.ready',{sceneId:source.id,elapsedMs:ttsMsByScene[source.id],bytes:speech.audio.length,format:speech.format||'mp3',words:speech.timing.words.length,timing:speech.timing.kind,durationMs:speech.timing.durationMs});
                  const extension=speech.format||'mp3';
                  await writeFile(join(this.root,job.id,`${source.id}.${extension}`),speech.audio);
                  audioUrl=`/media/${job.id}/${source.id}.${extension}`;
                } catch(e){
                  // Harness §56: a TTS failure degrades to explicitly-estimated (silent)
                  // timing and the job continues — never a robot voice, never a dead job.
                  degradedReason=e instanceof Error?e.message:String(e);
                  releaseCharacters(source.id);
                  job.fallbackCount=(job.fallbackCount||0)+1;
                  (job.degradedScenes??=[]).push({id:source.id,reason:degradedReason});
                  log('speech.fallback',{sceneId:source.id,reason:degradedReason,timingMode:'estimated'},'warn');
                }
              }
              const scene=compileScene(source,timing);log('scene.compiled',{sceneId:source.id,nodes:scene.nodes.length,durationMs:scene.durationMs});if(audioUrl)scene.audioUrl=audioUrl;
              return scene;
            } finally {
              sceneSem.release();
            }
          })();
          // Suppress unhandled-rejection reporting for a later scene that fails while an
          // earlier one is still in flight; the real error surfaces when its turn is awaited.
          task.catch(()=>{});
          return task;
        });
        for(let i=0;i<sceneTasks.length;i++){
          const scene=await sceneTasks[i];
          signal.throwIfAborted();if(job.availableMs+scene.durationMs>30*60000)throw new Error('Generated narration exceeds the 30-minute maximum; reduce target length or revise pacing');job.scenes.push(scene);job.availableMs=durationOf(job.scenes);
          if(!job.firstPlayableMs)job.firstPlayableMs=Date.now()-job.createdAt;
          await queueSave('scene-ready');
        }
      }
      job.actualMinutes=job.availableMs/60000;
      // Any scene that degraded to estimated (silent) timing makes the job 'partial', not
      // 'complete': the video is playable and exportable, but the provider failure stays
      // visible at the job level instead of masquerading as a fully narrated success.
      job.status=(job.fallbackCount||0)>0?'partial':'complete';job.completedMs=Date.now()-job.createdAt;persistSpans();
      // One-line completion summary: wall time, cost, tokens and per-stage ms for the
      // whole job — the record a cost/latency tracker reads without joining many events.
      job.repairCount=job.usage?.repairs||0;
      log('job.summary',{
        status:job.status,wallMs:job.completedMs,firstPlayableMs:job.firstPlayableMs,timelineMs:Math.round(job.availableMs),scenes:job.scenes.length,
        costUsd:Number((job.usage?.costUsd||0).toFixed(6)),calls:job.usage?.calls||0,
        promptTokens:job.usage?.promptTokens||0,completionTokens:job.usage?.completionTokens||0,cachedTokens:job.usage?.cachedTokens||0,
        outlineMs:job.usage?.spans?.outlineMs||0,chapters:job.usage?.spans?.chapters||{},ttsCharacters:job.ttsCharacters,
        repairs:job.repairCount,fallbackCount:job.fallbackCount||0,degradedScenes:job.degradedScenes||[],
      });
      // P5 eval ledger: deterministic quality measurements on every completed job.
      log('job.lints',{jobId:job.id,scenes:job.scenes.map(s=>({id:s.id,staticIntervalMs:Math.round(staticIntervalMs(s)),connectorHits:connectorThroughNode(s).length}))});
      await queueSave('complete');
    }catch(error){
      // Partial commit: scenes already committed stay playable. A planner failure on a later
      // chapter must not discard work the viewer can already watch (harness §53 per-scene
      // status). 'error' is reserved for a job with nothing to play.
      const partial=!signal.aborted&&job.scenes.length>0;
      log('job.failure',{error},signal.aborted?'warn':'error');
      job.status=signal.aborted?'cancelled':(partial?'partial':'error');
      job.error=signal.aborted?'Cancelled by user':(error instanceof Error?error.message:String(error));
      // P5 failure taxonomy: classify so later eval can group failures without NLP.
      job.errorKind=signal.aborted?'cancel':classifyError(job.error);
      log('job.failure-classified',{jobId:job.id,errorKind:job.errorKind},signal.aborted?'warn':'error');
      log('job.summary',{status:job.status,wallMs:Date.now()-job.createdAt,costUsd:Number((job.usage?.costUsd||0).toFixed(6)),calls:job.usage?.calls||0,scenes:job.scenes.length,errorKind:job.errorKind,error:job.error,repairs:job.usage?.repairs||0,fallbackCount:job.fallbackCount||0,degradedScenes:job.degradedScenes||[],spans:job.usage?.spans||{}},signal.aborted?'warn':'error');
      persistSpans();await queueSave(job.status);
    }finally{
      pool?.close();
    }
  }
  async get(id:string):Promise<JobSnapshot|null> {
    if(!/^[a-f0-9-]{36}$/.test(id))return null;
    if(this.jobs.has(id))return this.snapshot(this.jobs.get(id)!);
    try {const job=JSON.parse(await readFile(join(this.root,id,'job.json'),'utf8'));
      if(['queued','planning','preparing'].includes(job.status)){job.status='interrupted';job.error='Server restarted; create a new job. Prepared scenes remain playable.';}
      return job;
    }catch{return null;}
  }
  async cancel(id:string) {log('job.cancel-requested',{jobId:id});const job=this.jobs.get(id);if(!job)return false;job.controller?.abort();await job.task;return true;}
  async close(){log('jobs.shutdown',{jobs:this.jobs.size});for(const job of this.jobs.values())job.controller?.abort();await Promise.allSettled([...this.jobs.values()].map(j=>j.task));}
}