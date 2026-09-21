import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {autoDirect} from '../src/planning/auto-director.js';
import {compileScene,durationOf,estimateTiming,validatePlan} from '../src/generation/engine.js';
import {scaleTimingToDuration} from '../src/generation/tts-runtime.js';
import {createSourceIR} from '../src/ingest/source-ir.js';
import {planTeachingArchitecture,expandTeachingArchitectureNarration,lowerTeachingArchitectureToPlan,type CoverageSpec} from '../src/planning/teaching-planner.js';
import {stableId,type LessonRequest,type SourceIR} from '../src/types/contracts.js';

/** Deterministic pre-release corpus. It exercises the same canonical planner,
 * concept ordering, visual director and exact-duration clock used by offline
 * jobs, without pretending that provider calls or human review happened. */
const TOPICS=[
  ['ghosts','Why a ghost experience can feel real','Sleep paralysis combines vivid imagery with temporary immobility; confirmation bias can reinforce a supernatural interpretation.'],
  ['spirituality','How compassion builds trust in spiritual leadership','Healthy leadership explains reasons, welcomes questions, respects consent and accepts accountability.'],
  ['dark-web','How people get pulled into dark-web scams','Sensational lures and phishing can lead to credential reuse, account takeover and fraud; defensive habits reduce risk.'],
  ['navier-stokes','What Navier–Stokes balances','A fluid parcel changes velocity under pressure gradients, viscous diffusion and body forces such as gravity.'],
  ['biology','How vaccines train immune memory','An antigen gives the immune system a safe pattern to recognize, producing memory cells for a later response.'],
  ['neuroscience','How attention selects a signal','Attention amplifies task-relevant features while filtering competing signals, using limited cognitive capacity.'],
  ['climate','Why greenhouse gases warm a planet','Molecules absorb and re-emit infrared energy, changing the balance between incoming sunlight and outgoing heat.'],
  ['astronomy','How a star stays in balance','Gravity compresses a star while pressure from hot plasma pushes outward; fusion supplies energy that maintains the balance.'],
  ['electricity','How a circuit moves charge','A voltage difference creates an electric field, and resistance limits the current that flows through a conductive path.'],
  ['probability','Why conditional probability changes the question','The condition narrows the sample space, so the denominator changes before the new probability is calculated.'],
  ['statistics','What a confidence interval means','A confidence procedure describes the long-run behavior of an interval-producing method, not the probability that one fixed parameter moves.'],
  ['algorithms','How binary search saves work','A sorted range can be cut in half after each comparison, reducing the remaining search from linear to logarithmic scale.'],
  ['software-architecture','How a gateway keeps model calls accountable','A common gateway records provider, model, latency, tokens, cost, retries and budget reservations around each operation.'],
  ['cybersecurity','How multi-factor authentication blocks takeover','A stolen password is not enough when a second independent factor is required to complete the login.'],
  ['leadership','How feedback improves a team','Specific observations, a shared goal and a safe response loop turn feedback into a learning signal instead of a personal attack.'],
  ['history','How a primary source differs from a later interpretation','A primary source is evidence from the period; an interpretation explains it later and must expose its assumptions.'],
  ['economics','How supply and demand meet','A market price coordinates quantities offered and requested, while shifts move the equilibrium rather than merely moving along a curve.'],
  ['research-methods','How an experiment supports a causal claim','Random assignment, a defined intervention and a measured outcome separate causal evidence from a simple correlation.'],
  ['machine-learning','How a loss function trains a model','The loss measures error, and gradient descent changes parameters in a direction that reduces that error on the chosen data.'],
  ['philosophy','How a thought experiment tests an assumption','A thought experiment changes one premise while holding others steady, making a hidden assumption easier to examine.'],
] as const;
const LEVELS=['beginner','student','advanced','researcher','topic-focused','adult-learner'] as const;
const DURATIONS=[1,5,10] as const;
const RENDER_TAIL_MS=650;
const target=(total:number,count:number,index:number)=>{
  const budget=Math.max(count,total-count*RENDER_TAIL_MS),base=Math.floor(budget/count);
  return base+(index<budget%count?1:0);
};
const sourceFor=(id:string,title:string,text:string):SourceIR=>createSourceIR({id:stableId('src',id),sha256:stableId('sha',text),kind:'text',title},text,undefined,{label:title});
const percentile=(values:number[],p:number)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]??0;};

