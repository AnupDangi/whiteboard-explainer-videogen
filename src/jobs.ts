import {log,logContext} from './logger.js';
import type {GenerationOptions,Usage,SourceDocument,Plan,JobSnapshot,InternalJob,Providers,Timing} from './types.js';
import {ingestSource} from './sources.js';
import {generateChapters,validateDuration} from './planner.js';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixtures} from './fixtures.js';
import {validatePlan,compileScene,durationOf} from './engine.js';
import {generateKokoroSpeech} from './kokoro-speech.js';
import {generateSpeech} from './providers.js';
import {semaphore} from './concurrency.js';
import {staticIntervalMs,connectorThroughNode} from './progression.js';

/** P5 failure taxonomy: one coarse kind per job failure so later evaluation can group
 *  and count them without regex archaeology over error messages. */
function classifyError(message:string):string {
  if(/Source|PDF|HTTPS|redirect|Link must|readable|OCR/i.test(message))return 'source';
  if(/Anchor|outline|Expected two scenes|Chapter contains|Teaching checks|Visual checks|fallback exhausted|budget/i.test(message))return 'plan';
  if(/schema|OpenRouter|HTTP \d/i.test(message))return 'provider';
  if(/Speech|Kokoro|TTS|ElevenLabs/i.test(message))return 'speech';
  if(/ffmpeg|sharp|export/i.test(message))return 'media';
  return 'unknown';
}

/** A6: bump this whenever a change to schema.ts's shapes/kinds or engine.ts's compiler/
 *  renderer could make an old saved job.json render differently under the current code —
 *  lets a report distinguish "replayed under its original code" from "replayed under updated
 *  code" without re-deriving history from git log (docs/OPTIMIZATION_PLAN.md §4 GenerationManifest,
 *  bounded to a version string for this pass — see docs/REVIEW_CORPUS.md). */
export const GENERATION_MANIFEST_VERSION='v1-2026-09-10';

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
    // Phase 12: overlap TTS with the Visual Director call instead of waiting for it. The
    // director only decides kind/shape/layout — narration text is already final the moment
    // the Teaching Planner (content stage) validates, so there's no real reason TTS has to
    // wait ~8s for a call that produces visual metadata TTS never reads. Only wired for
    // kokoro (free/local): starting a speculative ElevenLabs call before a chapter is fully
    // committed would burn paid API usage on content a later regeneration might discard.
    // Correctness: keyed by (sceneId, narration) so a stale speculative result (from an
    // earlier CHAPTER_REGENERATIONS attempt whose narration differs) is never reused — the
    // real call below falls back to a fresh synth if the text doesn't match.
    const speculativeSpeech=new Map<string,{narration:string;promise:Promise<{audio:Buffer;timing:Timing;format?:'wav'|'mp3'}>}>();
    const onContentReady=(options.narration&&options.ttsProvider!=='elevenlabs')
      ?(_chapter:number,scenes:Array<{id:string;narration:string}>)=>{
          for(const s of scenes){
            const speech=(this.providers.speech||generateKokoroSpeech)(s.narration,{signal,voiceId:options.voiceId});
            speech.catch(()=>{}); // real consumer (below) reports the failure; this just prevents an unhandled-rejection warning if it's never awaited (stale/discarded)
            speculativeSpeech.set(s.id,{narration:s.narration,promise:speech});
          }
        }
      :undefined;
    try {
      job.status='planning';await this.save(job,'planning');
      let sourceDocument!:SourceDocument;
      if(options.mode==='model'&&!this.providers.plan){
        log('source.started',{kind:options.source?.kind||'prompt'});
        sourceDocument=await ingestSource(options.source||{kind:'prompt',text:options.prompt},signal);
        log('source.ready',{kind:sourceDocument.kind,characters:sourceDocument.text.length});
        job.source={kind:sourceDocument.kind,label:sourceDocument.label,sha256:sourceDocument.sha256,characters:sourceDocument.text.length};
        await writeFile(join(this.root,job.id,'source.json'),JSON.stringify(sourceDocument));
      }
      const plans=options.mode==='fixture'?[validatePlan(fixtures[options.fixture||''])]:this.providers.plan?[await this.providers.plan(options.prompt||'',{signal})]:generateChapters(sourceDocument,{signal,durationMinutes:options.durationMinutes??1,maxCostUsd:options.maxCostUsd??1,visualCritic:options.visualCritic??false,sessionId:job.id,cachePrompts:options.cachePrompts??true,onUsage:(usage:Usage)=>{job.usage=usage;log('planner.usage',{...usage});},onResponse:async(value,index)=>{await writeFile(join(this.root,job.id,`planner-${index}.json`),JSON.stringify(value,null,2));},onContentReady});
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
              let timing,audioUrl;
              if(options.narration) {
                // Synchronous check-then-reserve: no await between reading and writing
                // job.ttsCharacters, so this stays race-free across concurrent scene tasks.
                const nextCharacters=job.ttsCharacters+source.narration.length;
                const characterCap=Number(process.env.TTS_MAX_CHARACTERS_PER_JOB||40000);
                if(!Number.isFinite(characterCap)||nextCharacters>characterCap)throw new Error('Narration character budget exceeded');
                job.ttsCharacters=nextCharacters;
                await queueSave('speech-started');
                try {
                  const speechStarted=performance.now();
                  const speculative=speculativeSpeech.get(source.id);
                  const speech=await (speculative&&speculative.narration===source.narration
                    ? speculative.promise
                    : (this.providers.speech||(options.ttsProvider==='elevenlabs'?generateSpeech:generateKokoroSpeech))(source.narration,{signal,voiceId:options.voiceId}));
                  signal.throwIfAborted();timing=speech.timing;
                  ttsMsByScene[source.id]=Math.round(performance.now()-speechStarted);
                  log('speech.ready',{sceneId:source.id,elapsedMs:ttsMsByScene[source.id],bytes:speech.audio.length,format:speech.format||'mp3',words:speech.timing.words.length,timing:speech.timing.kind,durationMs:speech.timing.durationMs});
                  const extension=speech.format||'mp3';
                  await writeFile(join(this.root,job.id,`${source.id}.${extension}`),speech.audio);
                  audioUrl=`/media/${job.id}/${source.id}.${extension}`;
                } catch(e){
                  const msg=e instanceof Error?e.message:String(e);
                  throw new Error(msg);
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
      job.status='complete';job.completedMs=Date.now()-job.createdAt;persistSpans();
      // P5 eval ledger: deterministic quality measurements on every completed job.
      log('job.lints',{jobId:job.id,scenes:job.scenes.map(s=>({id:s.id,staticIntervalMs:Math.round(staticIntervalMs(s)),connectorHits:connectorThroughNode(s).length}))});
      await queueSave('complete');
    }catch(error){
      log('job.failure',{error},signal.aborted?'warn':'error');
      job.status=signal.aborted?'cancelled':'error';
      job.error=signal.aborted?'Cancelled by user':(error instanceof Error?error.message:String(error));
      // P5 failure taxonomy: classify so later eval can group failures without NLP.
      job.errorKind=signal.aborted?'cancel':classifyError(job.error);
      log('job.failure-classified',{jobId:job.id,errorKind:job.errorKind},signal.aborted?'warn':'error');
      persistSpans();await queueSave(job.status);
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