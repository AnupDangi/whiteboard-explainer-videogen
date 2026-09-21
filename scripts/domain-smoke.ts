import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {compileScene,durationOf,estimateTiming,renderSVG,validatePlan} from '../src/generation/engine.js';
import {scaleTimingToDuration} from '../src/generation/tts-runtime.js';
import {autoDirect} from '../src/planning/auto-director.js';
import {expandTeachingArchitectureNarration,planTeachingArchitecture,lowerTeachingPlan,lowerTeachingArchitectureToPlan,type CoverageSpec} from '../src/planning/teaching-planner.js';
import {createSourceIR} from '../src/ingest/source-ir.js';
import {stableId,type LessonRequest, type SourceIR} from '../src/types/contracts.js';

/**
 * Offline release smoke corpus for subjects that are easy to teach badly. These
 * cases deliberately avoid operational instructions: the online-safety lesson
 * explains phishing/credential reuse and defensive habits, never how to access
 * hidden services or evade law enforcement.
 */
const CASES=[
  {
    id:'ghost-experiences',
    title:'Why a ghost experience can feel real',
    text:'Ghost stories are cultural narratives about unexplained experiences. Sleep paralysis can combine vivid dream imagery with temporary inability to move. Confirmation bias makes people notice details that fit a prior belief while overlooking ordinary explanations. A careful teacher separates the felt experience from the claim that a supernatural cause has been proven.',
    requirements:[
      {concept:'felt experience',treatment:'explain',required:true,spokenText:'First separate the felt experience from the explanation we attach to it.',displayText:'Felt experience',visualIntent:'Show an observation before its interpretation.'},
      {concept:'sleep paralysis',treatment:'demonstrate',required:true,prerequisites:['felt experience'],spokenText:'Now consider sleep paralysis: vivid imagery can arrive while the body is temporarily unable to move.',displayText:'Sleep paralysis',visualIntent:'Show dream imagery beside a still body.'},
      {concept:'confirmation bias',treatment:'compare',required:true,prerequisites:['felt experience'],spokenText:'Finally, compare two explanations and notice how confirmation bias favors evidence that matches a belief.',displayText:'Confirmation bias',visualIntent:'Compare matching evidence with overlooked evidence.'},
    ] as CoverageSpec[],
  },
  {
    id:'spiritual-leadership',
    title:'How spiritual leadership can build trust without blind obedience',
    text:'Spiritual leaders often teach practices such as compassion, attention and service. Trust grows when a leader explains reasons, welcomes questions, respects consent and accepts accountability. A healthy community distinguishes a practice that can be examined from a demand for unquestioned obedience. The learner should compare service-oriented guidance with coercive control.',
    requirements:[
      {concept:'compassionate practice',treatment:'explain',required:true,spokenText:'Begin with the practice itself: compassion means reducing harm while paying attention to another person.',displayText:'Compassionate practice',visualIntent:'Show attention leading to a caring action.'},
      {concept:'accountability',treatment:'demonstrate',required:true,prerequisites:['compassionate practice'],spokenText:'Trust becomes healthy when a leader gives reasons, welcomes questions and accepts accountability.',displayText:'Accountability',visualIntent:'Show reasons, questions and a feedback loop.'},
      {concept:'blind obedience',treatment:'compare',required:true,prerequisites:['accountability'],spokenText:'Compare accountable guidance with blind obedience: one preserves agency, the other suppresses questions.',displayText:'Agency versus obedience',visualIntent:'Show two contrasting paths with learner agency visible.'},
    ] as CoverageSpec[],
  },
  {
    id:'dark-web-safety',
    title:'How people are pulled into dark-web scams—and how to stay safe',
    text:'People can encounter dark-web stories through sensational posts, phishing messages or promises of easy money. A common harm chain is reused credentials leading to account takeover, followed by extortion or fraud. Defensive teaching focuses on curiosity without risky exploration: use unique passwords, multi-factor authentication, verified sources, legal reporting channels and trusted support. Do not access illegal services or share personal data.',
    requirements:[
      {concept:'sensational lure',treatment:'explain',required:true,spokenText:'Start with the lure: sensational stories and promises of easy money exploit curiosity.',displayText:'Sensational lure',visualIntent:'Show a tempting message with warning signals.'},
      {concept:'credential reuse',treatment:'demonstrate',required:true,prerequisites:['sensational lure'],spokenText:'Then follow the harm chain: reused credentials can turn one exposed password into account takeover.',displayText:'Credential reuse',visualIntent:'Show one leaked key opening multiple accounts.'},
      {concept:'defensive habits',treatment:'compare',required:true,prerequisites:['credential reuse'],spokenText:'The safe response is defensive: unique passwords, multi-factor authentication and trusted reporting—not risky exploration.',displayText:'Defensive habits',visualIntent:'Show protective steps and a clear stop boundary.'},
    ] as CoverageSpec[],
  },
  {
    id:'navier-stokes-intuition',
    title:'What the Navier–Stokes equation is balancing',
    text:'A fluid parcel changes velocity when forces act on it. The Navier–Stokes equation balances acceleration with a pressure gradient, viscous diffusion and body forces such as gravity. Intuition comes first: pressure pushes from crowded regions, viscosity smooths velocity differences, and gravity adds a directional pull. The equation is a bookkeeping statement about those competing effects, not a magic formula to memorize.',
    requirements:[
      {concept:'fluid acceleration',treatment:'explain',required:true,spokenText:'Begin with a fluid parcel: acceleration means its velocity changes as the parcel moves.',displayText:'Fluid acceleration',visualIntent:'Show a highlighted parcel changing velocity along a flow.'},
      {concept:'pressure gradient',treatment:'demonstrate',required:true,prerequisites:['fluid acceleration'],spokenText:'Next, pressure pushes from crowded regions toward less crowded regions, creating a pressure gradient.',displayText:'Pressure gradient',visualIntent:'Show pressure arrows across a pipe with a meaningful direction.'},
      {concept:'viscous diffusion',treatment:'compare',required:true,prerequisites:['fluid acceleration'],spokenText:'Finally, viscosity smooths velocity differences, while body forces such as gravity add their own pull.',displayText:'Viscous diffusion',visualIntent:'Compare a jagged velocity profile with a smoothed profile.'},
    ] as CoverageSpec[],
  },
] as const;