const results:Array<Record<string,unknown>>=[];
const failures:string[]=[];
for(const [topic,title,text] of TOPICS){
  for(const level of LEVELS){
    for(const duration of DURATIONS){
      const id=`${topic}-${level}-${duration}`;
      const started=performance.now();
      try{
        const sourceConcept=text.split(/[,.!?]/)[0].trim().split(/\s+/).slice(0,4).join(' ');
        const sourceWords=text.replace(/[,.!?]/g,'').split(/\s+/).filter(Boolean);
        const mechanismConcept=sourceWords.slice(4,8).join(' ')||sourceConcept;
        const interpretationConcept=sourceWords.slice(-4).join(' ')||sourceConcept;
        const requirements:CoverageSpec[]=[
          {concept:sourceConcept,treatment:'explain',required:true,spokenText:`First build an intuition for ${sourceConcept.toLowerCase()}.`,displayText:sourceConcept,visualIntent:'Show the central idea before formal notation.'},
          {concept:mechanismConcept,treatment:'demonstrate',required:true,spokenText:`Now follow ${mechanismConcept.toLowerCase()} step by step with one concrete example.`,displayText:mechanismConcept,visualIntent:'Show the causal steps in order.'},
          {concept:interpretationConcept,treatment:'compare',required:true,spokenText:`Finally interpret ${interpretationConcept.toLowerCase()} and compare it with the likely misconception.`,displayText:interpretationConcept,visualIntent:'Contrast the correct model with a tempting wrong model.'},
        ];
        const learnerLevel=level==='beginner'?'beginner':level==='advanced'||level==='researcher'?'advanced':'intermediate';
        const request:LessonRequest={version:2,instruction:title,sources:[{kind:'text',title,text}],durationMinutes:duration,language:'en',groundingPolicy:'source-only',learnerContext:{level:learnerLevel,audience:`release corpus ${level} learner`,goals:[sourceConcept,mechanismConcept,interpretationConcept]},stylePreferences:{captionMode:'off',narrationStyle:'teacherly',visualStyle:'clear diagrams'},generationBudget:{maxCostUsd:duration===1?.5:duration===5?.7:1,maxPaidRepairs:0}};
        const source=sourceFor(topic,title,text);
        const plan=expandTeachingArchitectureNarration(planTeachingArchitecture(request,[source],{requirements}));
        const canonical=validatePlan(autoDirect(lowerTeachingArchitectureToPlan(plan),requirements.map(item=>item.concept)));
        const targetAudio=canonical.scenes.map((_,index)=>target(duration*60_000,canonical.scenes.length,index));
        const scenes=canonical.scenes.map((scene,index)=>compileScene(scene,scaleTimingToDuration(estimateTiming(scene.narration,plan.duration.wordsPerMinute),targetAudio[index])));
        const actual=durationOf(scenes),expected=duration*60_000;
        const wallMs=Math.round(performance.now()-started);
        results.push({id,topic,level,durationMinutes:duration,scenes:scenes.length,beats:plan.beats.length,targetMs:expected,actualMs:actual,durationDeltaMs:actual-expected,durationGate:actual===expected,wallMs,stageMs:{planning:wallMs},status:actual===expected?'pass':'fail'});
        if(actual!==expected)failures.push(`${id}: duration ${actual} !== ${expected}`);
      }catch(error){
        failures.push(`${id}: ${error instanceof Error?error.message:String(error)}`);
        results.push({id,topic,level,durationMinutes:duration,status:'fail',error:error instanceof Error?error.message:String(error)});
      }
    }
  }
}
const wall=results.map(result=>Number(result.wallMs)).filter(Number.isFinite);
const report={version:1,createdAt:new Date().toISOString(),liveProvider:false,topics:TOPICS.length,levels:LEVELS.length,durations:DURATIONS.length,totalCases:results.length,passed:results.filter(result=>result.status==='pass').length,failed:failures.length,failures,p95WallMs:percentile(wall,.95),p99WallMs:percentile(wall,.99),maxWallMs:Math.max(...wall,0),results};
await mkdir('output/evaluations',{recursive:true});
await writeFile(resolve('output/evaluations/release-corpus.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({version:report.version,createdAt:report.createdAt,liveProvider:report.liveProvider,totalCases:report.totalCases,passed:report.passed,failed:report.failed,p95WallMs:report.p95WallMs,p99WallMs:report.p99WallMs,maxWallMs:report.maxWallMs,output:'output/evaluations/release-corpus.json'},null,2));
if(failures.length)process.exitCode=1;
