import {createJsonModel} from '../src/semantic/planning/model-adapter.js';
import {generateV2} from '../src/semantic/planning/generate.js';
import {generateV3} from '../src/semantic/frontend/generate-v3.js';
import {parseBlocks} from '../src/shared/ingestion/blocks.js';
import type {VisualArchetype} from '../src/semantic/types.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Reproducible current-vs-new front-end comparison (`Architecture_plan.md`
 *  §46 Agent H, §47). Runs the SAME source and prompt through `semantic` (V2)
 *  and `semantic-v3`, and reports the numbers the migration gates care about:
 *  scene count, wall time, output duration vs the requested window, call count
 *  and cost. Live-only: it needs OPENROUTER_API_KEY; a failed pipeline is
 *  reported as a visible failure row, never hidden. */
export interface FrontendCase {id:string;text:string;prompt:string}
export interface FrontendRun {
  pipeline:'semantic'|'semantic-v3';
  case:string;
  scenes:number;
  wallSec:number;
  outputSec:number;
  /** output duration / requested duration. The job gate accepts 0.85-1.15. */
  ratio:number;
  durationPass:boolean;
  calls:number;
  costUsd:number;
  error?:string;
}

export const DEFAULT_CASES:FrontendCase[]=[
  {id:'photosynthesis',text:'# Photosynthesis\n\nPlants use sunlight, water and carbon dioxide to make glucose and release oxygen. Chlorophyll absorbs light in the chloroplast.\n',prompt:'Explain photosynthesis for a beginner'},
  {id:'http',text:'# HTTP request lifecycle\n\nA browser resolves a domain with DNS, opens a TCP connection, sends an HTTP request, the server responds with a status and headers, then the browser renders the body. HTTPS wraps the exchange in TLS.\n',prompt:'Explain the HTTP request lifecycle for a beginner'},
  {id:'gradient',text:'# Gradient descent\n\nA model computes a loss, the gradient of that loss points uphill, so the parameters step in the opposite direction scaled by the learning rate. Repeating this reduces the loss until it converges.\n',prompt:'Explain gradient descent for a beginner'},
];

const V2_ARCHETYPES:VisualArchetype[]=['flow','cycle','comparison','cause_effect','transformation','structural_diagram','numbered_steps','equation_walkthrough'];

/** The job-level duration contract: prepared output must be within ±15% of the
 *  requested length (`src/semantic/jobs.ts`). Pure, so it is testable. */
export function durationRatio(outputMs:number,targetMinutes:number):number{
  return targetMinutes>0?outputMs/(targetMinutes*60000):1;
}
export function durationPasses(ratio:number):boolean{return ratio>=0.85&&ratio<=1.15;}

async function runV3(testCase:FrontendCase,targetMinutes:number):Promise<FrontendRun>{
  const model=createJsonModel({env:process.env,maxCostUsd:Number(process.env.V2_JOB_BUDGET_USD??0.6)});
  const doc={kind:'text',label:testCase.id,text:testCase.text,sha256:`compare-v3-${testCase.id}`,blocks:parseBlocks(testCase.text)};
  const started=Date.now();let scenes=0,outputMs=0;
  try{
    for await(const result of generateV3(doc,{prompt:testCase.prompt,targetMinutes},model)){scenes++;outputMs+=result.compiled.durationMs;}
  }catch(error){
    return {pipeline:'semantic-v3',case:testCase.id,scenes,wallSec:(Date.now()-started)/1000,outputSec:outputMs/1000,ratio:durationRatio(outputMs,targetMinutes),durationPass:false,calls:model.calls.length,costUsd:model.calls.reduce((sum,call)=>sum+call.costUsd,0),error:error instanceof Error?error.message:String(error)};
  }
  const ratio=durationRatio(outputMs,targetMinutes);
  return {pipeline:'semantic-v3',case:testCase.id,scenes,wallSec:(Date.now()-started)/1000,outputSec:outputMs/1000,ratio,durationPass:durationPasses(ratio),calls:model.calls.length,costUsd:model.calls.reduce((sum,call)=>sum+call.costUsd,0)};
}

