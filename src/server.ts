import {log,logContext} from './logger.js';
import {randomUUID} from 'node:crypto';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync,statSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve,dirname,extname} from 'node:path';
import {spawn} from 'node:child_process';
import {JobStore} from './jobs.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
async function body(req:IncomingMessage){let value='';for await(const chunk of req){value+=chunk;if(Buffer.byteLength(value)>72*1024*1024)throw new Error('Request too large');}return JSON.parse(value);}
export function makeServer({dataRoot=join(root,'.data'),providers={}}={}) {
  const store=new JobStore(dataRoot,providers);
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
        const eleKey=!!(process.env.ELEVENLABS_API_KEY&&process.env.ELEVENLABS_VOICE_ID);
        log('server.config',{plannerConfigured:orKey||anKey,openRouter:orKey,speechConfigured:eleKey});
        return json(res,200,{model:orKey||anKey,openRouter:orKey,speech:process.platform==='darwin'||eleKey,elevenlabs:!!process.env.ELEVENLABS_API_KEY,kokoroSpeech:process.platform==='darwin',modelId:process.env.OPENROUTER_MODEL||process.env.ANTHROPIC_MODEL||null});
      }
      if(req.method==='POST'&&url.pathname==='/api/client-events'){
        const event=await body(req);
        const allowed=['play','pause','seek','speed','audio-ended','audio-error','audio-blocked','buffering','resumed','playback-ended','client-error'];
        if(!allowed.includes(event.type)||!Number.isFinite(event.timeMs)||event.timeMs<0||event.timeMs>1800000||!Number.isFinite(event.rate)||event.rate<=0||event.rate>4||event.jobId!==null&&!/^[a-f0-9-]{36}$/.test(event.jobId))throw new Error('Invalid playback event');
        log('player.'+event.type,{jobId:event.jobId,timeMs:event.timeMs,rate:event.rate});
        return json(res,200,{ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/api/jobs'){
        return json(res,202,await store.create(await body(req)));
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
      // Exported MP4s live outside public/, so they get their own id-scoped static route,
      // mirroring /media/. This is the URL /api/export hands back to the browser.
      const exported=url.pathname.match(/^\/output\/([a-f0-9-]{36})\.mp4$/);
      let path;
      if(media)path=join(dataRoot,media[1],media[2]);
      else if(exported)path=join(root,'output',`${exported[1]}.mp4`);
      else if(['/src/engine.js','/src/fixtures.js','/src/vocabulary.js','/src/icons.js','/src/illustrations.js','/src/style.js'].includes(url.pathname))path=join(root,'dist',url.pathname);
      else {
        const requested=url.pathname==='/'?'index.html':url.pathname.slice(1);
        path=resolve(root,'public',requested);
        if(!path.startsWith(resolve(root,'public')+'/'))return json(res,403,{error:'Forbidden'});
      }
      if(url.pathname==='/app.js')path=join(root,'dist/public/app.js');
      const bytes=await readFile(path);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.mp3':'audio/mpeg','.wav':'audio/wav','.mp4':'video/mp4'})[extname(path)]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':'no-cache','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(bytes);
    }catch(caught){const error=caught as NodeJS.ErrnoException;log('http.error',{error},'error');json(res,error.code==='ENOENT'?404:400,{error:error.code==='ENOENT'?'Not found':error.message||'Request failed'});
    }
  }));
  server.on('error',error=>{log('server.error',{error},'error');process.exit(1);});
  return {server,store};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {server,store}=makeServer();const port=Number(process.env.PORT||3000);
  server.listen(port,'127.0.0.1',()=>log('server.listening',{url:'http://127.0.0.1:'+port,pid:process.pid,node:process.version}));
  for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{log('server.shutdown',{signal:event});await store.close();server.close(()=>process.exit(0));});
}