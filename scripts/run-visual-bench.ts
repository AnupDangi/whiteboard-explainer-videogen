/** P6 visual bench runner (harness §§59-62): run the eval cases through the planner
 *  (mock by default; --live for real generations with cost), measure Level A/B
 *  deterministically, log `eval.*` to the ledger, and write a report under
 *  output/evaluations/. Level C (VLM judge) and Level D (human pairwise) run on the
 *  saved contact sheets afterwards. */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {generateChapters} from '../src/planner.js';
import {validatePlan,compileScene,renderSVG,preflightScene} from '../src/engine.js';
import {staticIntervalMs,connectorThroughNode} from '../src/progression.js';
import {renderTemplate} from '../src/templates.js';
import {log} from '../src/logger.js';

interface BenchCase { id:string; prompt:string; category:string; mustExplain:string[]; preferredTemplates?:string[]; forbiddenPatterns?:string[]; expectedKinds?:string[] }
const live=process.argv.includes('--live');
const casesDir='eval/visual-bench/cases';
const caseFiles=(await readdir(casesDir)).filter(f=>f.endsWith('.json'));
const cases:BenchCase[]=[];
for(const f of caseFileList(casesDir,caseFiles))cases.push(JSON.parse(await readFile(f,'utf8')));
function caseFileList(dir:string,files:string[]){return caseFiles.map(f=>join(dir,f));}
const env=process.env;
if(live&&!env.OPENROUTER_API_KEY)throw new Error('OPENROUTER_API_KEY required for --live');
const source={kind:'text' as const,label:'bench',text:'',sha256:'bench'};
await mkdir('output/evaluations/visual-bench',{recursive:true});
const report:Array<Record<string,unknown>>=[];
for(const testCase of cases){
  log('eval.case-started',{case:testCase.id,live});
  const started=Date.now();
  let scenes:Array<Record<string,unknown>>=[];let usage:Record<string,unknown>|null=null;let error:string|null=null;
  try{
    if(live){
      for await(const plan of generateChapters({kind:'text',label:testCase.id,text:testCase.prompt,sha256:testCase.id},{durationMinutes:1,maxCostUsd:0.5,onUsage:u=>{usage=u as unknown as Record<string,unknown>;}})){
        plan.title=validatePlan(plan).title;
        for(const scene of plan.scenes){
          const compiled=preflightScene(compileScene(scene));
          const dir=join('output/evaluations/visual-bench',testCase.id);
          await mkdir(dir,{recursive:true});
          await writeFile(join(dir,`${scene.id}.svg`),renderSVG(compiled,compiled.durationMs));
          scenes.push({id:scene.id,nodes:scene.nodes.map(n=>({label:n.label,kind:n.kind,shape:n.shape,visualIntent:n.visualIntent})),template:scene.template??null,staticIntervalMs:Math.round(staticIntervalMs(compiled)),connectorHits:connectorThroughNode(compiled).length,narration:scene.narration});
        }
      }
    }else{
      // Mock mode exercises the same validators/deterministic layers with fixtures.
      const {fixtures}=await import('../src/fixtures.js');
      for(const [name,fixture] of Object.entries(fixtures)){
        const plan=validatePlan(fixture);
        for(const raw of plan.scenes){
          const compiled=compileScene(raw);
          scenes.push({id:`${name}-${raw.id}`,template:raw.template??null,staticIntervalMs:Math.round(staticIntervalMs(compiled)),connectorHits:connectorThroughNode(compiled).length,nodes:raw.nodes.map(n=>({label:n.label,kind:n.kind,shape:n.shape}))});
        }
      }
    }
  }catch(e){error=e instanceof Error?e.message:String(e);log('eval.case-failed',{case:testCase.id,error},'error');}
  const narrationText=(scenes as Array<{narration?:string}>).map(s=>s.narration||'').join(' ').toLowerCase();
  const semanticHits=testCase.mustExplain.filter(m=>{const words=m.toLowerCase().split(/\s+/);return words.every(w=>narrationText.includes(w));});
  const templateHit=testCase.preferredTemplates?.length?(scenes as Array<{template?:string}>).some(s=>testCase.preferredTemplates!.includes(s.template||'')):null;
  const lintOver3500=scenes.filter(s=>(s as {staticIntervalMs:number}).staticIntervalMs>3500).length;
  const record={case:testCase.id,category:testCase.category,live,error,mustExplain:`${semanticHits.length}/${testCase.mustExplain.length}`,templateHit,staticIntervalViolations:lintOver3500,scenes:scenes.length,elapsedMs:Date.now()-started,usage:live?usage:null};
  report.push(record);
  log('eval.case-result',record);
}
await writeFile('output/evaluations/visual-bench/report.json',JSON.stringify({generatedAt:new Date().toISOString(),live,results:report},null,2)+'\n');
const semanticTotal=report.reduce((n:number,r:Record<string,unknown>)=>n+Number(String(r.mustExplain).split('/')[0]),0);
const semanticAll=report.reduce((n:number,r:Record<string,unknown>)=>n+Number(String(r.mustExplain).split('/')[1]),0);
console.log(JSON.stringify({cases:report.length,live,semanticCoverage:`${semanticTotal}/${semanticAll}`,over3500:report.reduce((n:number,r:Record<string,unknown>)=>n+Number(r.staticIntervalViolations||0),0)}));
