import {visualPipeline} from './semantic/pipeline.js';
import {compileScene as compileSemanticScene} from './semantic/compiler/compile-scene.js';
import {log,logContext} from './shared/logger.js';
import {randomUUID} from 'node:crypto';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync,statSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve,dirname,extname} from 'node:path';
import {spawn} from 'node:child_process';
import {JobStore} from './explainer/jobs.js';
import {SemanticJobStore} from './semantic/jobs.js';
import {createJsonModel} from './semantic/planning/model-adapter.js';
import {createVisionJudge} from './semantic/vision-judge.js';
import {createVoiceEngineSpeech} from './semantic/speech.js';
import {DEFAULT_FAST_MODEL,loadModelFallbacks} from './shared/model-router.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
async function body(req:IncomingMessage){let value='';for await(const chunk of req){value+=chunk;if(Buffer.byteLength(value)>72*1024*1024)throw new Error('Request too large');}return JSON.parse(value);}
export function makeServer({dataRoot=join(root,'.data'),providers={}}={}) {
  const pipeline=visualPipeline(process.env);
  const store=new JobStore(dataRoot,providers);
  const semanticStore=new SemanticJobStore(join(dataRoot,'semantic'),{
    model:(env,options)=>createJsonModel({env,signal:options?.signal,maxCostUsd:options?.maxCostUsd??Number(env.V2_JOB_BUDGET_USD??.15),onOutput:async(stage,attempt,value)=>{
      const active=options?semanticStore.jobs.get(options.jobId):undefined;if(!active)return;
      const {mkdir,writeFile}=await import('node:fs/promises');await mkdir(join(dataRoot,'semantic',active.id),{recursive:true});
      await writeFile(join(dataRoot,'semantic',active.id,`${stage}-${Date.now()}-attempt-${attempt}.json`),JSON.stringify(value,null,2));
    }}),
    judge:env=>createVisionJudge({env,maxCostUsd:Number(env.V2_CRITIC_BUDGET_USD??.25)}),
    speech:(language,signal)=>createVoiceEngineSpeech({language,signal}),
  },join(root,'output'),pipeline);
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
        const anKey=!!process.env.ANTHROPIC_API_KEY;
        log('server.config',{plannerConfigured:orKey||anKey,openRouter:orKey,speechConfigured:true});
        return json(res,200,{visualPipeline:pipeline,model:orKey||anKey,openRouter:orKey,speech:true,voiceEngine:true,modelId:process.env.OPENROUTER_MODEL||process.env.ANTHROPIC_MODEL||null,fallbacks:loadModelFallbacks(process.env),tiers:{outline:process.env.OPENROUTER_OUTLINE_MODEL||process.env.OPENROUTER_MODEL||DEFAULT_FAST_MODEL,content:process.env.OPENROUTER_CONTENT_MODEL||process.env.OPENROUTER_MODEL||DEFAULT_FAST_MODEL,director:process.env.OPENROUTER_DIRECTOR_MODEL||process.env.OPENROUTER_MODEL||DEFAULT_FAST_MODEL,vision:process.env.OPENROUTER_VISION_MODEL||process.env.OPENROUTER_MODEL||DEFAULT_FAST_MODEL}});
      }
      if(req.method==='POST'&&url.pathname==='/api/client-events'){
        const event=await body(req);
        const allowed=['play','pause','seek','speed','audio-ended','audio-error','audio-blocked','audio-stalled','buffering','resumed','playback-ended','client-error','frame-error'];
        if(!allowed.includes(event.type)||!Number.isFinite(event.timeMs)||event.timeMs<0||event.timeMs>1800000||!Number.isFinite(event.rate)||event.rate<=0||event.rate>4||event.jobId!==null&&!/^[a-f0-9-]{36}$/.test(event.jobId))throw new Error('Invalid playback event');
        if(event.detail!==undefined&&typeof event.detail!=='string')throw new Error('Invalid playback event');
        const detail=typeof event.detail==='string'?event.detail.slice(0,300):undefined;
        log('player.'+event.type,{jobId:event.jobId,timeMs:event.timeMs,rate:event.rate,...(detail?{detail}:{})});
        return json(res,200,{ok:true});
      }
      if(req.method==='GET'&&url.pathname==='/api/semantic/golden'){
        return json(res,200,compileSemanticScene(JSON.parse(await readFile(join(root,'examples/semantic/photosynthesis-plant.scene.json'),'utf8'))));
      }
      if(req.method==='POST'&&url.pathname==='/api/semantic/compile'){
        return json(res,200,compileSemanticScene(await body(req)));
      }
      if(req.method==='POST'&&url.pathname==='/api/semantic/jobs'){
        return json(res,202,await semanticStore.create(await body(req)));
      }
      const semanticJobMatch=url.pathname.match(/^\/api\/semantic\/jobs\/([a-f0-9-]{36})(\/cancel)?$/);
      if(semanticJobMatch){
        if(req.method==='POST'&&semanticJobMatch[2]){
          return json(res,200,{cancelled:await semanticStore.cancel(semanticJobMatch[1])});
        }
        if(req.method==='GET'&&!semanticJobMatch[2]){
          const job=await semanticStore.get(semanticJobMatch[1]);
          return json(res,job?200:404,job||{error:'Job not found'});
        }
      }
      const semanticRetryMatch=url.pathname.match(/^\/api\/semantic\/jobs\/([a-f0-9-]{36})\/retry$/);
      if(semanticRetryMatch&&req.method==='POST'){
        try{
          const retried=await semanticStore.retry(semanticRetryMatch[1]);
          return json(res,202,retried);
        }catch(e){
          const message=e instanceof Error?e.message:String(e);
          return json(res,/not found/.test(message)?404:400,{error:message});
        }
      }
      // Single-MP4 download for a semantic job: renders every scene through the
      // canonical renderer, muxes narration, concatenates. Same /output/<id>.mp4
      // delivery as the explainer export.
      const semanticExportMatch=url.pathname.match(/^\/api\/semantic\/jobs\/([a-f0-9-]{36})\/export$/);
      if(semanticExportMatch&&req.method==='GET'){
        const id=semanticExportMatch[1];
        try{
          const result=await semanticStore.exportMp4(id);
          return json(res,200,{...result,status:'complete'});
        }catch(e){
          const message=e instanceof Error?e.message:String(e);
          return json(res,/Job not found/.test(message)?404:500,{error:message});
        }
      }
      // SSE stream: pushes each scene as it becomes ready, with offset-based resume.
      // `from` = number of scenes the client already has; events replay from there.
      const semanticStreamMatch=url.pathname.match(/^\/api\/semantic\/jobs\/([a-f0-9-]{36})\/stream$/);
      if(semanticStreamMatch&&req.method==='GET'){
        const job=await semanticStore.get(semanticStreamMatch[1]);
        if(!job)return json(res,404,{error:'Job not found'});
        let from=Number(url.searchParams.get('from')??'0');
        if(!Number.isInteger(from)||from<0)from=0;
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive'});
        const send=(event:string,data:unknown)=>{res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
        let closed=false;req.on('close',()=>{closed=true;});
        for(let i=from;i<job.scenes.length&&!closed;i++)send('scene',job.scenes[i]);
        send('status',job);
        if(['complete','partial','error','cancelled','interrupted'].includes(job.status)){send('end',{status:job.status});res.end();return;}
        let lastRevision=job.revision;
        const poll=setInterval(async()=>{
          if(closed){clearInterval(poll);return;}
          try{
            const current=await semanticStore.get(semanticStreamMatch[1]);
            if(!current){clearInterval(poll);res.end();return;}
            for(let i=from;i<current.scenes.length&&!closed;i++){send('scene',current.scenes[i]);}
            from=Math.max(from,current.scenes.length);
            if(current.revision!==lastRevision){lastRevision=current.revision;send('status',current);}
            if(['complete','partial','error','cancelled','interrupted'].includes(current.status)){clearInterval(poll);send('end',{status:current.status});res.end();}
          }catch(e){clearInterval(poll);res.end();}
        },500);
        return;
      }
      if(req.method==='POST'&&url.pathname==='/api/jobs'){
        return json(res,202,await store.create(await body(req)));
      }
      // Minimal library: recent jobs from disk so prompt-built videos survive
      // reloads and can be reopened via /?job=<id>. Bounded to 20, metadata only.
      if(req.method==='GET'&&url.pathname==='/api/jobs'){
        const {readdir}=await import('node:fs/promises');
        const entries:Record<string,unknown>[]=[];
        const collect=async(dir:string,pipeline:string)=>{
          let names:string[]=[];
          try{names=await readdir(dir);}catch{return;}
          for(const name of names){
            if(!/^[a-f0-9-]{36}$/.test(name))continue;
            try{
              const job=JSON.parse(await readFile(join(dir,name,'job.json'),'utf8'));
              entries.push({id:job.id,title:job.title||job.prompt?.slice(0,80)||name,status:job.status,createdAt:job.createdAt||0,scenes:(job.scenes||[]).length,availableMs:job.availableMs||0,pipeline});
            }catch{/* skip unreadable snapshots */}
          }
        };
        await collect(dataRoot,'explainer');
        await collect(join(dataRoot,'semantic'),'semantic');
        entries.sort((a,b)=>Number(b.createdAt)-Number(a.createdAt));
        return json(res,200,{jobs:entries.slice(0,20)});
      }
      const jobMatch=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})(\/cancel)?$/);
      if(jobMatch){
        if(req.method==='POST'&&jobMatch[2]){
          return json(res,200,{cancelled:await store.cancel(jobMatch[1])});
        }
        if(req.method==='GET'&&!jobMatch[2]){
          const job=await store.get(jobMatch[1]);
          return json(res,job?200:404,job||{error:'Job not found'});
        }
      }
      if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
      if(req.method==='GET'&&url.pathname==='/api/export'){
        // The job id arrives as a query parameter (`/api/export?job=<uuid>`); the pathname is
        // the literal route, so parsing an id out of it always yielded "export" and 400'd.
        const jobId=url.searchParams.get('job')||'';
        if(!/^[a-f0-9-]{36}$/.test(jobId))return json(res,400,{error:'Invalid job ID'});
        const jobPath=join(dataRoot,jobId,'job.json');
        if(!existsSync(jobPath))return json(res,404,{error:'Job not found'});
        const outputPath=join(root,'output',`${jobId}.mp4`);
        // The browser can only fetch an HTTP path, never an absolute filesystem path, so the
        // response advertises the /output/<id>.mp4 route served below (same convention as /media/).
        const outputUrl=`/output/${jobId}.mp4`;
        mkdirSync(dirname(outputPath),{recursive:true});
        const exportProc=spawn('node',['dist/scripts/export.js', '--input', jobPath, '--out', outputPath, '--fps', '12', '--width', '1280'], {stdio: 'pipe', cwd: resolve(root)});
        let stdout=''; let stderr='';
        exportProc.stdout.on('data',d=>stdout+=d.toString());
        exportProc.stderr.on('data',d=>stderr+=d.toString());
        exportProc.on('close',async (code)=>{
          if(code===0){
            // Check if MP4 was generated
            if(existsSync(outputPath)){
              const fileSize=Math.round(statSync(outputPath).size/1024)+' KB';
              json(res,200,{output:outputUrl,size:fileSize,status:'complete'});
            }else{
              json(res,500,{error:'MP4 not generated after export completion'});
            }
          }else{
            json(res,500,{error:`Export failed: ${stderr||stdout}`});
          }
        });
        exportProc.on('error',e=>json(res,500,{error:e instanceof Error?e.message:String(e)}));
        return;
      }
      const media=url.pathname.match(/^\/media\/([a-f0-9-]{36})\/([a-zA-Z0-9_-]+\.(?:mp3|wav))$/);
      const semanticMedia=url.pathname.match(/^\/media\/semantic\/([a-f0-9-]{36})\/([a-zA-Z0-9_-]+\.(?:mp3|wav|json))$/);
      // Exported MP4s live outside public/, so they get their own id-scoped static route,
      // mirroring /media/. This is the URL /api/export hands back to the browser.
      const exported=url.pathname.match(/^\/output\/([a-f0-9-]{36})\.mp4$/);
      let path;
      if(media)path=join(dataRoot,media[1],media[2]);
      else if(semanticMedia)path=join(dataRoot,'semantic',semanticMedia[1],semanticMedia[2]);
      else if(exported)path=join(root,'output',`${exported[1]}.mp4`);
      else if(/^\/src\/semantic\/(?:compiler\/text|renderer\/(?:render-svg|style|scene-state|illustrations|primitives|relations|cursor|captions|steps)|assets\/(?:registry|validator|geometry|illustrations\/plant|icons\/inputs|templates\/catalog))\.js$/.test(url.pathname))path=join(root,'dist',url.pathname);
      else if(/^\/src\/(?:explainer\/[a-z0-9-]+|shared\/(?:logger|model-router|types|voice-engine-client|vocabulary|language))\.js$/.test(url.pathname))path=join(root,'dist',url.pathname);
      else {
        const requested=url.pathname==='/'?(pipeline==='explainer'?'index.html':'semantic.html'):url.pathname.slice(1);
        path=resolve(root,'public',requested);
        if(!path.startsWith(resolve(root,'public')+'/'))return json(res,403,{error:'Forbidden'});
      }
      if(url.pathname==='/semantic-viewer.js')path=join(root,'dist/public/semantic-viewer.js');
      if(url.pathname==='/app.js')path=join(root,'dist/public/app.js');
      const bytes=await readFile(path);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.mp3':'audio/mpeg','.wav':'audio/wav','.mp4':'video/mp4'})[extname(path)]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':'no-cache','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(bytes);
    }catch(caught){const error=caught as NodeJS.ErrnoException;log('http.error',{error},'error');json(res,error.code==='ENOENT'?404:400,{error:error.code==='ENOENT'?'Not found':error.message||'Request failed'});
    }
  }));
  server.on('error',error=>{log('server.error',{error},'error');process.exit(1);});
  return {server,store,semanticStore};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {server,store,semanticStore}=makeServer();const port=Number(process.env.PORT||3000);
  server.listen(port,'127.0.0.1',()=>log('server.listening',{url:'http://127.0.0.1:'+port,pid:process.pid,node:process.version}));
  for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{log('server.shutdown',{signal:event});await Promise.allSettled([store.close(),semanticStore.close()]);server.close(()=>process.exit(0));});
}
