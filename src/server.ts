import {log,logContext} from './core/logger.js';
import {randomUUID} from 'node:crypto';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve,extname,sep} from 'node:path';
import {DurableJobService,type DurableJobView} from './runtime/job-service.js';
import type {RuntimeRepository} from './runtime/repository.js';
import type {JobSnapshot} from './types/engine.js';
import {createConfiguredPostgresRuntime} from './runtime/postgres-bootstrap.js';
import {FileArtifactStore} from './runtime/artifacts.js';
import {createDefaultTaskHandler} from './runtime/handlers.js';
import {DurableRuntimeLauncher} from './runtime/launcher.js';
import {PaidSpeechGateway} from './gateway/paid-speech-gateway.js';
import {generateSpeech} from './generation/providers.js';
import type {BudgetLedger} from './gateway/budget-ledger.js';
import {RagGateway} from './gateway/rag-gateway.js';
import {LLMGateway} from './gateway/llm-gateway.js';
import {OpenRouterProvider} from './gateway/openrouter-provider.js';
import {DEFAULT_TEXT_MODEL,DEFAULT_VISION_MODEL} from './core/model-router.js';
import type {ArtifactStore} from './runtime/artifacts.js';
import type {CompiledScene} from './types/engine.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const envNumber=(name:string,fallback:number,min:number,max:number):number=>{
  const parsed=Number(process.env[name]??fallback);
  return Number.isFinite(parsed)?Math.max(min,Math.min(max,parsed)):fallback;
};
const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
async function body(req:IncomingMessage){let value='';for await(const chunk of req){value+=chunk;if(Buffer.byteLength(value)>72*1024*1024)throw new Error('Request too large');}return JSON.parse(value);}
interface ServerOptions {dataRoot?:string;runtimeRepository?:RuntimeRepository;durableBudgetLedger?:BudgetLedger;durableArtifacts?:ArtifactStore;paidSpeech?:PaidSpeechGateway;ragGateway?:RagGateway}
async function durableSnapshot(view:DurableJobView,artifactStore?:ArtifactStore,budgetLedger?:BudgetLedger):Promise<JobSnapshot> {
  const scenes:CompiledScene[]=[];
  if(artifactStore)for(const task of view.tasks.filter(candidate=>candidate.kind.startsWith('scene.compile')&&candidate.status==='succeeded'&&candidate.outputArtifactHash).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))){
    try{const bytes=await artifactStore.get(task.outputArtifactHash!);if(bytes)scenes.push(...JSON.parse(Buffer.from(bytes).toString('utf8')) as CompiledScene[]);}catch{/* task audit retains the failure */}
  }
  const availableMs=scenes.reduce((sum,scene)=>sum+scene.durationMs,0);
  const brief=view.events.find(event=>event.type==='teaching.brief.ready');
  const subject=brief&&typeof brief.payload==='object'?(brief.payload as {subject?:string}).subject:undefined;
  const request=view.request;
  const budget=budgetLedger?await budgetLedger.state(view.id,view.budgetLimitUsd):undefined;
  const costPerMinuteUsd=budget&&availableMs>0?budget.spentUsd/(availableMs/60000):undefined;
  const taskStageMs:Record<string,number>={};
  for(const task of view.tasks){
    const stage=task.kind.startsWith('source.')?'ingestion':task.kind.startsWith('concept-graph')?'concept-graph':task.kind.startsWith('teaching.')||task.kind.startsWith('scene.plan')?'planning':task.kind.startsWith('scene.tts')?'tts':task.kind.startsWith('scene.compile')?'compile':task.kind==='export.render'?'render':task.kind;
    taskStageMs[stage]=(taskStageMs[stage]??0)+Math.max(0,task.updatedAt-task.createdAt);
  }
  return {id:view.id,status:view.status==='failed'?'error':view.status,revision:view.events.at(-1)?.sequence??0,createdAt:view.createdAt,mode:'model',targetMinutes:request.durationMinutes,plannerBudgetUsd:view.budgetLimitUsd,ttsCharacters:0,timingMode:view.events.some(event=>event.type==='scene.tts.ready'&&(event.payload as {timingSource?:string})?.timingSource==='provider')?'provider-aligned':'durable',simulatedDelayMs:0,scenes,availableMs,actualMinutes:availableMs/60000,costPerMinuteUsd,title:scenes[0]?.title??subject??request.instruction??'Untitled lesson',totalScenes:scenes.length,events:view.events.map(event=>({sequence:event.sequence,type:event.type,atMs:Math.max(0,event.at-view.createdAt),availableMs:typeof (event.payload as {availableMs?:unknown})?.availableMs==='number'?(event.payload as {availableMs:number}).availableMs:availableMs,...(event.payload&&typeof event.payload==='object'?{payload:event.payload as Record<string,unknown>}:{})})),schemaVersion:view.schemaVersion,request,captionMode:request.stylePreferences.captionMode,spans:{stageMs:taskStageMs},...(budget?{usage:{model:'durable-gateway',promptTokens:0,completionTokens:0,cachedTokens:0,costUsd:budget.spentUsd,calls:budget.calls}}:{}),...(view.error?{error:view.error}:{})};
}
function makeServer({dataRoot=join(root,'.data'),runtimeRepository,durableBudgetLedger,durableArtifacts,paidSpeech,ragGateway}:ServerOptions={}) {
  if(!runtimeRepository)throw new Error('The durable runtime requires a PostgreSQL repository (set DATABASE_URL)');
  const durable=new DurableJobService(runtimeRepository);
  const getJob=async(id:string):Promise<JobSnapshot|null>=>{const view=await durable.get(id);return view?await durableSnapshot(view,durableArtifacts,durableBudgetLedger):null;};
  const server=createServer((req,res)=>logContext.run({requestId:randomUUID()},async()=>{
    const started=performance.now();
    log('http.request',{method:req.method,path:(req.url||'/').split('?')[0]});
    res.on('finish',()=>log('http.response',{method:req.method,path:(req.url||'/').split('?')[0],status:res.statusCode,elapsedMs:Math.round(performance.now()-started)},res.statusCode>=400?'warn':'info'));
    res.on('close',()=>{if(!res.writableFinished)log('http.disconnected',{method:req.method},'warn');});
    try {
      const url=new URL(req.url||'/','http://localhost');
      const host=req.headers.host?.split(':')[0];
      if(!['localhost','127.0.0.1','['].includes(host||''))return json(res,403,{error:'Local host required'});
      if(req.method==='POST'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Cross-origin requests denied'});
      if(req.method==='GET'&&url.pathname==='/api/config'){
        const orKey=!!process.env.OPENROUTER_API_KEY;
        const eleKey=!!(process.env.ELEVENLABS_API_KEY&&process.env.ELEVENLABS_VOICE_ID);
        log('server.config',{openRouter:orKey,speechConfigured:eleKey});
        return json(res,200,{model:orKey,openRouter:orKey,speech:true,elevenlabs:!!process.env.ELEVENLABS_API_KEY,modelId:process.env.OPENROUTER_MODEL||null,tiers:{outline:process.env.OPENROUTER_OUTLINE_MODEL||process.env.OPENROUTER_MODEL||DEFAULT_TEXT_MODEL,content:process.env.OPENROUTER_CONTENT_MODEL||process.env.OPENROUTER_MODEL||DEFAULT_TEXT_MODEL,director:process.env.OPENROUTER_DIRECTOR_MODEL||process.env.OPENROUTER_MODEL||DEFAULT_TEXT_MODEL,vision:process.env.OPENROUTER_VISION_MODEL||process.env.OPENROUTER_MODEL||DEFAULT_VISION_MODEL}});
      }
      if(req.method==='GET'&&url.pathname==='/api/admin/jobs'){
        const limit=Math.max(1,Math.min(100,Number(url.searchParams.get('limit')??50)));
        const persisted=await runtimeRepository.listJobs(limit);
        const jobs=await Promise.all(persisted.map(async candidate=>{
          const view=await durable.get(candidate.id);
          if(!view)return null;
          const snapshot=await durableSnapshot(view,durableArtifacts,durableBudgetLedger);
          const tasks=view.tasks;
          return {id:snapshot.id,status:snapshot.status,title:snapshot.title,targetMinutes:snapshot.targetMinutes,actualMinutes:snapshot.actualMinutes,costPerMinuteUsd:snapshot.costPerMinuteUsd,createdAt:snapshot.createdAt,updatedAt:candidate.updatedAt,sceneCount:snapshot.scenes.length,totalScenes:snapshot.totalScenes,availableMs:snapshot.availableMs,timingMode:snapshot.timingMode,captionMode:snapshot.captionMode,usage:snapshot.usage,budget:{limitUsd:view.budgetLimitUsd,spentUsd:snapshot.usage?.costUsd??0},stageMs:snapshot.spans?.stageMs,fallbackCount:tasks.filter(task=>Boolean(task.degradation)).length,error:snapshot.error};
        }));
        return json(res,200,{runtime:'postgres',jobs:jobs.filter(Boolean)});
      }
      if(req.method==='POST'&&url.pathname==='/api/client-events'){
        const event=await body(req);
        const allowed=['play','pause','seek','speed','audio-ended','audio-error','audio-blocked','buffering','resumed','playback-ended','client-error'];
        if(!allowed.includes(event.type)||!Number.isFinite(event.timeMs)||event.timeMs<0||event.timeMs>1800000||!Number.isFinite(event.rate)||event.rate<=0||event.rate>4||event.jobId!==null&&!/^[a-f0-9-]{36}$/.test(event.jobId))throw new Error('Invalid playback event');
        log('player.'+event.type,{jobId:event.jobId,timeMs:event.timeMs,rate:event.rate});
        return json(res,200,{ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/api/jobs'){
        const value=await body(req);
        const key=req.headers['idempotency-key'];
        if(Array.isArray(key)||key!==undefined&&(typeof key!=='string'||key.length<1||key.length>200))throw new Error('Invalid Idempotency-Key');
        return json(res,202,await durableSnapshot(await durable.submit(value,key),durableArtifacts,durableBudgetLedger));
      }
      const eventMatch=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/events$/);
      const auditMatch=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/audit$/);
      if(req.method==='GET'&&auditMatch){
        const found=await getJob(auditMatch[1]);
        if(!found)return json(res,404,{error:'Job not found'});
        const tasks=await runtimeRepository.listTasks(auditMatch[1]);
        const events=await runtimeRepository.listEvents(auditMatch[1],0,1000);
        return json(res,200,{version:1,jobId:auditMatch[1],generatedAt:new Date().toISOString(),durable:true,job:found,artifacts:{'job.json':{present:true,value:found},'durable-tasks.json':{present:true,value:tasks},'durable-events.json':{present:true,value:events}}});
      }
      if(req.method==='GET'&&eventMatch){
        const found=await getJob(eventMatch[1]);
        if(!found)return json(res,404,{error:'Job not found'});
        const requested=Number(url.searchParams.get('after')??req.headers['last-event-id']??0);
        let sequence=Number.isFinite(requested)&&requested>=0?requested:0;
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
        const send=async()=>{
          const job=await getJob(eventMatch[1]);if(!job){res.end();return;}
          for(const event of job.events.filter(item=>item.sequence>sequence)){
            sequence=event.sequence;
            res.write(`id: ${event.sequence}\nevent: job-event\ndata: ${JSON.stringify(event)}\n\n`);
          }
          if(['complete','partial','error','cancelled'].includes(job.status)){res.end();return;}
          timer=setTimeout(()=>void send(),250);
        };
        let timer:ReturnType<typeof setTimeout>|undefined;
        req.once('close',()=>{if(timer)clearTimeout(timer);});
        await send();return;
      }
      const createExport=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/exports$/);
      if(req.method==='POST'&&createExport){
        const job=await getJob(createExport[1]);
        if(!job)return json(res,404,{error:'Job not found'});
        if(job.status!=='complete')return json(res,409,{error:'Job must be complete before export'});
        const task=await durable.enqueueExport(job.id);return json(res,202,{id:task.id,jobId:job.id,status:task.status});
      }
      const exportStatus=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/exports\/([a-f0-9-]{36})$/);
      if(req.method==='GET'&&exportStatus){
        const task=await runtimeRepository.getTask(exportStatus[2]);
        return json(res,task&&task.jobId===exportStatus[1]?200:404,task&&task.jobId===exportStatus[1]?{id:task.id,jobId:task.jobId,status:task.status==='succeeded'?'complete':task.status==='failed'?'failed':task.status}:{error:'Export not found'});
      }
      const jobMatch=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})(\/cancel)?$/);
      if(jobMatch){
        if(req.method==='POST'&&jobMatch[2]){
          return json(res,200,{cancelled:await durable.cancel(jobMatch[1])});
        }
        if(req.method==='GET'&&!jobMatch[2]){
          const job=await getJob(jobMatch[1]);
          return json(res,job?200:404,job||{error:'Job not found'});
        }
      }
      if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
      if(req.method==='GET'&&url.pathname==='/api/export'){
        const jobId=url.searchParams.get('job')||'';
        if(!/^[a-f0-9-]{36}$/.test(jobId))return json(res,400,{error:'Invalid job ID'});
        try{const task=await durable.enqueueExport(jobId);return json(res,task.status==='succeeded'?200:202,{id:task.id,jobId,status:task.status==='succeeded'?'complete':task.status});}catch(error){return json(res,(error as Error).message==='Job not found'?404:409,{error:(error as Error).message});}
      }
      const media=url.pathname.match(/^\/media\/([a-f0-9-]{36})\/([a-zA-Z0-9_-]+\.(?:mp3|wav))$/);
      const exported=url.pathname.match(/^\/output\/([a-f0-9-]{36})\.(mp4|vtt)$/);
      let path;
      if(media)path=join(dataRoot,media[1],media[2]);
      else if(exported)path=join(root,'output',`${exported[1]}.${exported[2]}`);
      else if(url.pathname.startsWith('/src/')&&url.pathname.endsWith('.js')){
        path=resolve(root,'dist',url.pathname.slice(1));
        if(!path.startsWith(resolve(root,'dist','src')+sep))return json(res,403,{error:'Forbidden'});
      }
      else if(url.pathname==='/admin')path=join(root,'public','admin.html');
      else {
        const requested=url.pathname==='/'?'index.html':url.pathname.slice(1);
        path=resolve(root,'public',requested);
        if(!path.startsWith(resolve(root,'public')+'/'))return json(res,403,{error:'Forbidden'});
      }
      if(url.pathname==='/app.js')path=join(root,'dist/public/app.js');
      if(url.pathname==='/admin.js')path=join(root,'dist/public/admin.js');
      const bytes=await readFile(path);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.mp3':'audio/mpeg','.wav':'audio/wav','.mp4':'video/mp4','.vtt':'video/vtt'})[extname(path)]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':'no-cache','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(bytes);
    }catch(caught){const error=caught as NodeJS.ErrnoException;log('http.error',{error},'error');json(res,error.code==='ENOENT'?404:400,{error:error.code==='ENOENT'?'Not found':error.message||'Request failed'});
    }
  }));
  server.on('error',error=>{log('server.error',{error},'error');});
  return {server};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const start=async()=>{
    const configured=await createConfiguredPostgresRuntime();
    if(!configured)throw new Error('DATABASE_URL is required: the durable runtime is the only supported architecture');
    const dataRoot=process.env.DATA_ROOT?.trim()||join(root,'.data');
    const paidSpeech=configured.budgetLedger&&process.env.ELEVENLABS_API_KEY&&process.env.ELEVENLABS_VOICE_ID
      ?new PaidSpeechGateway(configured.budgetLedger,(text,options)=>generateSpeech(text,{env:process.env,signal:options.signal,voiceId:options.voiceId,providerRequestId:options.providerRequestId}),{usdPerThousandCharacters:Number(process.env.ELEVENLABS_USD_PER_1000_CHARS||'.30')})
      :undefined;
    const ragGateway=new RagGateway(configured.budgetLedger);
    const durableVisionGateway=new LLMGateway({openrouter:new OpenRouterProvider(process.env)},configured.budgetLedger);
    const durableArtifacts=new FileArtifactStore(join(dataRoot,'artifacts'));
    const {server}=makeServer({dataRoot,runtimeRepository:configured.repository,durableBudgetLedger:configured.budgetLedger,durableArtifacts,paidSpeech,ragGateway});const port=Number(process.env.PORT||3000);
    const launcher=new DurableRuntimeLauncher(
      configured.repository,
      createDefaultTaskHandler({repository:configured.repository,artifacts:durableArtifacts,workingDir:dataRoot,budgetLedger:configured.budgetLedger,paidSpeech,ragGateway,visionGateway:durableVisionGateway}),
      {pools:['ingest','llm','tts','compile','render'],workerCount:Math.round(envNumber('RUNTIME_WORKERS',3,1,32)),leaseMs:envNumber('RUNTIME_LEASE_MS',30000,100,300000),idleMs:envNumber('RUNTIME_IDLE_MS',250,25,60000)},
    );
    launcher.start();
    server.on('error',()=>{process.exitCode=1;});
    server.listen(port,'127.0.0.1',()=>log('server.listening',{url:'http://127.0.0.1:'+port,pid:process.pid,node:process.version,runtime:'postgres',workers:Math.round(envNumber('RUNTIME_WORKERS',3,1,32))}));
    for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{log('server.shutdown',{signal:event});await launcher.stop(new Error(`Server shutting down (${event})`));await configured.close();server.close(()=>process.exit(0));});
  };
  start().catch(error=>{log('server.start-failed',{error},'error');process.exitCode=1;});
}