async function runV2(testCase:FrontendCase,targetMinutes:number):Promise<FrontendRun>{
  const model=createJsonModel({env:process.env,maxCostUsd:Number(process.env.V2_JOB_BUDGET_USD??0.6)});
  const started=Date.now();let scenes=0,outputMs=0;
  try{
    for await(const result of generateV2({prompt:testCase.prompt,sourceText:testCase.text,sourceId:`compare-${testCase.id}`,maxScenes:Math.max(1,Math.round(targetMinutes*2)),allowedArchetypes:V2_ARCHETYPES,language:'en',targetMinutes,groundingPolicy:'source-only'},model,{})){scenes++;outputMs+=result.compiled.durationMs;}
  }catch(error){
    return {pipeline:'semantic',case:testCase.id,scenes,wallSec:(Date.now()-started)/1000,outputSec:outputMs/1000,ratio:durationRatio(outputMs,targetMinutes),durationPass:false,calls:model.calls.length,costUsd:model.calls.reduce((sum,call)=>sum+call.costUsd,0),error:error instanceof Error?error.message:String(error)};
  }
  const ratio=durationRatio(outputMs,targetMinutes);
  return {pipeline:'semantic',case:testCase.id,scenes,wallSec:(Date.now()-started)/1000,outputSec:outputMs/1000,ratio,durationPass:durationPasses(ratio),calls:model.calls.length,costUsd:model.calls.reduce((sum,call)=>sum+call.costUsd,0)};
}

const fmt=(value:number,digits=2)=>value.toFixed(digits);
export function renderMarkdown(runs:FrontendRun[],targetMinutes:number):string{
  const header=`# Front-end comparison — ${targetMinutes}-minute target\n\n| pipeline | case | scenes | wall s | output s | ratio | gate | calls | cost $ | error |\n|---|---|---|---|---|---|---|---|---|---|`;
  const rows=runs.map(run=>`| ${run.pipeline} | ${run.case} | ${run.scenes} | ${fmt(run.wallSec,1)} | ${fmt(run.outputSec,1)} | ${fmt(run.ratio)} | ${run.error?'FAIL':run.durationPass?'PASS':'MISS'} | ${run.calls} | ${fmt(run.costUsd,4)} | ${run.error?run.error.slice(0,60):''} |`);
  return `${header}\n${rows.join('\n')}\n`;
}

async function main(){
  if(!process.env.OPENROUTER_API_KEY)throw new Error('OPENROUTER_API_KEY required for the front-end comparison');
  const args=process.argv.slice(2);
  const targetMinutes=Number(args.find(arg=>arg.startsWith('--minutes='))?.split('=')[1]??1);
  const outIndex=args.indexOf('--out');
  const out=outIndex>=0?args[outIndex+1]:undefined;
  const only=args.find(arg=>arg.startsWith('--case='))?.split('=')[1];
  const cases=only?DEFAULT_CASES.filter(testCase=>testCase.id===only):DEFAULT_CASES;
  const runs:FrontendRun[]=[];
  for(const testCase of cases){
    runs.push(await runV3(testCase,targetMinutes));
    runs.push(await runV2(testCase,targetMinutes));
  }
  console.log(renderMarkdown(runs,targetMinutes));
  console.log(`v3 duration-gate passes: ${runs.filter(run=>run.pipeline==='semantic-v3'&&run.durationPass).length}/${runs.filter(run=>run.pipeline==='semantic-v3').length}`);
  console.log(`V2 duration-gate passes: ${runs.filter(run=>run.pipeline==='semantic'&&run.durationPass).length}/${runs.filter(run=>run.pipeline==='semantic').length}`);
  if(out){
    await mkdir(dirname(out),{recursive:true});
    await writeFile(out,JSON.stringify({targetMinutes,generatedAt:new Date().toISOString(),runs},null,2));
    await writeFile(out.replace(/\.json$/,'.md'),renderMarkdown(runs,targetMinutes));
    console.log(`wrote ${out}`);
  }
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await main();
