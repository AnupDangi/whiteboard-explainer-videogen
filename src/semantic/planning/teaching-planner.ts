import {teachingIntentSchema} from '../identity/runtime-schemas.js';
import {teachingIntentToPlan} from '../identity/intent-adapter.js';
import {teachingPlanSchema} from '../schemas.js';
import {validateTeachingPlan} from './validate.js';
import {log} from '../../shared/logger.js';
import {MAX_SCENES_PER_LESSON,countWords,wordsForMinutes} from '../../shared/language.js';
import {evidenceSupported,snapQuoteToSource,evidenceIdGrounding} from './knowledge-compiler.js';
import {teachingPrompt} from './prompt-builder.js';
import {archetypeFits} from '../compiler/archetypes.js';
import type {TeachingPlanV2,VisualArchetype} from '../types.js';
import type {JsonModel} from './model-adapter.js';
import type {SourceFigure} from '../../shared/types.js';
import type {ConceptGraph} from '../harness/contracts.js';
export interface TeachingInput {prompt:string;sourceText?:string;sourceId?:string;evidenceScope?:string;sourceFigures?:SourceFigure[];maxScenes?:number;allowedArchetypes:VisualArchetype[];language?:string;targetMinutes?:number;groundingPolicy?:'source-only'|'source-plus-verified'}
/** Deterministic cognitive-load heal: a beat that introduces more than three
 *  concepts overflows into later beats that still have room, preserving order
 *  and every concept. Runs before validation so a load violation is repaired
 *  mechanically instead of failing (or paying for) a model retry. */
export function spreadExcessIntroductions(value:unknown):void{
 const scenes=(value as {scenes?:{beats?:{introduce?:string[]}[]}[]})?.scenes;
 if(!Array.isArray(scenes))return;
 const MAX=3;
 for(const scene of scenes){
  if(!Array.isArray(scene?.beats))continue;
  let carry:string[]=[];
  for(const beat of scene.beats){
   if(!Array.isArray(beat.introduce))beat.introduce=[];
   beat.introduce=[...carry,...beat.introduce];
   carry=beat.introduce.length>MAX?beat.introduce.splice(MAX):[];
  }
  /** No later beat had room: the overflow stays with the last beat so the
   *  validator still reports the real load problem instead of losing concepts. */
  if(carry.length&&scene.beats.length)scene.beats[scene.beats.length-1].introduce!.push(...carry);
 }
}
/** Deterministic state-mechanism heal: a mechanism marked requiresStateChange
 *  must transform one of its concepts on screen. If the model forgot, inject
 *  neutral→activated into the beat that teaches one of those concepts
 *  (recorded), instead of failing the whole plan. */
