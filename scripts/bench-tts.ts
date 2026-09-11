import {performance} from 'node:perf_hooks';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {argv} from 'node:process';

/** Local Kokoro throughput/latency benchmark. Zero paid API calls: it replays saved
 *  narration through one or more already-running kokoro servers.
 *
 *  Usage:
 *    node dist/scripts/bench-tts.js \
 *      --narrations output/bench/narrations.json \
 *      --servers http://127.0.0.1:8765[,http://127.0.0.1:8766,...] \
 *      --label "pool-3" --out output/bench/tts-pool-3.json
 *
 *  One in-flight request per server (the worker model the Node pool uses: a single
 *  kokoro server serializes on its internal lock, so overlapping it is pointless).
 *  Reports wall time, throughput, per-request service ms p50/p95/max and the server
 *  cache_mb/peak_mb before and after, so the Metal-buffer leak is observable. */

function opt(flag:string,fallback:string|null=null):string|null {
  const i=argv.indexOf(flag);
  return i>=0&&i+1<argv.length?argv[i+1]:fallback;
}
const narrationsPath=opt('--narrations','output/bench/narrations.json')!;
const servers=(opt('--servers','http://127.0.0.1:8765')!).split(',').map(s=>s.trim().replace(/\/+$/,'')).filter(Boolean);
const label=opt('--label','bench')!;
const outPath=opt('--out',`output/bench/tts-${label}.json`)!;

interface Narration {id:string;text:string;voice?:string}
interface Health {ok?:boolean;requests_served?:number;uptime_s?:number;cache_mb?:number;peak_mb?:number}

const narrations:Narration[]=JSON.parse(await readFile(narrationsPath,'utf8'));

async function health(url:string):Promise<Health|null>{
  try{const r=await fetch(`${url}/health`,{signal:AbortSignal.timeout(3000)});return r.ok?await r.json():null;}catch{return null}
}

interface Result {id:string;server:string;ok:boolean;serviceMs:number;chars:number;audioBytes?:number;durationMs?:number;error?:string}

const queue:[number,Result][]=(narrations.map((n,i)=>[i,{id:n.id,server:'',ok:false,serviceMs:0,chars:n.text.length}]));
const results:Result[]=new Array(narrations.length);
const before=await Promise.all(servers.map(health));

async function worker(url:string){
  for(;;){
    const item=queue.shift();
    if(!item)return;
    const [idx,base]=item;
    const started=performance.now();
    try{
      const n=narrations[idx];
      const r=await fetch(`${url}/synthesize`,{method:'POST',signal:AbortSignal.timeout(300000),headers:{'Content-Type':'application/json'},body:JSON.stringify({text:n.text,voice:n.voice||'af_heart'})});
      const j=await r.json() as {audio_base64?:string;timing?:{durationMs?:number};error?:string};
      const serviceMs=Math.round(performance.now()-started);
      if(!r.ok||!j.audio_base64)throw new Error(j.error||`HTTP ${r.status}`);
      results[idx]={...base,server:url,ok:true,serviceMs,audioBytes:Buffer.from(j.audio_base64,'base64').length,durationMs:j.timing?.durationMs};
    }catch(error){
      results[idx]={...base,server:url,ok:false,serviceMs:Math.round(performance.now()-started),error:error instanceof Error?error.message:String(error)};
    }
  }
}

const wallStart=performance.now();
await Promise.all(servers.map(worker));
const wallMs=Math.round(performance.now()-wallStart);
const after=await Promise.all(servers.map(health));

const services=results.filter(r=>r.ok).map(r=>r.serviceMs).sort((a,b)=>a-b);
const pct=(p:number)=>services.length?services[Math.min(services.length-1,Math.floor(services.length*p))]:0;
const report={
  label,date:new Date().toISOString(),servers,narrationCount:narrations.length,totalChars:narrations.reduce((a,n)=>a+n.text.length,0),
  ok:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,
  wallMs,scenesPerMinute:Number((results.filter(r=>r.ok).length/(wallMs/60000)).toFixed(2)),
  serviceMs:{min:services[0]??0,p50:pct(.5),p95:pct(.95),max:services.at(-1)??0,mean:services.length?Math.round(services.reduce((a,b)=>a+b,0)/services.length):0},
  serverBefore:before.map((h,i)=>({url:servers[i],...h})),serverAfter:after.map((h,i)=>({url:servers[i],...h})),
  perScene:results,
};
await mkdir('output/bench',{recursive:true});
await writeFile(outPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({label,ok:report.ok,failed:report.failed,wallMs,scenesPerMinute:report.scenesPerMinute,serviceMs:report.serviceMs,before:report.serverBefore,after:report.serverAfter},null,2));
