/** router:report — aggregate the call ledger into cost/success/latency per task+model.
 *  Reads app.log when present (all runs), else every .data/<job>/log.jsonl. Output is a
 *  plain table an operator uses to decide MODEL_ROUTER changes; no network calls.
 *
 *  Usage: npm run router:report [-- --log app.log] */
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {taskOfLabel} from '../src/shared/model-router.js';

interface Row{task:string;model:string;calls:number;repairs:number;failures:number;totalMs:number;cost:number}
const args=process.argv.slice(2);
const logArg=args.includes('--log')?args[args.indexOf('--log')+1]:'app.log';

function lines():string[]{
  if(existsSync(logArg))return readFileSync(logArg,'utf8').split('\n');
  const out:string[]=[];
  const dataDir='.data';
  if(!existsSync(dataDir))return out;
  for(const job of readdirSync(dataDir)){
    const f=join(dataDir,job,'log.jsonl');
    if(existsSync(f))out.push(...readFileSync(f,'utf8').split('\n'));
  }
  return out;
}

const agg=new Map<string,Row>();
let jobs=0;let wallMs=0;let jobCost=0;
for(const line of lines()){
  if(!line.trim())continue;
  let e:Record<string,unknown>;
  try{e=JSON.parse(line);}catch{continue;}
  if(e.event==='job.summary'){jobs++;wallMs+=Number(e.wallMs||0);jobCost+=Number(e.costUsd||0);continue;}
  if(e.event!=='planner.call')continue;
  const label=String(e.label||'');
  const task=taskOfLabel(label);
  const model=String(e.model||'?');
  if(model==='test/model')continue; // mock calls from the test suite
  const key=`${task}\t${model}`;
  const row=agg.get(key)||{task,model,calls:0,repairs:0,failures:0,totalMs:0,cost:0};
  row.calls++;
  if(label.endsWith('-repair'))row.repairs++;
  if(e.finishReason&&e.finishReason!=='stop')row.failures++;
  row.totalMs+=Number(e.elapsedMs||0);
  row.cost+=Number(e.costUsd||0);
  agg.set(key,row);
}

const rows=[...agg.values()].sort((a,b)=>b.cost-a.cost);
const pad=(s:string,n:number)=>s.length>=n?s.slice(0,n):s+' '.repeat(n-s.length);
console.log(pad('task',9)+pad('model',34)+pad('calls',6)+pad('repairs',8)+pad('fail',6)+pad('avg ms',8)+'cost(USD)');
for(const r of rows)console.log(pad(r.task,9)+pad(r.model,34)+pad(String(r.calls),6)+pad(String(r.repairs),8)+pad(String(r.failures),6)+pad(String(Math.round(r.totalMs/r.calls)),8)+r.cost.toFixed(5));
console.log(`\njobs=${jobs} avgWallMs=${jobs?Math.round(wallMs/jobs):0} totalCost=$${jobCost.toFixed(5)} avgCost=$${jobs?(jobCost/jobs).toFixed(5):'0'}`);
