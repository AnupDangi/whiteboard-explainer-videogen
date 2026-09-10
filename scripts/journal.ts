/** P5 journal: read a job's log.jsonl ledger back as a human-readable timeline with a
 *  cost/call table and the final lint/failure summary — every verdict traceable. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const id=process.argv[2];
if(!id||!/^[a-f0-9-]{36}$/.test(id))throw new Error('Usage: node dist/scripts/journal.js <job-uuid>');
let lines:string[];
try {lines=(await readFile(join('.data',id,'log.jsonl'),'utf8')).trim().split('\n');}
catch{throw new Error(`No ledger at .data/${id}/log.jsonl`);}
const events=lines.map(l=>JSON.parse(l) as Record<string,unknown>);
const calls=events.filter(e=>e.event==='planner.call');
const failures=events.filter(e=>e.level==='error');
const job=events.at(-1) as Record<string,unknown>|undefined;
console.log(`# journal ${id}`);
console.log(`events: ${events.length}  calls: ${calls.length}  errors: ${failures.length}`);
if(calls.length){
  console.log('\ncalls:');
  for(const c of calls)console.log([c.at,c.label,c.attempt,c.finishReason,`${c.promptTokens}in/${c.completionTokens}out/${c.cachedTokens}cached`,c.costUsd].join('  '));
  const total=calls.reduce((n:number,c:Record<string,unknown>)=>n+(typeof c.costUsd==='number'?c.costUsd:0),0);
  console.log(`total modeled cost: $${total.toFixed(4)}`);
}
if(failures.length){console.log('\nerrors:');for(const f of failures)console.log(f.at,(f.error as {message?:string})?.message||f.event);}
const lints=events.find(e=>e.event==='job.lints');
if(lints){console.log('\nlints:');for(const s of lints.scenes as Array<Record<string,unknown>>)console.log(`  ${s.id}: staticInterval=${s.staticIntervalMs}ms connectorHits=${s.connectorHits}`);}
const status=(await readFile(join('.data',id,'job.json'),'utf8').then(JSON.parse).catch(()=>null)) as {status?:string;errorKind?:string;error?:string}|null;
if(status)console.log(`\njob: ${status.status}${status.errorKind?` (${status.errorKind})`:''}${status.error?` — ${status.error}`:''}`);