const minutes=[1,5,10] as const;
// The renderer contributes a deterministic 650 ms tail to every scene. Keep
// the structural harness on the same clock as live jobs so its duration gate
// cannot pass a plan that would export short (or overlong) media.
const RENDER_TAIL_MS=650;
const sceneAudioTarget=(totalMs:number,count:number,index:number):number=>{
  if(!Number.isInteger(count)||count<1||index<0||index>=count)throw new Error('Invalid structural scene clock');
  const budget=Math.max(count,totalMs-count*RENDER_TAIL_MS);
  const base=Math.floor(budget/count);
  return base+(index<budget%count?1:0);
};
const sourceFor=(item:typeof CASES[number]):SourceIR=>{
  const identity={id:stableId('src',item.id),sha256:stableId('sha',item.text),kind:'text' as const,title:item.title};
  return createSourceIR(identity,item.text,undefined,{label:item.title});
};
const requestFor=(item:typeof CASES[number],duration:typeof minutes[number]):LessonRequest=>({
  version:2,instruction:item.title,sources:[{kind:'text',title:item.title,text:item.text}],durationMinutes:duration,language:'en',groundingPolicy:'source-only',learnerContext:{level:'beginner',audience:'adult learner',goals:item.requirements.map(requirement=>requirement.concept)},stylePreferences:{captionMode:'off',narrationStyle:'teacherly',visualStyle:'clear diagrams'},generationBudget:{maxCostUsd:duration===1 ? .5 : duration===5 ? .7 : 1,maxPaidRepairs:0},
});

const output=[] as Record<string,unknown>[];
for(const item of CASES){
  const source=sourceFor(item);
  for(const duration of minutes){
    const started=performance.now();
    const basePlan=planTeachingArchitecture(requestFor(item,duration),[source],{requirements:[...item.requirements]});
    const plan=expandTeachingArchitectureNarration(basePlan);
    const plannedMs=performance.now()-started;
    const loweredStarted=performance.now();
    // Keep the compatibility lowering smoke-tested on the compact blueprint; the
    // expanded deterministic path is intentionally lowered directly from beats.
    const lowered=lowerTeachingPlan(basePlan);
    // Exercise the direct canonical-beat lowering as well as the compatibility
    // provenance artifact. Scene workers must be able to consume the committed
    // blueprint without asking a legacy semantic writer to invent a topic.
    const canonicalPlan=lowerTeachingArchitectureToPlan(plan);
    const directed=autoDirect(canonicalPlan,plan.coverage.requirements.map(requirement=>requirement.concept));
    const validated=validatePlan(directed);
    const loweredMs=performance.now()-loweredStarted;
    const compiledStarted=performance.now();
    const targetAudioMs=validated.scenes.map((_,index)=>sceneAudioTarget(duration*60*1000,validated.scenes.length,index));
    const scenes=validated.scenes.map((scene,index)=>{
      const estimated=estimateTiming(scene.narration,plan.duration.wordsPerMinute);
      return compileScene(scene,scaleTimingToDuration(estimated,targetAudioMs[index]));
    });
    const compiledMs=performance.now()-compiledStarted;
    const renderStarted=performance.now();
    const frameBytes=scenes.flatMap(scene=>[0,.5,1].map(ratio=>renderSVG(scene,Math.round(scene.durationMs*ratio)).length));
    const renderedMs=performance.now()-renderStarted;
    const words=plan.beats.reduce((sum,beat)=>sum+beat.spokenText.text.trim().split(/\s+/).filter(Boolean).length,0);
    const estimatedSeconds=durationOf(scenes)/1000;
    const targetMs=duration*60*1000;
    const durationDeltaMs=Math.round(durationOf(scenes)-targetMs);
    output.push({case:item.id,title:item.title,durationMinutes:duration,sourceGrounded:true,plannedScenes:plan.hierarchy.scenes.length,plannedBeats:plan.beats.length,words,notFitting:plan.coverage.notFitting.map(item=>item.requirementId),estimatedRenderedSeconds:estimatedSeconds,durationDeltaMs,durationGate:durationDeltaMs===0,frames:frameBytes.length,frameBytes,targetAudioMs,compiledSceneDurationsMs:scenes.map(scene=>scene.durationMs),stagesMs:{planning:Math.round(plannedMs),lowering:Math.round(loweredMs),compile:Math.round(compiledMs),render:Math.round(renderedMs)},status:'offline-structural-pass',note:'Deterministic planner/renderer smoke with the bounded pedagogy expander; no live LLM, TTS or MP4 export. DurationGate uses the same per-scene audio clock and renderer tail as live jobs.'});
  }
}
await mkdir('output/evaluations',{recursive:true});
const report={version:1,createdAt:new Date().toISOString(),cases:CASES.map(item=>item.id),durations:[...minutes],liveProvider:false,results:output};
await writeFile(resolve('output/evaluations/domain-smoke.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
