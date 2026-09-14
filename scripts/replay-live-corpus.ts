/** Replay saved model responses without editing originals or making provider calls. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {LIVE_EVAL_CASES} from '../eval/live/manifest.js';
import {generateV2} from '../src/semantic/planning/generate.js';
import {healSchema,assertSchema} from '../src/semantic/schemas.js';
import {lintCompiledScene} from '../src/semantic/evaluation.js';
import type {JsonModel} from '../src/semantic/planning/model-adapter.js';
const [source,out]=process.argv.slice(2);
if(!source||!out||resolve(source)===resolve(out))throw new Error('Usage: replay-live-corpus <source-run-directory> <new-output-directory>');
await mkdir(out);const results=[];
for(const c of LIVE_EVAL_CASES)for(let run=0;run<3;run++){
 let bytes:string;try{bytes=await readFile(join(source,c.id,String(run),'telemetry.json'),'utf8');}catch{continue;}
 const saved=JSON.parse(bytes),events=saved.modelEvents??[];
 const offsets:Record<string,number>={};
 const model:JsonModel={calls:[],events:[],async generate(stage,_instructions,_input,_schema,validate){
  const candidates=events.filter((e:any)=>e.stage===stage&&e.kind==='raw');let error:unknown;
  for(let i=offsets[stage]??0;i<candidates.length;i++){offsets[stage]=i+1;try{const value=healSchema(structuredClone(candidates[i].payload),_schema);assertSchema(value,_schema);return validate(value);}catch(e){error=e;}}
  throw error??new Error(`No recorded ${stage} response`);
 }};
 const entry:{caseId:string;run:number;sourceHash:string;status:string;error?:string}={caseId:c.id,run,sourceHash:createHash('sha256').update(bytes).digest('hex'),status:'complete'};
 try{for await(const r of generateV2({prompt:c.prompt,maxScenes:1,allowedArchetypes:c.preferredArchetypes??['simple_explanation']},model)){
  const hard=lintCompiledScene(r.compiled).filter(f=>f.severity==='hard');if(hard.length)throw new Error(hard.map(f=>f.code).join(', '));
 }}catch(e){entry.status='error';entry.error=String(e);}
 results.push(entry);
}
await writeFile(join(out,'report.json'),JSON.stringify({mode:'saved-response replay; estimated timing; no new model or TTS calls',source:resolve(source),results},null,2));
console.log(JSON.stringify({total:results.length,complete:results.filter(r=>r.status==='complete').length,out}));