/** Rename a model-invented evidence id everywhere it appears in the plan. */
function renamePlanEvidenceId(plan:{evidenceRefs:{id:string;quote?:string}[];scenes?:{beats?:{evidenceRefs?:string[]}[]}[]},from:string,to:string):void{
 for(const entry of plan.evidenceRefs??[])if(entry.id===from)entry.id=to;
 for(const scene of plan.scenes??[])for(const beat of scene.beats??[])beat.evidenceRefs=(beat.evidenceRefs??[]).map(id=>id===from?to:id);
}
export function healStateMechanisms(value:unknown):void{
 const plan=value as {requiredMechanisms?:{id:string;requiresStateChange?:boolean;conceptKeys?:string[]}[];scenes?:{beats?:{introduce?:string[];reinforce?:string[];transform?:{conceptKey:string;fromState?:string;toState:string}[]}[]}[]};
 if(!plan?.requiredMechanisms||!Array.isArray(plan.scenes))return;
 const transformed=new Set<string>();
 for(const scene of plan.scenes)for(const beat of scene.beats??[])for(const t of beat.transform??[])transformed.add(t.conceptKey);
 for(const mechanism of plan.requiredMechanisms){
  if(!mechanism.requiresStateChange)continue;
  if((mechanism.conceptKeys??[]).some(key=>transformed.has(key)))continue;
  for(const scene of plan.scenes){
   for(const beat of scene.beats??[]){
    const target=(mechanism.conceptKeys??[]).find(key=>beat.introduce?.includes(key)||beat.reinforce?.includes(key));
    if(!target)continue;
    beat.transform=beat.transform??[];
    beat.transform.push({conceptKey:target,fromState:'neutral',toState:'activated'});
    log('v2.plan.state-heal',{mechanism:mechanism.id,concept:target});
    transformed.add(target);
    break;
   }
   if((mechanism.conceptKeys??[]).some(key=>transformed.has(key)))break;
  }
 }
}
export async function planTeaching(input:TeachingInput,model:JsonModel,options:{repairFindings?:string[];conceptGraph?:ConceptGraph;chapter?:{index:number;count:number;priorConcepts:string[];maxScenes:number};signal?:AbortSignal}={}):Promise<TeachingPlanV2>{
 if(!input.prompt.trim()||input.prompt.length>4000||(input.sourceText?.length??0)>120000)throw new Error('V2 prompt/source bounds exceeded');
 const maxScenes=options.chapter?.maxScenes??input.maxScenes??1;if(!Number.isInteger(maxScenes)||maxScenes<1||maxScenes>MAX_SCENES_PER_LESSON)throw new Error(`V2 scene limit must be 1-${MAX_SCENES_PER_LESSON}`);
 const graph=options.conceptGraph;
 const knowledge=graph?{keys:graph.concepts.map(c=>c.id),terminology:Object.entries(graph.terminology).map(([key,term])=>`${key}: ${term.definition}`),requirements:[...graph.claims.map(c=>c.id),...graph.mechanisms.map(m=>m.id)],evidence:[...graph.evidence.map(e=>e.id),...graph.sourceVisuals.map(v=>v.id)]}:undefined;
 const chapter=options.chapter?`This is chapter ${options.chapter.index} of ${options.chapter.count} of one longer lesson. Plan scenes for this chapter only, on one shared mental model. Prefix every scene id with ch${options.chapter.index}_. These concepts are already established in earlier chapters and may be reused as continuity: ${options.chapter.priorConcepts.join(', ')||'none'}. Keep canonical identity, terminology and representation vocabulary stable with those earlier scenes.`:'';
   /** evidenceScope is validation-only (the full source); sending it to the
  *  model burned ~30k prompt tokens per teaching call. The model quotes from
  *  its chapter window; the verbatim gate still checks against the full scope. */
 const modelInput={...input,evidenceScope:undefined};
 const attempt=(repairNotes?:string[])=>model.generate('teaching',teachingPrompt({maxScenes,hasSource:Boolean(input.sourceText),language:input.language,targetMinutes:input.targetMinutes,repairNotes,knowledge,chapter}),modelInput,teachingIntentSchema,value=>{
   spreadExcessIntroductions(value);healStateMechanisms(value);
   const intent=value as {evidenceRefs?:{id:string;sourceId?:string;quote?:string}[];scenes?:{key:string;beats?:{key?:string;evidenceRefs?:string[]}[]}[]};
   /** Thin-teaching boundary: the model references COMPILED evidence ids; it
    *  does not author quotes. Strip model-authored quote/sourceId fields now -
    *  the plan's evidence entries are rebuilt from the compiled inventory. */
   if(intent.evidenceRefs)intent.evidenceRefs=intent.evidenceRefs.map(e=>({id:e.id}));
   /** Beats referencing evidence the plan itself never declared are dropped
    *  (recorded) - an undeclared reference cannot be verified. */
   const declaredEvidence=new Set((intent.evidenceRefs??[]).map(e=>e.id));
   for(const scene of intent.scenes??[])for(const beat of scene.beats??[]){
    const before=(beat.evidenceRefs??[]).length;
    if(beat.evidenceRefs)beat.evidenceRefs=beat.evidenceRefs.filter(id=>declaredEvidence.has(id));
    if(before>(beat.evidenceRefs??[]).length)log('v2.plan.evidence-ref-heal',{scene:scene.key,beat:beat.key,dropped:before-(beat.evidenceRefs??[]).length},'warn');
   }
   const planDraft=teachingIntentToPlan(value);
   if(input.sourceText&&options.conceptGraph){
    /** Thin-teaching: evidence entries are REBUILT from the compiled inventory
     *  by id before plan validation (the schema requires sourceId+quote, which
     *  the compiled entries carry). Model-invented ids are dropped (recorded). */
    const compiled=new Map<string,{id:string;sourceId?:string;quote:string}>();
    for(const e of options.conceptGraph.evidence)compiled.set(e.id,{id:e.id,sourceId:e.sourceId??'source',quote:e.quote});
    for(const v of options.conceptGraph.sourceVisuals)compiled.set(v.id,{id:v.id,sourceId:v.sourceId,quote:v.caption??''});
    const requirements=new Set([...options.conceptGraph.claims,...options.conceptGraph.mechanisms].map(r=>r.id));
    const declaredIds=new Set(intent.evidenceRefs?.map(e=>e.id)??[]);
    planDraft.evidenceRefs=(planDraft.evidenceRefs??[]).filter(e=>compiled.has(e.id)).map(e=>{
     const compiledEntry=compiled.get(e.id);
     return compiledEntry?{id:compiledEntry.id,sourceId:compiledEntry.sourceId??'source',quote:compiledEntry.quote}:e as {id:string;sourceId:string;quote:string};
    });
    const grounded=new Set(planDraft.evidenceRefs.map(e=>e.id));
    for(const scene of planDraft.scenes)for(const beat of scene.beats)beat.evidenceRefs=(beat.evidenceRefs??[]).filter(id=>grounded.has(id));
    for(const concept of planDraft.conceptRegistry)concept.evidenceRefs=(concept.evidenceRefs??[]).filter(id=>grounded.has(id));
    for(const requirement of [...planDraft.requiredClaims,...planDraft.requiredMechanisms])requirement.evidenceRefs=(requirement.evidenceRefs??[]).filter(id=>grounded.has(id));
    /** Requirements outside the compiled inventory (invented claims/mechanisms)
     *  are dropped (recorded); beats reference kept requirements only. */
    const beforeReq=planDraft.requiredClaims.length+planDraft.requiredMechanisms.length;
    planDraft.requiredClaims=planDraft.requiredClaims.filter(r=>requirements.has(r.id));
    planDraft.requiredMechanisms=planDraft.requiredMechanisms.filter(r=>requirements.has(r.id));
    const keptRequirements=new Set([...planDraft.requiredClaims,...planDraft.requiredMechanisms].map(r=>r.id));
    for(const scene of planDraft.scenes)for(const beat of scene.beats){
     beat.requirementIds=(beat.requirementIds??[]).filter(id=>keptRequirements.has(id));
    }
    if(beforeReq>planDraft.requiredClaims.length+planDraft.requiredMechanisms.length)log('v2.plan.requirement-heal',{dropped:beforeReq-(planDraft.requiredClaims.length+planDraft.requiredMechanisms.length)},'warn');
   }
   const {plan}=validateTeachingPlan(planDraft,new Set(options.chapter?.priorConcepts??[]));if(plan.scenes.length>maxScenes)throw new Error('Too many scenes');
  for(const s of plan.scenes){
   /** The archetype list is harness-owned: the job constrains it, so a scene
    *  naming unavailable families is clamped to the allowed ones (recorded). */
   const clamped=s.candidateArchetypes.filter(a=>input.allowedArchetypes.includes(a));
   if(!clamped.length){log('v2.plan.archetype-heal',{scene:s.id,dropped:s.candidateArchetypes,to:[input.allowedArchetypes[0]]},'warn');s.candidateArchetypes=[input.allowedArchetypes[0] as VisualArchetype];}
   else if(clamped.length<s.candidateArchetypes.length){log('v2.plan.archetype-heal',{scene:s.id,dropped:s.candidateArchetypes.filter(a=>!input.allowedArchetypes.includes(a))},'warn');s.candidateArchetypes=clamped as VisualArchetype[];}
  }
  for(const s of plan.scenes){
   const fits=s.candidateArchetypes.some(a=>archetypeFits(a,s.requiredConceptIds.length));
   if(!fits)throw new Error(`Scene ${s.id} requires ${s.requiredConceptIds.length} primary concepts, which no candidate archetype (${s.candidateArchetypes.join('/')}) can represent; merge or split concepts`);
  }
  if(input.sourceText){
   /** Thin-teaching: evidence comes from the compiled inventory by id. A
    *  model-invented id is accepted only if its quote (stripped above) matched
    *  nothing - the graph holds the verified quotes. */
   const compiled=new Map<string,{id:string;sourceId?:string;quote:string}>();
   for(const e of options.conceptGraph?.evidence??[])compiled.set(e.id,{id:e.id,sourceId:e.sourceId??'source',quote:e.quote});
   for(const v of options.conceptGraph?.sourceVisuals??[])compiled.set(v.id,{id:v.id,sourceId:v.sourceId,quote:v.caption??''});
   const declaredIds=new Set(intent.evidenceRefs?.map(e=>e.id)??[]);
   const rebuilt:TeachingPlanV2['evidenceRefs']=[];
   for(const e of plan.evidenceRefs){
    const compiledEntry=compiled.get(e.id) as {id:string;sourceId?:string;quote:string}|undefined;
    if(!compiledEntry){log('v2.plan.evidence-drop',{id:e.id},'warn');continue;}
    rebuilt.push({id:compiledEntry.id,sourceId:compiledEntry.sourceId??input.sourceId??'source',quote:compiledEntry.quote});
   }
   plan.evidenceRefs=rebuilt;
   if(!plan.evidenceRefs.length)throw new Error('Source-grounded plan requires evidence: reference the compiled evidence ids listed in the prompt');
  }else if(plan.evidenceRefs.length)throw new Error('Prompt-only plan cannot invent evidence');
  if(graph){
   const keys=new Set(graph.concepts.map(c=>c.id)),evidenceIds=new Set([...graph.evidence.map(e=>e.id),...graph.sourceVisuals.map(v=>v.id)]),requirements=new Set([...graph.claims.map(c=>c.id),...graph.mechanisms.map(m=>m.id)]);
   /** The model invents evidence ids (ev_tree_structure) with quotes that may
    *  still be verbatim in the source. Ground it: rename to the compiled
    *  inventory entry whose quote matches, or drop the entry and its beat
    *  references (recorded) - an id outside the compiled inventory was never
    *  verified by the knowledge compiler. */
   const groundings=evidenceIdGrounding(plan,graph,evidenceIds);
   for(const rename of groundings.renames){
    renamePlanEvidenceId(plan,rename.from,rename.to);log('v2.plan.evidence-rename',{from:rename.from,to:rename.to},'warn');
   }
   if(groundings.dropped.length)log('v2.plan.evidence-drop',{ids:groundings.dropped},'warn');
   /** Compiled inventory ids OR plan entries whose quote was verified verbatim
    *  in the scope (the source-only policy grounds quotes, not ids). */
   const planEvidenceIds=new Set(plan.evidenceRefs.map(e=>e.id));
   for(const scene of plan.scenes)for(const beat of scene.beats)beat.evidenceRefs=(beat.evidenceRefs??[]).filter(id=>evidenceIds.has(id)||planEvidenceIds.has(id));
   for(const c of plan.conceptRegistry)if(!keys.has(c.id))throw new Error(`Concept outside knowledge inventory: ${c.id}`);
   for(const e of plan.evidenceRefs)if(!evidenceIds.has(e.id)&&!planEvidenceIds.has(e.id))throw new Error(`Evidence outside knowledge inventory: ${e.id}`);
   for(const scene of plan.scenes)for(const conceptId of scene.requiredConceptIds)if(!keys.has(conceptId))throw new Error(`Required concept outside knowledge inventory: ${conceptId}`);
   for(const requirement of [...plan.requiredClaims,...plan.requiredMechanisms])if(!requirements.has(requirement.id))throw new Error(`Requirement outside knowledge inventory: ${requirement.id}`);
  }
  return plan;
 },{signal:options.signal}) as Promise<TeachingPlanV2>;
 /** Length refinement. The prompt states the word budget outright, but the model
  *  does not reliably hit it: measured at 149 words against a 145 target on one
  *  run and 65 against 108 on another, i.e. a 40s lesson for a sixty-second
  *  request. This is the one targeted repair the teaching stage is allowed; it
  *  re-states the measured total and the direction to move. */
 let plan=await attempt(options.repairFindings);
 if(input.targetMinutes){
  /** A chaptered source is planned one chapter at a time, so each chapter must
   *  target its SHARE of the lesson. Comparing every chapter against the whole
   *  budget let two chapters each come in at ~108 words for a one-minute lesson
   *  and total 213 - the lesson ran 95.5s against a 60s request and the
   *  refinement never fired, because each chapter individually looked correct. */
  const chapters=Math.max(1,options.chapter?.count??1);
  const budget=Math.max(1,Math.round(wordsForMinutes(input.targetMinutes)/chapters));
  const actual=plan.scenes.reduce((total,scene)=>total+scene.beats.reduce((n,beat)=>n+countWords(beat.narrationDraft),0),0);
  if(actual<budget*.85||actual>budget*1.15){
   const note=`Your narration totalled ${actual} words. This is a ${input.targetMinutes}-minute lesson and needs about ${budget} words (${actual<budget?'add depth: explain the mechanism and give a worked example':'trim repetition and shorten explanations'}). Keep every required concept, relation and requirement covered.`;
   log('v2.teaching.length-repair',{scenes:plan.scenes.length,actual,budget,chapters,targetMinutes:input.targetMinutes},'warn');
   plan=await attempt([...(options.repairFindings??[]),note]);
  }
 }
 return plan;
}
