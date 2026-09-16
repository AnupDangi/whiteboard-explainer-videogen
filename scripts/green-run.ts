/** A5 narrow green run: the smallest live LLM job repeated N times.
 *
 *  Config: 1 scene, prompt-only (no source), narration, no MP4 — the shortest
 *  path through the new architecture. Success = finalGate PASS + publishable.
 *
 *  Usage: node --env-file-if-exists=.env dist/scripts/green-run.js [runs]
 */
const {SemanticJobStore}=await import(process.cwd()+'/dist/src/semantic/jobs.js');
const {createJsonModel}=await import(process.cwd()+'/dist/src/semantic/planning/model-adapter.js');
const {createVoiceEngineSpeech}=await import(process.cwd()+'/dist/src/semantic/speech.js');

const runs=Number(process.argv[2]??10);
const store=new SemanticJobStore('.data/green-run-jobs',{model:(env:NodeJS.ProcessEnv,opts:Record<string,unknown>)=>createJsonModel({...opts} as Parameters<typeof createJsonModel>[0]),speech:(language:string,signal?:AbortSignal)=>createVoiceEngineSpeech({signal})});
const spec={prompt:'Explain how a refrigerator moves heat: the compressor squeezes the refrigerant, the condenser releases heat outside, the expansion valve drops the pressure, and the evaporator absorbs heat from inside. Walk the refrigerant loop once.',allowedArchetypes:['cycle','flow','structural_diagram'],narration:true,targetMinutes:1,maxCostUsd:.3,groundingPolicy:'source-only',language:'en'};

const results=[];
for(let i=0;i<runs;i++){
 const t0=Date.now();
 let snapshot;
 try{snapshot=await store.create({...spec});}catch(error){results.push({run:i+1,status:'create-failed',error:String(error)});continue;}
 let job=await store.get(snapshot.id);
 for(let poll=0;poll<240&&!['complete','partial','error','cancelled'].includes(job.status);poll++){await new Promise(r=>setTimeout(r,2000));job=await store.get(snapshot.id);}
 const wallMs=Date.now()-t0;
 results.push({run:i+1,jobId:snapshot.id,status:job.status,finalGate:job.finalGate,publishable:job.publishable,scenes:job.scenes.length,firstPlayableMs:job.firstPlayableMs,costUsd:Number((job.costUsd??0).toFixed(4)),calls:job.calls,wallMs,error:job.error??null});
 console.log(JSON.stringify(results.at(-1)));
}
const pass=results.filter(r=>r.finalGate==='PASS'&&r.publishable).length;
console.log(JSON.stringify({summary:{runs,pass,fail:runs-pass,passRate:`${Math.round(pass/runs*100)}%`,totalCostUsd:Number(results.reduce((n,r)=>n+(r.costUsd??0),0).toFixed(4)),medianWallMs:results.map(r=>r.wallMs??0).sort((a,b)=>(a??0)-(b??0))[Math.floor(results.length/2)]}},null,2));
await store.close();
