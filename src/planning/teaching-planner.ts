import {segmentWords} from '../core/language.js';
import {validatePlan} from '../generation/engine.js';
import {
  assertTeachingBeat,
  stableId,
  type CourseSession,
  type CoveragePlan,
  type CoverageRequirement,
  type CoverageTreatment,
  type DurationMinutes,
  type DurationProfile,
  type EvidenceRef,
  type LessonModule,
  type LessonPlan,
  type LessonRequest,
  type LessonSection,
  type NarrativeArc,
  type PedagogicalRole,
  type ScenePlan,
  type SourceIR,
  type TeachingBeat,
  type TeachingBrief,
  type TextProvenance,
  type VisualMutation,
} from '../types/contracts.js';
import type {Plan,PlanNode,Scene} from '../types/engine.js';
import {resolveKind} from '../visual/kind-resolver.js';
import {hasIcon} from '../domain/icons.js';
import {hasIllustration} from '../domain/illustrations.js';
import {validateTemplateSemantics} from './template-validator.js';
import {DEFAULT_NODE_KIND,DEFAULT_NODE_SHAPE,EQUATION_HINT,ILLUSTRATION_SUPPRESSED_KINDS,TEMPLATE_EDGE_LABEL,TEMPLATE_SUPPORT_KIND,TEMPLATE_FALLBACK_KIND,TEMPLATE_SUPPORT_LABELS,DEFAULT_SUPPORT_LABELS,DEFAULT_EDGE_LABEL,resolveDomainTemplate} from '../domain/registry.js';
import type {LLMGateway} from '../gateway/llm-gateway.js';

/**
 * Phases 5-6 are deliberately deterministic. Model output may populate the draft
 * fields, but time allocation, prerequisite closure, coverage accounting and the
 * compatibility lowering are code-owned operations.
 */

interface DurationCalibration {
  language:string;
  voiceId?:string;
  wordsPerMinute?:number;
  pace?:'slow'|'measured'|'fast';
}

interface CalibratedDurationProfile extends DurationProfile {
  language:string;
  voiceId?:string;
  contentSeconds:number;
  reserveSeconds:number;
  targetWords:number;
  targetScenes:number;
  targetModules:number;
  calibration:'measured-default'|'explicit-voice';
}

export interface CoverageSpec {
  id?:string;
  concept:string;
  treatment?:Exclude<CoverageTreatment,'omit'>;
  required?:boolean;
  prerequisites?:string[];
  evidence?:EvidenceRef[];
  spokenText?:string;
  displayText?:string;
  role?:PedagogicalRole;
  visualIntent?:string;
  visualMutation?:VisualMutation;
}

interface BriefOptions {
  subject?:string;
  objective?:string;
  mustCover?:string[];
  mustAvoid?:string[];
  narrativeAngle?:string;
}

interface LessonHierarchy {
  course:CourseSession;
  modules:LessonModule[];
  lessons:LessonPlan[];
  sections:LessonSection[];
  scenes:ScenePlan[];
  /** Long lessons are expanded module-by-module, never as one giant schema. */
  generation:'eager'|'just-in-time';
}

export interface TeachingArchitecturePlan {
  brief:TeachingBrief;
  duration:CalibratedDurationProfile;
  arc:NarrativeArc;
  coverage:CoveragePlan;
  hierarchy:LessonHierarchy;
  beats:TeachingBeat[];
}

interface CompatibilityLowering {
  plan:Plan;
  evidenceByLegacyId:Record<string,EvidenceRef>;
  textProvenanceByNodeId:Record<string,TextProvenance>;
  /** Includes the lesson title and scene titles as well as node labels. */
  textProvenanceByPath:Record<string,TextProvenance>;
  beatByNodeId:Record<string,string>;
  adaptations:Array<{sceneId:string;kind:'support-node'|'label-shortened';detail:string}>;
}

interface NarrationBudgetAudit {
  targetUnits:number;
  actualUnits:number;
  utilization:number;
  withinReleaseWindow:boolean;
  beats:Array<{beatId:string;targetUnits:number;actualUnits:number;utilization:number}>;
}

interface ModelBeatArtifact {
  version:1;
  planTitle:string;
  sourcePlanVersion:1;
  beats:TeachingBeat[];
  sceneIds:string[];
}

interface ModelBeatDurationAudit {
  targetSeconds:number;
  allocatedSeconds:number;
  spokenWords:number;
  targetWords:number;
  utilization:number;
  withinReleaseWindow:boolean;
}

interface TeachingBeatRealizationOptions {
  gateway:LLMGateway;
  jobId:string;
  model:string;
  budgetLimitUsd:number;
  signal?:AbortSignal;
  /** Source excerpts are supplied by the caller; the model never receives an
   * unbounded document dump or an instruction that can rewrite the contract. */
  sources?:SourceIR[];
}

interface RealizedBeatPayload {
  beatId:string;
  spokenText:string;
  displayText:string;
  visualIntent:string;
}

interface RealizedLessonPayload {version:1;beats:RealizedBeatPayload[]}

const REALIZATION_SCHEMA={
  type:'object',additionalProperties:false,required:['version','beats'],properties:{
    version:{type:'integer',const:1},
    beats:{type:'array',items:{type:'object',additionalProperties:false,required:['beatId','spokenText','displayText','visualIntent'],properties:{
      beatId:{type:'string',minLength:1},spokenText:{type:'string',minLength:1},displayText:{type:'string',minLength:1},visualIntent:{type:'string',minLength:1},
    }}},
  },
} as const;

const blockTextForPrompt=(block:SourceIR['blocks'][number]):string=>{
  if('text' in block)return block.text;
  if(block.type==='list')return block.items.join(' ');
  if(block.type==='table')return `${block.caption??''} ${block.columns.join(' ')} ${block.rows.flat().join(' ')}`;
  if(block.type==='figure')return `${block.caption??''} ${block.description??''} ${block.nearbyText.join(' ')}`;
  if(block.type==='metadata')return `${block.key}: ${block.value}`;
  return '';
};

/**
 * Have a model write the words for an already-committed teaching architecture.
 * The model receives stable beat IDs and can only realize those beats; it cannot
 * add scenes, reorder prerequisites, change the objective, or choose a new topic.
 * This is the live counterpart to the deterministic pedagogy expander and keeps
 * TeachingBeat as the semantic writer instead of adapting a newly invented Plan.
 */
export async function realizeTeachingArchitectureNarration(
  architecture:TeachingArchitecturePlan,
  options:TeachingBeatRealizationOptions,
):Promise<TeachingArchitecturePlan>{
  const sourceById=new Map<string,string>();
  for(const source of options.sources??[]){
    for(const block of source.blocks){
      const text=clean(blockTextForPrompt(block),900);
      if(text)sourceById.set(`${source.identity.id}:${block.id}`,text);
    }
  }
  const beatSkeleton=architecture.beats.map(beat=>({
    beatId:beat.id,sceneId:beat.sceneId,role:beat.role,concept:beat.displayText?.text??beat.visualIntent,
    targetDurationMs:beat.targetDurationMs,targetWords:Math.max(1,Math.round(beat.targetDurationMs/60000*architecture.duration.wordsPerMinute)),
    evidence:beat.evidence.map(ref=>({sourceId:ref.sourceId,blockId:ref.blockId,page:ref.page,origin:ref.origin,excerpt:sourceById.get(`${ref.sourceId}:${ref.blockId}`)??''})),
  }));
  const targetWords=architecture.duration.targetWords;
  const system=`You are the narration writer inside a constrained teaching pipeline. Write natural teacher speech for the supplied immutable beat skeleton. The learner is ${architecture.brief.learnerLevel}; use ${architecture.brief.pedagogy.join(', ')}. Start with orientation and why the topic matters, then intuition before formalism, a concrete example, an active prediction, and a recap when those roles exist. Use explicit transitions such as “first understand”, “now consider”, and “this leads us to”. Never invent a scene or concept. Return JSON only.`;
  const prompt=JSON.stringify({
    contract:{objective:architecture.brief.objective,subject:architecture.brief.subject,focus:architecture.brief.focus,learnerLevel:architecture.brief.learnerLevel,groundingPolicy:architecture.brief.groundingPolicy,mustCover:architecture.brief.mustCover,mustAvoid:architecture.brief.mustAvoid},
    duration:{minutes:architecture.duration.minutes,targetWords,allowedWords:{min:Math.ceil(targetWords*.9),max:Math.floor(targetWords)}},
    immutableBeatSkeleton:beatSkeleton,
    instructions:['Return exactly one output beat for every beatId, in the same order.','Do not change beatId, scene membership, role, evidence, prerequisite order, or objective.','spokenText is spoken narration only; no markdown, stage directions, captions, or unsupported claims.','displayText is a short learner-facing label. visualIntent must describe one useful visual for the same claim, or explicitly say no additional visual.','Keep the complete spokenText between the allowed word bounds; distribute words across beats according to targetWords.'],
  });
  const parsed=await options.gateway.executeStructured<RealizedLessonPayload>({
    jobId:options.jobId,taskId:`teaching-realization:${architecture.duration.minutes}`,label:'teaching-beat-realization',promptVersion:'teaching-beat-v1',schemaVersion:'teaching-beat-realization-v1',provider:'openrouter',model:options.model,system,prompt,schema:REALIZATION_SCHEMA,schemaName:'teaching_beat_realization',maxTokens:Math.min(16000,Math.max(2400,Math.round(targetWords*2.2))),reasoningMaxTokens:800,temperature:.25,signal:options.signal,budgetLimitUsd:options.budgetLimitUsd,estimatedCostUsd:Math.min(options.budgetLimitUsd*.35,Math.max(.005,targetWords*.00002)),cache:true,maxAttempts:2,acceptedFinishReasons:['stop'],
    parse:content=>JSON.parse(content) as RealizedLessonPayload,
    validate:value=>{
      if(value.version!==1||!Array.isArray(value.beats)||value.beats.length!==architecture.beats.length)throw new Error(`Teaching realization must return ${architecture.beats.length} beats`);
      const expected=architecture.beats.map(beat=>beat.id);
      value.beats.forEach((item,index)=>{
        if(item.beatId!==expected[index])throw new Error(`Teaching realization changed beat order at ${index}`);
        if(!item.spokenText.trim()||!item.displayText.trim()||!item.visualIntent.trim())throw new Error(`Teaching realization beat ${item.beatId} is incomplete`);
      });
      const words=value.beats.reduce((sum,item)=>sum+countCodeAwareWords(item.spokenText),0);
      if(words<Math.ceil(targetWords*.9)||words>Math.floor(targetWords))throw new Error(`Teaching realization word budget ${words}/${targetWords} is outside 90–100%`);
    },
  });
  const byId=new Map(parsed.value.beats.map(beat=>[beat.beatId,beat]));
  const beats=architecture.beats.map(beat=>{
    const realized=byId.get(beat.id)!;
    const evidence=beat.evidence;
    const spokenText={text:realized.spokenText.trim(),provenance:{...beat.spokenText.provenance,generatedBy:`${options.model}:teaching-beat-v1`}};
    const displayText={text:clean(realized.displayText,160),provenance:{origin:'representation' as const,generatedBy:`${options.model}:teaching-beat-v1`}};
    const next={...beat,spokenText,displayText,visualIntent:clean(realized.visualIntent,220),evidence};
    assertTeachingBeat(next);return next;
  });
  return {...architecture,beats};
}

const PROFILE:Record<DurationMinutes,Omit<CalibratedDurationProfile,'language'|'voiceId'|'wordsPerMinute'|'targetWords'|'calibration'>>={
  1:{version:1,minutes:1,targetSeconds:60,introSeconds:4,outroSeconds:6,pauseSeconds:4,maxConcepts:3,modular:false,contentSeconds:46,reserveSeconds:14,targetScenes:2,targetModules:1},
  5:{version:1,minutes:5,targetSeconds:300,introSeconds:12,outroSeconds:15,pauseSeconds:24,maxConcepts:5,modular:false,contentSeconds:249,reserveSeconds:51,targetScenes:10,targetModules:1},
  10:{version:1,minutes:10,targetSeconds:600,introSeconds:18,outroSeconds:24,pauseSeconds:48,maxConcepts:9,modular:false,contentSeconds:510,reserveSeconds:90,targetScenes:20,targetModules:1},
  30:{version:1,minutes:30,targetSeconds:1800,introSeconds:40,outroSeconds:50,pauseSeconds:130,maxConcepts:24,modular:true,contentSeconds:1580,reserveSeconds:220,targetScenes:60,targetModules:3},
  60:{version:1,minutes:60,targetSeconds:3600,introSeconds:70,outroSeconds:80,pauseSeconds:250,maxConcepts:42,modular:true,contentSeconds:3200,reserveSeconds:400,targetScenes:120,targetModules:6},
};

// The repository's measured local English voice is 108 wpm. Other languages
// inherit that conservative rate until a voice/language measurement is supplied;
// the fallback is labelled instead of pretending to be language calibration.
const MEASURED_DEFAULT_WPM=108;
const TREATMENT_SECONDS:Record<Exclude<CoverageTreatment,'omit'>,number>={mention:10,explain:24,demonstrate:38,derive:52,compare:34};
const INSTRUCTION_LIKE=/\b(ignore|disregard|system prompt|assistant message|follow these instructions|override|change (?:the )?(?:budget|policy|tools?))\b/i;

const clean=(value:string|undefined,max=180):string=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const unique=(values:string[]):string[]=>[...new Set(values.map(value=>clean(value)).filter(Boolean))];
const conceptKey=(value:string):string=>clean(value).toLocaleLowerCase();
const evenAllocation=(total:number,count:number):number[]=>{
  if(count<=0)return [];
  const base=Math.floor(total/count),remainder=total-base*count;
  return Array.from({length:count},(_,index)=>base+(index<remainder?1:0));
};

function createDurationProfile(minutes:DurationMinutes,calibration:DurationCalibration={language:'en'}):CalibratedDurationProfile {
  const base=PROFILE[minutes];
  if(!base)throw new Error('Duration must be 1, 5, 10, 30, or 60 minutes');
  const explicit=calibration.wordsPerMinute;
  if(explicit!==undefined&&(!Number.isFinite(explicit)||explicit<60||explicit>300))throw new Error('Voice calibration must be between 60 and 300 words per minute');
  const pace=calibration.pace==='slow'?.88:calibration.pace==='fast'?1.12:1;
  const wordsPerMinute=Math.round((explicit??MEASURED_DEFAULT_WPM)*pace);
  // `targetWords` is the spoken-timeline budget, not only the concept reserve.
  // Intro/outro/pauses are represented by the lesson plan, but the exported video
  // still has to occupy 90–100% of the requested duration. Keeping this at the full
  // target prevents the audit from declaring a correctly paced one-minute lesson an
  // overfill merely because its content reserve is 46 seconds.
  return {...base,language:clean(calibration.language,35)||'en',...(calibration.voiceId?{voiceId:clean(calibration.voiceId,80)}:{}),wordsPerMinute,targetWords:Math.round(base.targetSeconds*wordsPerMinute/60),calibration:explicit===undefined?'measured-default':'explicit-voice'};
}

/** Count code tokens as spoken units instead of treating a code block as prose. */
function countCodeAwareWords(text:string):number {
  let prose=text;
  let codeUnits=0;
  prose=prose.replace(/```[^\n]*\n?([\s\S]*?)```/g,(_whole,code:string)=>{
    codeUnits+=(code.match(/[\p{L}_$][\p{L}\p{N}_$]*|\d+(?:\.\d+)?|===|!==|=>|==|!=|<=|>=|&&|\|\||[+*/%<>{}[\]().,:;=-]/gu)??[]).length;
    return ' ';
  });
  return segmentWords(prose).length+codeUnits;
}

/** H4/H6 measurement. It reports underfill; it never pads with filler. */
export function auditNarrationBudget(plan:TeachingArchitecturePlan):NarrationBudgetAudit {
  const totalMs=plan.beats.reduce((sum,beat)=>sum+beat.targetDurationMs,0);
  let elapsedMs=0,allocatedUnits=0;
  const rows=plan.beats.map((beat,index)=>{
    elapsedMs+=beat.targetDurationMs;
    const cumulativeTarget=index===plan.beats.length-1?plan.duration.targetWords:Math.round(elapsedMs/Math.max(1,totalMs)*plan.duration.targetWords);
    const targetUnits=Math.max(0,cumulativeTarget-allocatedUnits);
    allocatedUnits+=targetUnits;
    const actualUnits=countCodeAwareWords(beat.spokenText.text);
    return {beatId:beat.id,targetUnits,actualUnits,utilization:targetUnits?actualUnits/targetUnits:0};
  });
  const targetUnits=plan.duration.targetWords;
  const actualUnits=rows.reduce((sum,row)=>sum+row.actualUnits,0);
  const utilization=targetUnits?actualUnits/targetUnits:0;
  return {targetUnits,actualUnits,utilization,withinReleaseWindow:utilization>=.9&&utilization<=1,beats:rows};
}

const nodeRole=(node:PlanNode):PedagogicalRole=>node.shape==='number'?'demonstrate':node.kind==='warning'?'challenge':node.kind==='success'?'recap':'explain';
const wordsOf=(text:string):string[]=>text.trim().split(/\s+/).filter(Boolean);
const overlap=(a:string,b:string):number=>{
  const left=new Set(segmentWords(a.toLocaleLowerCase()).filter(word=>word.length>2));
  return segmentWords(b.toLocaleLowerCase()).filter(word=>word.length>2&&left.has(word)).length;
};

/**
 * Converts a validated legacy scene draft into canonical beat artifacts. This is
 * intentionally an adapter: it preserves the model's narration spans and node
 * semantics, but assigns policy-owned evidence/provenance and stable beat IDs.
 * The renderer is not involved, so the adapter is replayable and safe to run
 * before the eventual canonical-beat lowering cutover.
 */
function adaptPlanToTeachingBeats(plan:Plan,context?:TeachingArchitecturePlan):ModelBeatArtifact {
  const beats:TeachingBeat[]=[];
  for(const scene of plan.scenes){
    const words=wordsOf(scene.narration);
    const ordered=[...scene.nodes].sort((a,b)=>a.wordIndex-b.wordIndex||a.id.localeCompare(b.id));
    // Several visual nodes may intentionally appear at the same narration anchor.
    // They share one semantic beat; emitting an empty span and falling back to the
    // whole scene would duplicate spoken text and corrupt duration/evidence audits.
    const groups:Plan['scenes'][number]['nodes'][]=[];
    for(const node of ordered){
      const group=groups.at(-1);
      if(group&&group[0].wordIndex===node.wordIndex)group.push(node);else groups.push([node]);
    }
    for(let index=0;index<groups.length;index++){
      const group=groups[index];
      const node=group[0];
      const start=Math.max(0,Math.min(words.length,node.wordIndex));
      const end=Math.max(start,Math.min(words.length,index+1<groups.length?groups[index+1][0].wordIndex:words.length));
      const spoken=words.slice(start,end).join(' ')||words.slice(start,start+1).join(' ')||scene.narration;
      const candidates=context?.coverage.requirements.filter(requirement=>
        overlap(requirement.concept,group.map(item=>`${item.label} ${item.keyPoint??''}`).join(' '))>0
      ).sort((a,b)=>b.evidence.length-a.evidence.length||a.id.localeCompare(b.id))??[];
      const evidence=(candidates[0]?.evidence??[]).slice(0,4);
      const spokenProvenance:TextProvenance={origin:evidence.length?'source':'lesson-plan',...(evidence.length?{evidence}:{}),generatedBy:'model-plan-beat-adapter-v1'};
      const displayProvenance:TextProvenance={origin:'representation',generatedBy:'model-plan-beat-adapter-v1'};
      const beat:TeachingBeat={
        id:stableId('beat',scene.id,node.id),sceneId:scene.id,
        claimIds:group.map(item=>stableId('claim',scene.id,item.keyPoint??item.label)),evidence,
        role:nodeRole(node),spokenText:{text:spoken,provenance:spokenProvenance},
        displayText:{text:node.label,provenance:displayProvenance},
        visualIntent:node.visualIntent??`Show ${node.label} in the scene`,
        visualMutation:{operation:index===0?'introduce':'connect',subjectId:node.conceptId??stableId('concept',node.label)},
        targetDurationMs:Math.max(250,Math.round((end-start)/Math.max(1,words.length)*Math.max(1000,scene.narration.length*45))),
      };
      assertTeachingBeat(beat);beats.push(beat);
    }
  }
  if(context&&beats.length){
    // Allocate the canonical content reserve by spoken-word share. This is
    // deterministic and keeps the requested duration profile visible without
    // padding narration or pretending that estimates are measured audio.
    const totalWords=beats.reduce((sum,beat)=>sum+wordsOf(beat.spokenText.text).length,0);
    // Beat treatment time covers the concept reserve; intro/outro/pause are
    // intentionally left to the global lesson timeline and the audio rebalancer.
    const targetMs=Math.round(context.duration.contentSeconds*1000);
    let allocated=0;
    beats.forEach((beat,index)=>{
      const remaining=targetMs-allocated;
      const remainingWords=beats.slice(index).reduce((sum,item)=>sum+wordsOf(item.spokenText.text).length,0);
      const share=index===beats.length-1?remaining:Math.max(250,Math.round(targetMs*(wordsOf(beat.spokenText.text).length/Math.max(1,totalWords))));
      const duration=Math.min(remaining,Math.max(250,remainingWords?share:0));
      beat.targetDurationMs=duration;allocated+=duration;
    });
  }
  return {version:1,planTitle:plan.title,sourcePlanVersion:1,beats,sceneIds:plan.scenes.map(scene=>scene.id)};
}

export function auditModelBeatArtifact(artifact:ModelBeatArtifact,duration:CalibratedDurationProfile):ModelBeatDurationAudit {
  const allocatedMs=artifact.beats.reduce((sum,beat)=>sum+beat.targetDurationMs,0);
  const spokenWords=artifact.beats.reduce((sum,beat)=>sum+wordsOf(beat.spokenText.text).length,0);
  const targetWords=duration.targetWords;
  const utilization=targetWords?spokenWords/targetWords:0;
  return {targetSeconds:duration.contentSeconds,allocatedSeconds:allocatedMs/1000,spokenWords,targetWords,utilization,withinReleaseWindow:utilization>=.9&&utilization<=1};
}

/**
 * Expand a deterministic blueprint into a complete spoken lesson. This is used
 * by the offline/durable path where no model is available to write narration.
 * Every added sentence has a bounded pedagogical role (orientation, intuition,
 * example, prediction, interpretation, or recap); it never repeats a sentence
 * merely to occupy time. Model-authored lessons do not use this escape hatch:
 * their own word budget is validated and a short result fails the release gate.
 */
export function expandTeachingArchitectureNarration(plan:TeachingArchitecturePlan,targetUtilization=.94):TeachingArchitecturePlan {
  if(!Number.isFinite(targetUtilization)||targetUtilization<.9||targetUtilization>1)throw new Error('Narration expansion target must be between 0.90 and 1.00');
  const targetWords=Math.max(1,Math.floor(plan.duration.targetWords*targetUtilization));
  const current=plan.beats.map(beat=>Math.max(1,countCodeAwareWords(beat.spokenText.text)));
  const currentTotal=current.reduce((sum,value)=>sum+value,0);
  const allocations=current.map((value,index)=>index===current.length-1
    ?Math.max(1,targetWords-current.slice(0,index).reduce((sum,item)=>sum+Math.max(1,Math.round(targetWords*item/Math.max(1,currentTotal))),0))
    :Math.max(1,Math.round(targetWords*value/Math.max(1,currentTotal))));
  const subject=spokenTopic(plan.brief.subject);
  const objective=plan.brief.objective;
  const teachingLabel=(raw:string):string=>{
    const label=clean(raw,140);
    if(!label)return subject;
    const rawWords=label.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const subjectWords=new Set(subject.toLocaleLowerCase().split(/\s+/).map(word=>word.replace(/[^a-z0-9-]/g,'')).filter(word=>word.length>2));
    const overlapCount=rawWords.filter(word=>subjectWords.has(word.replace(/[^a-z0-9-]/g,''))).length;
    // Token-built labels are useful for retrieval but poor spoken English. If
    // most of a short label is copied from the requested subject, speak the
    // complete subject instead of the lossy token bag.
    const tokenBag=rawWords.length>=2&&rawWords.length<=5&&overlapCount>=Math.ceil(rawWords.length*.5)&&!/[.!?,:;()]/.test(label);
    return tokenBag?subject:label;
  };
  const variants=[
    (concept:string)=>`Now use a concrete example. Describe one ordinary case, then compare it with a nearby case where ${concept} changes. The contrast makes the idea visible instead of leaving it as a definition.`,
    (concept:string)=>`Start with a plain-language version of ${concept}. The goal is to understand what it changes and why it matters for ${subject}.`,
    (concept:string)=>`Build an intuition for ${concept}: imagine watching one part of a system while the surrounding context changes. Ask what mechanism could produce what you observe.`,
    (concept:string)=>`Pause and predict. If ${concept} became stronger, weaker, faster, or slower, what would you expect to see first? State your prediction before checking it against the explanation.`,
    (concept:string)=>`Here is the formal interpretation: ${concept} connects an observation with the conditions around it and the consequence that follows. Keep those three parts together when you reason about a new example.`,
    (concept:string)=>`A common mistake is to treat ${concept} as an isolated label. Instead, connect it to neighboring ideas, ask what evidence would support it, and separate an explanation from an untested claim.`,
    (_concept:string)=>`To use the idea, look for the signal, identify the mechanism, and explain the result in your own words. That sequence is more durable than memorizing a sentence.`,
    (_concept:string)=>`Return to the central question: ${objective}. The takeaway is a mental model you can use when you meet a new example.`,
  ];
  let variantOffset=0;
  const beats=plan.beats.map((beat,index)=>{
    const concept=teachingLabel(beat.displayText?.text||beat.spokenText.text.split(/\s+/).slice(0,6).join(' '));
    const parts=[beat.spokenText.text.trim()];
    let words=countCodeAwareWords(parts[0]);
    while(words<allocations[index]){
      const addition=variants[(variantOffset++)%variants.length](concept);
      parts.push(addition);words+=countCodeAwareWords(addition);
    }
    const fitted=parts.join(' ').split(/\s+/).filter(Boolean).slice(0,allocations[index]).join(' ');
    const spokenText={...beat.spokenText,text:fitted,provenance:{...beat.spokenText.provenance,generatedBy:'deterministic-pedagogy-expander-v1'}};
    return {...beat,spokenText};
  });
  return {...plan,beats};
}

/**
 * Compatibility lowering for the live renderer. Canonical beats remain the
 * semantic source of truth, while this adapter preserves the existing Plan v1
 * geometry contract until the renderer accepts beats directly. Only metadata
 * fields are added, so SVG/layout output stays byte-identical for existing
 * plans. Where beat text forms an exact scene partition, beat anchors are also
 * lowered into the legacy `Scene.beats`/`PlanNode.beatId` fields.
 */
export function lowerCanonicalBeatsToPlan(plan:Plan,artifact:ModelBeatArtifact):Plan {
  const byScene=new Map<string,TeachingBeat[]>();
  for(const beat of artifact.beats){const list=byScene.get(beat.sceneId)??[];list.push(beat);byScene.set(beat.sceneId,list);}
  const lowered:Plan={...plan,scenes:plan.scenes.map(scene=>{
    // `adaptPlanToTeachingBeats` already emits scene beats in narration order;
    // preserving that order is required for exact partition checks.
    const beats=byScene.get(scene.id)??[];
    if(!beats.length)return scene;
    const nodes=scene.nodes.map(node=>{
      const beat=beats.find(candidate=>candidate.displayText?.text===node.label);
      if(!beat)return node;
      return {...node,visualIntent:node.visualIntent??beat.visualIntent};
    });
    const spoken=beats.map(beat=>beat.spokenText.text).join(' ').replace(/\s+/g,' ').trim();
    const narration=scene.narration.replace(/\s+/g,' ').trim();
    // Plan v1 limits each optional beat narration to 600 characters. A long
    // canonical scene can still be valid as a scene-level narration; retain its
    // semantic sidecar without emitting an invalid renderer beat partition.
    if(spoken!==narration||beats.length<2||beats.length>4||beats.some(beat=>beat.spokenText.text.length>600))return {...scene,nodes};
    const sceneBeats=beats.map(beat=>({id:beat.id,narration:beat.spokenText.text}));
    const anchoredNodes=nodes.map(node=>{
      const beat=beats.find(candidate=>candidate.displayText?.text===node.label);
      return beat?{...node,beatId:beat.id}:node;
    });
    return {...scene,nodes:anchoredNodes,beats:sceneBeats};
  })};
  return lowered;
}

/**
 * Lower the committed global blueprint directly to the renderer contract.  This
 * is the canonical path for durable workers: scene workers receive beats that
 * were planned before any narration or geometry is produced, rather than
 * inventing a new semantic plan while rendering.
 */
export function lowerTeachingArchitectureToPlan(architecture:TeachingArchitecturePlan):Plan {
  const split=(text:string,maxChars=1500):string[]=>{
    const words=text.trim().split(/\s+/).filter(Boolean);const chunks:string[]=[];let current='';
    for(const word of words){
      const candidate=current?`${current} ${word}`:word;
      if(current&&candidate.length>maxChars){chunks.push(current);current=word;}else current=candidate;
    }
    if(current)chunks.push(current);
    return chunks.length?chunks:['Lesson'];
  };
  const scenes:Plan['scenes']=[];
  const topicText=`${architecture.brief.subject} ${architecture.brief.objective} ${architecture.brief.focus.join(' ')}`;
  // Domain grammars are selected from the committed lesson objective, never from a
  // scene's incidental label. Selection rules are data (domain.ts), not code.
  const domainTemplate=resolveDomainTemplate(topicText);
  for(const scene of architecture.hierarchy.scenes){
    const beats=architecture.beats.filter(beat=>beat.sceneId===scene.id);
    for(const beat of beats.length?beats:[{id:stableId('beat',scene.id,'fallback'),sceneId:scene.id,claimIds:[],evidence:[],role:'explain' as const,spokenText:{text:architecture.brief.objective,provenance:{origin:'lesson-plan' as const}},visualIntent:`Show ${scene.title}`,visualMutation:{operation:'introduce' as const,subjectId:stableId('concept',scene.title)},targetDurationMs:scene.targetSeconds*1000}]){
      const parts=split(beat.spokenText.text);
      parts.forEach((narration,partIndex)=>{
        const words=narration.split(/\s+/).filter(Boolean);
        const sceneId=stableId('scene',scene.id,beat.id,partIndex);
        const rawLabel=beat.displayText?.text||words.slice(0,6).join(' ');
        // Resolve from the beat's own semantic claim first.  Broad lesson
        // context is only a fallback: including the title in every lookup made
        // unrelated concepts inherit whichever domain keyword happened to win
        // (for example every ghost beat becoming a brain or every safety beat a
        // browser), which weakened cross-scene teaching identity.
        const resolved=resolveKind(`${rawLabel} ${beat.visualIntent}`)
          ??resolveKind(`${rawLabel} ${architecture.brief.subject}`)
          ??(domainTemplate?TEMPLATE_FALLBACK_KIND[domainTemplate]:undefined);
        const mainKind=beat.role==='challenge'?'warning':beat.role==='recap'?'success':beat.role==='demonstrate'?'result':resolved??DEFAULT_NODE_KIND;
        // Equation glyphs are intentionally not used as the primary teaching
        // surface: the compact icon is a symbol, not a readable equation, and
        // rendered as “+=X” it creates a misconception. Keep the semantic kind
        // for color/resolution, but give equation-heavy claims a readable box.
        const equationLike=EQUATION_HINT.test(`${rawLabel} ${beat.visualIntent}`);
        // The brain illustration is intentionally abstract line art and reads as
        // a blob at video scale. Use its semantic icon in compact scenes; this
        // keeps the concept legible while richer source figures remain available
        // through the image-node path.
        const illustrationAllowed=!ILLUSTRATION_SUPPRESSED_KINDS.includes(mainKind);
        const mainShape=equationLike?'equation':beat.role==='demonstrate'?'number':illustrationAllowed&&hasIllustration(mainKind)?'illustration':hasIcon(mainKind)?'icon':DEFAULT_NODE_SHAPE;
        // Illustration captions occupy a narrow strip under the figure; keep them
        // short while retaining the full claim in narration and provenance.
        const label=clipLabel(rawLabel,mainShape==='illustration'?22:56).text;
        const supportLabels=domainTemplate?TEMPLATE_SUPPORT_LABELS[domainTemplate]:undefined;
        const supportLabel=partIndex===parts.length-1?(supportLabels??DEFAULT_SUPPORT_LABELS).final:(supportLabels??DEFAULT_SUPPORT_LABELS).early;
        // Keep a support/interpretation node from inheriting the equation glyph
        // merely because the lesson title mentions Navier–Stokes. It should
        // reinforce the flow or result, not repeat an unreadable symbol.
        const supportKind=(domainTemplate?TEMPLATE_SUPPORT_KIND[domainTemplate]:undefined)??resolveKind(`${supportLabel} ${beat.visualIntent}`)??DEFAULT_NODE_KIND;
        const supportShape=hasIllustration(supportKind)?'illustration':hasIcon(supportKind)?'icon':DEFAULT_NODE_SHAPE;
        const main={id:stableId('node',sceneId,'main'),label,wordIndex:0,kind:mainKind,shape:mainShape,...(equationLike?{equationSteps:[rawLabel]}:{}),visualIntent:beat.visualIntent,conceptId:beat.visualMutation.subjectId} as PlanNode;
        // Reveal the interpretation during the scene, not only on the final spoken
        // word; otherwise a 1-minute lesson holds a nearly empty board for 30–50s.
        const supportWord=Math.min(Math.max(1,words.length-1),Math.max(1,Math.floor(words.length*0.55)));
        const support={id:stableId('node',sceneId,'support'),label:supportLabel,wordIndex:supportWord,kind:supportKind,shape:supportShape,visualIntent:'Hold the learner-facing interpretation',auto:true,conceptId:stableId('concept',supportLabel)} as PlanNode;
        // Renderer scene titles are capped at 70 characters. Clip after adding
        // the deterministic part marker so long source/prompt titles cannot make
        // an otherwise valid canonical lesson fail during lowering.
        scenes.push({
          id:sceneId,
          title:clipLabel(`${scene.title}${parts.length>1?` · ${partIndex+1}/${parts.length}`:''}`,70).text,
          narration,
          layout:'flow',
          nodes:[main,support],
          edges:[{from:main.id,to:support.id,label:(domainTemplate&&TEMPLATE_EDGE_LABEL[domainTemplate])||DEFAULT_EDGE_LABEL}],
          ...(domainTemplate?{template:domainTemplate}:{}),
        });
      });
    }
  }
  const lowered=validatePlan({version:1,title:architecture.brief.subject.slice(0,90),scenes});
  // Canonical lowering owns the domain template choice, so it must pass the same
  // semantic compatibility gate as a model-directed scene before reaching the renderer.
  lowered.scenes.forEach(scene=>validateTemplateSemantics({
    ...scene,
    // A canonical scene may begin with a prerequisite phrase that does not repeat
    // the lesson subject. Include the immutable lesson objective as validator context
    // without changing the rendered title or narration.
    title:`${scene.title} ${architecture.brief.subject} ${architecture.brief.objective}`,
  }));
  return lowered;
}

function sourceHeadings(sources:SourceIR[]):string[]{
  return unique(sources.flatMap(source=>source.blocks.filter(block=>block.type==='heading').map(block=>block.text)).filter(value=>!INSTRUCTION_LIKE.test(value)));
}

const INSTRUCTION_VERBS=/^(?:please\s+)?(?:teach|explain|learn|understand|cover|focus(?:\s+on)?|show|describe)\s+/i;
const INSTRUCTION_FILLER=new Set(['the','a','an','what','why','how','is','are','does','do','can','will','about','for','to','from','of','in','on','as','and','or','then','with']);
const UNRELIABLE_SOURCE_TITLE=/^(?:text|prompt|source|inline|unknown)(?::|$)/i;
/**
 * A prompt is an instruction, not a display title.  When a text/prompt source
 * has no reliable document heading, keep only the requested subject and drop
 * teaching directions ("beginning with…", learner/style clauses, etc.).
 * This also gives deterministic offline lessons the same title policy as live
 * source-backed lessons.
 */
export function subjectFromInstruction(instruction:string):string {
  let value=clean(instruction,300).replace(INSTRUCTION_VERBS,'').trim();
  value=value.replace(/\s+(?:beginning|starting|start|then|and then|followed by)\s+.*$/i,'');
  value=value.split(/[;,]/,1)[0]?.trim()??value;
  value=value.replace(/\s+(?:and\s+)?(?:one|a)\s+(?:safe\s+)?(?:defensive\s+)?(?:concept|example|check)\b.*$/i,'').trim();
  value=value.replace(/\s+(?:for|with)\s+(?:a|an|the)?\s*(?:beginner|student|advanced|researcher|learner|teacherly|evidence-grounded|evidence based).*$/i,'').trim();
  value=value.replace(/\s+/g,' ').replace(/[.!?]+$/,'').trim();
  if(!value)return '';
  return value.charAt(0).toLocaleUpperCase()+value.slice(1);
}
function derivedFocusConcepts(instruction:string,sources:SourceIR[]):string[]{
  if(!instruction||!sources.length)return [];
  const body=sources.flatMap(source=>source.blocks.map(block=>{
    if('text' in block)return block.text;
    if(block.type==='list')return block.items.join(' ');
    if(block.type==='table')return `${block.caption??''} ${block.columns.join(' ')} ${block.rows.flat().join(' ')}`;
    if(block.type==='figure')return `${block.caption??''} ${block.description??''} ${block.nearbyText.join(' ')}`;
    return '';
  })).join(' ').toLocaleLowerCase();
  const normalize=(word:string)=>word.toLocaleLowerCase().replace(/[^a-z0-9-]/g,'').replace(/-/g,'');
  const sourceWords=new Set((body.match(/[a-z][a-z0-9-]{2,}/g)??[]).map(normalize));
  const numericMentions=Array.from(instruction.matchAll(/\b\d[\d,.]*(?:[-\s]+[a-z][a-z0-9-]*){0,3}/gi)).map(match=>match[0].trim()).filter(value=>{
    const words=value.toLocaleLowerCase().replace(/[^a-z0-9-]+/g,' ').split(/\s+/).map(normalize).filter(Boolean);
    return words.some(word=>word.length>2&&sourceWords.has(word));
  });
  const lexicalMentions=instruction.split(/\b(?:and|or|then|plus|versus|vs)\b|[,;:]/i).map(segment=>{
    const cleaned=segment.replace(INSTRUCTION_VERBS,'').replace(/^\s*(?:what|why|how)\s+/i,'').replace(/\s+(?:works?|balancing|matters?|means?)\s*$/i,'').replace(/\s+/g,' ').trim();
    const words=cleaned.split(/\s+/).map(normalize).filter(word=>word.length>2&&!INSTRUCTION_FILLER.has(word)&&sourceWords.has(word));
    // Preserve the learner's phrase when it is grounded in the source. The
    // previous implementation rebuilt a concept from matching tokens, which
    // produced teacher-hostile labels such as “spiritual build trust blind”
    // and “people darkweb”. A phrase retains grammar, scope, and intent.
    if(words.length>=2)return clean(cleaned.replace(/[.!?]+$/,''),120);
    return words.slice(0,4).join(' ');
  }).filter(Boolean);
  return unique([...numericMentions,...lexicalMentions]).slice(0,6);
}

function buildTeachingBrief(request:LessonRequest,sources:SourceIR[]=[],options:BriefOptions={}):TeachingBrief {
  const headings=sourceHeadings(sources);
  const sourceTitles=unique(sources.map(source=>source.identity.title));
  const objective=clean(options.objective??request.instruction??`Explain ${sourceTitles[0]??'the supplied material'}`,300);
  const safeInstruction=clean(request.instruction,180);
  // Explicit focus is the lesson subject; the document title is supporting context.
  // Prefer a reliable heading that matches the explicit focus. This keeps a
  // lesson titled “Navier–Stokes equation” instead of the last generic token
  // (“equation”), while still letting a non-source topic win when no heading is
  // relevant.
  const matchingHeading=safeInstruction
    ? headings.slice().sort((a,b)=>overlap(safeInstruction,b)-overlap(safeInstruction,a)||a.localeCompare(b)).find(heading=>overlap(safeInstruction,heading)>0)
    : undefined;
  // Synthetic labels such as `text:text` and `prompt:prompt` are transport
  // metadata, not lesson titles. They must never outrank an explicit prompt.
  const reliableSourceTitle=sourceTitles.find(title=>title&&!UNRELIABLE_SOURCE_TITLE.test(title));
  const explicitSubject=safeInstruction?subjectFromInstruction(safeInstruction):'';
  // An explicit instruction is the highest-priority title signal. A matching
  // heading remains useful only when the instruction has no recoverable subject.
  const subject=clean(options.subject||explicitSubject||matchingHeading||reliableSourceTitle||sourceTitles[0]||headings[0]||'Lesson',120)||'Lesson';
  const learnerLevel=request.learnerContext.level??'beginner';
  const audience=clean(request.learnerContext.audience??learnerLevel,100);
  const startingPoint=learnerLevel==='advanced'?'advanced foundations':learnerLevel==='intermediate'?'working fundamentals':learnerLevel==='beginner'?'no assumed prior mastery':'adapt to learner context';
  const requested=unique(options.mustCover??request.learnerContext.goals??[]);
  // An explicit instruction is a focus selector, not a request to teach every
  // heading in the document. Keep only headings that share meaningful terms with
  // that instruction; if none match, retain the explicit subject so source-fitness
  // can honestly report a missing source concept.
  const relevantHeadings=safeInstruction?headings.filter(heading=>overlap(safeInstruction,heading)>0):headings;
  const derived=derivedFocusConcepts(safeInstruction,sources);
  const focus=unique([...requested,...derived,...(safeInstruction?(relevantHeadings.length?relevantHeadings:[subject]):headings)]).slice(0,12);
  const mustCover=requested.length?requested:focus;
  const mustAvoid=unique([...(options.mustAvoid??[]),...(request.stylePreferences.avoid??[])]);
  const pedagogy:import('../types/contracts.js').PedagogyPattern[]=learnerLevel==='beginner'
    ?['advance-organizer','prerequisite-scaffold','concrete-to-abstract','worked-example','active-prediction','misconception-check','retrieval-recap','cognitive-load']
    :['advance-organizer','concrete-to-abstract','worked-example','self-explanation','misconception-check','retrieval-recap'];
  return {version:1,subject,sources:sources.map(source=>source.identity),objective,audience,learnerLevel,startingPoint,focus,mustCover,mustAvoid,assumedKnowledge:unique(request.learnerContext.assumedKnowledge??[]),durationMinutes:request.durationMinutes,groundingPolicy:request.groundingPolicy,narrativeAngle:clean(options.narrativeAngle??(request.durationMinutes>=30?'module-by-module conceptual progression':'concept-to-mechanism teaching'),160),pedagogy};
}

function buildNarrativeArc(brief:TeachingBrief):NarrativeArc {
  const stages: NarrativeArc['stages']=brief.durationMinutes===1
    ? [
      {id:'orientation',role:'orientation',objective:`Orient the learner to ${brief.subject}`},
      {id:'core',role:'concept',objective:'Establish the single central idea'},
      {id:'mechanism',role:'mechanism',objective:'Show the mechanism or one concrete example'},
      {id:'takeaway',role:'synthesis',objective:'State the usable takeaway'},
    ]
    : brief.durationMinutes===5
      ? [
        {id:'orientation',role:'orientation',objective:`Orient the learner to ${brief.subject}`},
        {id:'context',role:'context',objective:'Establish why the topic matters'},
        {id:'concepts',role:'concept',objective:'Build the selected concepts in dependency order'},
        {id:'example',role:'example',objective:'Work through a concrete example'},
        {id:'synthesis',role:'synthesis',objective:'Connect the ideas into one mental model'},
      ]
      : brief.durationMinutes===10
        ? [
          {id:'prerequisites',role:'prerequisite',objective:'Bridge only the prerequisites needed for this lesson'},
          {id:'model',role:'concept',objective:'Build the conceptual model'},
          {id:'mechanisms',role:'mechanism',objective:'Explain the mechanisms'},
          {id:'examples',role:'example',objective:'Apply the model in examples'},
          {id:'limits',role:'limitation',objective:'Surface a limitation or common misconception'},
          {id:'recap',role:'recap',objective:'Recap the durable model'},
        ]
        : [
          {id:'syllabus',role:'orientation',objective:'Map the session and module objectives'},
          {id:'prerequisites',role:'prerequisite',objective:'Close prerequisite gaps'},
          {id:'concepts',role:'concept',objective:'Develop concepts module by module'},
          {id:'mechanisms',role:'mechanism',objective:'Explain and derive the mechanisms'},
          {id:'applications',role:'example',objective:'Use worked examples and comparisons'},
          {id:'limits',role:'limitation',objective:'Examine limits and misconceptions'},
          {id:'synthesis',role:'synthesis',objective:'Connect module-level mental models'},
          {id:'recap',role:'recap',objective:'Consolidate the session'},
        ];
  return {version:1,title:brief.subject,stages:stages.map(stage=>({...stage,id:stableId('arc',brief.subject,stage.id)}))};
}

function closePrerequisites(specs:CoverageSpec[]):CoverageSpec[]{
  const byConcept=new Map(specs.map(spec=>[conceptKey(spec.concept),spec]));
  const result:CoverageSpec[]=[];
  const emitted=new Set<string>(),visiting=new Set<string>();
  const visit=(spec:CoverageSpec)=>{
    const key=conceptKey(spec.concept);
    if(emitted.has(key))return;
    if(visiting.has(key))throw new Error(`Prerequisite cycle includes "${spec.concept}"`);
    visiting.add(key);
    for(const prerequisite of spec.prerequisites??[]){
      const found=byConcept.get(conceptKey(prerequisite));
      if(found)visit(found);
      else {
        const generated:CoverageSpec={concept:prerequisite,treatment:'mention',required:true};
        byConcept.set(conceptKey(prerequisite),generated);
        visit(generated);
      }
    }
    visiting.delete(key);emitted.add(key);result.push(spec);
  };
  for(const spec of specs)visit(spec);
  return result;
}

function planCoverage(specs:CoverageSpec[],profile:CalibratedDurationProfile):CoveragePlan {
  const normalized=closePrerequisites(specs.map(spec=>({...spec,concept:clean(spec.concept,120)})).filter(spec=>spec.concept));
  let remaining=profile.contentSeconds;
  let fitted=0;
  const requirements:CoverageRequirement[]=[];
  const notFitting:CoveragePlan['notFitting']=[];
  for(const spec of normalized){
    const treatment=spec.treatment??'explain';
    const id=spec.id??stableId('req',spec.concept,treatment);
    const seconds=TREATMENT_SECONDS[treatment];
    const fitsTime=seconds<=remaining;
    const fitsConceptLimit=fitted<profile.maxConcepts;
    const requirement:CoverageRequirement={id,concept:spec.concept,treatment,evidence:[...(spec.evidence??[])]};
    requirements.push(requirement);
    if(!fitsTime||!fitsConceptLimit){
      notFitting.push({requirementId:id,reason:!fitsConceptLimit?`The ${profile.minutes}-minute profile permits at most ${profile.maxConcepts} concepts`:`The ${treatment} treatment needs ${seconds}s but only ${remaining}s remains`});
      continue;
    }
    remaining-=seconds;fitted++;
  }
  return {version:1,requirements,notFitting};
}

function allocatedTitle(requirement:CoverageRequirement|undefined,index:number):string{
  const phases=['intuition','mechanism','example','check','application','recap'];
  const base=requirement?.concept??(index===0?'Orientation':'Synthesis');
  return clean(`${base} · ${phases[index%phases.length]}`,70);
}

function buildLessonHierarchy(brief:TeachingBrief,profile:CalibratedDurationProfile,coverage:CoveragePlan):LessonHierarchy {
  const rejected=new Set(coverage.notFitting.map(item=>item.requirementId));
  const fitted=coverage.requirements.filter(requirement=>!rejected.has(requirement.id));
  // Scene density is part of the duration contract. Short lessons need a compact
  // orientation plus takeaway; five/ten-minute lessons need enough beat changes
  // that the canvas does not sit on one stretched card. Repeated slots are
  // pedagogical phases of an existing requirement, never invented subject matter.
  const sectionCount=profile.minutes===1
    ?Math.max(1,Math.min(profile.targetScenes,Math.max(1,fitted.length)))
    :profile.modular
    ?Math.max(1,fitted.length,profile.targetModules)
    :Math.max(1,profile.targetScenes);
  const sectionSeconds=evenAllocation(profile.targetSeconds,sectionCount);
  const moduleCount=profile.modular?Math.min(profile.targetModules,sectionCount):1;
  const moduleBuckets=Array.from({length:moduleCount},()=>[] as number[]);
  for(let index=0;index<sectionCount;index++)moduleBuckets[Math.min(moduleCount-1,Math.floor(index*moduleCount/sectionCount))].push(index);
  const sections:LessonSection[]=[],scenes:ScenePlan[]=[],lessons:LessonPlan[]=[],modules:LessonModule[]=[];
  for(let moduleIndex=0;moduleIndex<moduleCount;moduleIndex++){
    const lessonIds:string[]=[];
    for(const index of moduleBuckets[moduleIndex]){
      const requirement=fitted.length?fitted[index%fitted.length]:undefined;
      const title=index===0?clean(brief.subject,70):allocatedTitle(requirement,index);
      const sectionId=stableId('section',brief.subject,index,title);
      const sceneId=stableId('scene',sectionId,0);
      const lessonId=stableId('lesson',brief.subject,moduleIndex,index);
      sections.push({id:sectionId,title,sceneIds:[sceneId],objective:requirement?`${requirement.treatment}: ${requirement.concept}`:brief.objective,targetSeconds:sectionSeconds[index]});
      scenes.push({id:sceneId,sectionId,title,beatIds:[],targetSeconds:sectionSeconds[index]});
      lessons.push({id:lessonId,title,sectionIds:[sectionId],targetSeconds:sectionSeconds[index]});
      lessonIds.push(lessonId);
    }
    const targetSeconds=moduleBuckets[moduleIndex].reduce((sum,index)=>sum+sectionSeconds[index],0);
    modules.push({id:stableId('module',brief.subject,moduleIndex),title:profile.modular?`Module ${moduleIndex+1}`:brief.subject,lessonIds,targetSeconds});
  }
  const course:CourseSession={id:stableId('course',brief.subject,profile.minutes),title:brief.subject,moduleIds:modules.map(module=>module.id),targetSeconds:profile.targetSeconds};
  return {course,modules,lessons,sections,scenes,generation:profile.modular?'just-in-time':'eager'};
}

const roleFor=(treatment:CoverageTreatment):PedagogicalRole=>treatment==='demonstrate'?'demonstrate':treatment==='derive'?'derive':treatment==='compare'?'compare':treatment==='mention'?'define':'explain';
const spokenTopic=(value:string):string=>{
  const topic=clean(value,160);
  return topic.replace(/^(Why|How|What)\b/,match=>match.toLocaleLowerCase());
};
const sentenceFor=(requirement:CoverageRequirement,brief:TeachingBrief,index:number):string=>{
  const concept=clean(requirement.concept,160);
  const subject=spokenTopic(brief.subject);
  switch(requirement.treatment){
    case 'mention':return index===0?`Today we are learning about ${subject}. First, notice what ${concept} means in an ordinary situation.`:`Next, define ${concept} in plain language before we add more detail.`;
    case 'demonstrate':return `Now let’s work through ${concept} step by step, so you can see how the parts fit together.`;
    case 'derive':return `This leads us to ${concept}. We will derive it from the ideas we have already established.`;
    case 'compare':return `Let’s compare ${concept} using the same criteria, and notice what changes between the cases.`;
    default:return index===0?`Today we are learning about ${subject}. We will start with the intuition, then connect it to a concrete example.`:`First understand ${concept} in plain language; then connect it to ${subject}.`;
  }
};

function planTeachingBeats(brief:TeachingBrief,hierarchy:LessonHierarchy,coverage:CoveragePlan,specs:CoverageSpec[]):{hierarchy:LessonHierarchy;coverage:CoveragePlan;beats:TeachingBeat[]} {
  const rejected=new Set(coverage.notFitting.map(item=>item.requirementId));
  const fitted=coverage.requirements.filter(requirement=>!rejected.has(requirement.id));
  const specByConcept=new Map(closePrerequisites(specs).map(spec=>[conceptKey(spec.concept),spec]));
  const beats:TeachingBeat[]=[];
  const placements=new Map<string,{sectionId:string;sceneId:string;beatId:string}>();
  const scenes=hierarchy.scenes.map((scene,index)=>{
    const requirement=fitted.length?fitted[index%fitted.length]:undefined;
    const spec=requirement?specByConcept.get(conceptKey(requirement.concept)):undefined;
    const evidence=requirement?.evidence??[];
    const beatId=stableId('beat',scene.id,requirement?.id??'orientation');
    const phase=Math.floor(index/Math.max(1,fitted.length));
    const phaseLead=phase===0?'':phase===1?'Now let’s work through a concrete example. ':phase===2?'Pause and predict what should happen next. ':'Finally, connect this idea back to the main lesson. ';
    const baseSpoken=spec?.spokenText??(requirement?sentenceFor(requirement,brief,index):brief.objective);
    const spokenText=clean(`${phaseLead}${baseSpoken}`,1200);
    const displayText=clean(spec?.displayText??requirement?.concept??brief.subject,160);
    const provenance:TextProvenance={origin:evidence.length?'source':'lesson-plan',...(evidence.length?{evidence}:{}),generatedBy:'teaching-planner-v1'};
    const beat:TeachingBeat={id:beatId,sceneId:scene.id,claimIds:[stableId('claim',requirement?.id??brief.objective,spokenText)],evidence,role:spec?.role??roleFor(requirement?.treatment??'explain'),spokenText:{text:spokenText,provenance},displayText:{text:displayText,provenance:{...provenance}},visualIntent:clean(spec?.visualIntent??`Show ${displayText} as a ${requirement?.treatment??'concept'}`,120),visualMutation:spec?.visualMutation??{operation:'introduce',subjectId:stableId('concept',displayText)},targetDurationMs:scene.targetSeconds*1000};
    assertTeachingBeat(beat);
    beats.push(beat);
    // Keep the first pedagogical placement as the canonical coverage trace. Later
    // phase scenes revisit the same requirement without moving its evidence anchor.
    if(requirement&&!placements.has(requirement.id))placements.set(requirement.id,{sectionId:scene.sectionId,sceneId:scene.id,beatId});
    return {...scene,beatIds:[beatId]};
  });
  const requirements=coverage.requirements.map(requirement=>placements.has(requirement.id)?{...requirement,...placements.get(requirement.id)!}:{...requirement});
  return {hierarchy:{...hierarchy,scenes},coverage:{...coverage,requirements},beats};
}

function validateTeachingArchitecture(plan:TeachingArchitecturePlan):TeachingArchitecturePlan {
  const {brief,duration,coverage,hierarchy,beats}=plan;
  if(duration.introSeconds+duration.outroSeconds+duration.pauseSeconds+duration.contentSeconds!==duration.targetSeconds)throw new Error('Duration reserves do not sum to the target');
  if(hierarchy.course.targetSeconds!==duration.targetSeconds)throw new Error('Course duration does not match the duration profile');
  if(duration.modular&&(hierarchy.modules.length<2||hierarchy.generation!=='just-in-time'))throw new Error('Long lessons require just-in-time modules');
  const moduleIds=new Set(hierarchy.modules.map(module=>module.id));
  const lessonIds=new Set(hierarchy.lessons.map(lesson=>lesson.id));
  const sectionIds=new Set(hierarchy.sections.map(section=>section.id));
  const sceneIds=new Set(hierarchy.scenes.map(scene=>scene.id));
  const beatIds=new Set(beats.map(beat=>beat.id));
  if(moduleIds.size!==hierarchy.modules.length||lessonIds.size!==hierarchy.lessons.length||sectionIds.size!==hierarchy.sections.length||sceneIds.size!==hierarchy.scenes.length||beatIds.size!==beats.length)throw new Error('Teaching hierarchy IDs must be unique');
  if(hierarchy.course.moduleIds.some(id=>!moduleIds.has(id)))throw new Error('Course references an unknown module');
  for(const module of hierarchy.modules)if(module.lessonIds.some(id=>!lessonIds.has(id)))throw new Error(`Module ${module.id} references an unknown lesson`);
  for(const lesson of hierarchy.lessons)if(lesson.sectionIds.some(id=>!sectionIds.has(id)))throw new Error(`Lesson ${lesson.id} references an unknown section`);
  for(const section of hierarchy.sections)if(section.sceneIds.some(id=>!sceneIds.has(id)))throw new Error(`Section ${section.id} references an unknown scene`);
  for(const scene of hierarchy.scenes)if(!sectionIds.has(scene.sectionId)||scene.beatIds.some(id=>!beatIds.has(id)))throw new Error(`Scene ${scene.id} has an invalid section or beat`);
  const notFitting=new Set(coverage.notFitting.map(item=>item.requirementId));
  for(const requirement of coverage.requirements){
    const mapped=Boolean(requirement.sectionId&&requirement.sceneId&&requirement.beatId);
    if(mapped===notFitting.has(requirement.id))throw new Error(`Coverage requirement ${requirement.id} must be mapped or explicitly not fitting`);
    if(mapped&&(!sectionIds.has(requirement.sectionId!)||!sceneIds.has(requirement.sceneId!)||!beatIds.has(requirement.beatId!)))throw new Error(`Coverage requirement ${requirement.id} has a dangling placement`);
    if(mapped&&brief.groundingPolicy==='source-only'&&!requirement.evidence.some(ref=>ref.origin==='source'))throw new Error(`Source-only coverage requirement ${requirement.id} has no source evidence`);
  }
  for(const concept of brief.mustCover){
    const requirement=coverage.requirements.find(candidate=>conceptKey(candidate.concept)===conceptKey(concept));
    if(!requirement)throw new Error(`Must-cover concept "${concept}" is missing from coverage`);
  }
  for(const beat of beats){
    assertTeachingBeat(beat);
    if(!sceneIds.has(beat.sceneId))throw new Error(`Beat ${beat.id} references an unknown scene`);
    if(brief.groundingPolicy==='source-only'&&beat.spokenText.provenance.origin==='source'&&!beat.evidence.some(ref=>ref.origin==='source'))throw new Error(`Source-grounded beat ${beat.id} has no source evidence`);
  }
  return plan;
}

export function planTeachingArchitecture(request:LessonRequest,sources:SourceIR[],options:BriefOptions&{requirements?:CoverageSpec[];voiceWpm?:number}={}):TeachingArchitecturePlan {
  const duration=createDurationProfile(request.durationMinutes,{language:request.language,voiceId:request.stylePreferences.voiceId,wordsPerMinute:options.voiceWpm,pace:request.stylePreferences.pace});
  const brief=buildTeachingBrief(request,sources,options);
  const stem=(token:string)=>token.endsWith('ies')&&token.length>4?`${token.slice(0,-3)}y`:token.endsWith('s')&&token.length>4?token.slice(0,-1):token;
  const tokens=(value:string)=>new Set(segmentWords(value.toLocaleLowerCase()).filter(token=>token.length>1).map(stem));
  const blockText=(block:SourceIR['blocks'][number]):string=>{
    if('text' in block)return block.text;
    if(block.type==='list')return block.items.join(' ');
    if(block.type==='table')return `${block.caption??''} ${block.columns.join(' ')} ${block.rows.flat().join(' ')}`;
    if(block.type==='figure')return `${block.caption??''} ${block.description??''} ${block.nearbyText.join(' ')}`;
    if(block.type==='metadata')return `${block.key} ${block.value}`;
    return '';
  };
  const evidenceFor=(concept:string):EvidenceRef[]=>{
    const wanted=tokens(concept);
    const candidates=sources.flatMap(source=>source.blocks.map(block=>{
      const actual=tokens(blockText(block));let score=0;
      for(const token of wanted)if([...actual].some(candidate=>candidate===token||(candidate.length>=4&&token.length>=4&&(candidate.startsWith(token)||token.startsWith(candidate)))))score++;
      return {source,block,score};
    })).filter(candidate=>candidate.score>0).sort((a,b)=>b.score-a.score||a.block.id.localeCompare(b.block.id));
    if(candidates.length)return candidates.slice(0,2).map(({source,block})=>({sourceId:source.identity.id,blockId:block.id,page:block.location.page,sectionId:block.location.sectionId,origin:'source' as const}));
    // A source title can be the only explicit occurrence of a requested focus
    // (for example, a short abstract body may say "the equation" rather than
    // repeating "Navier–Stokes"). When source fitness has already accepted that
    // title, retain a real first-block reference instead of manufacturing an
    // unsupported source-only claim.
    const titleMatch=sources.find(source=>{
      const titleTokens=tokens(source.identity.title);const wantedTokens=tokens(concept);
      return wantedTokens.size>0&&[...wantedTokens].filter(token=>[...titleTokens].some(candidate=>candidate===token||candidate.startsWith(token)||token.startsWith(candidate))).length/Math.max(1,wantedTokens.size)>=.5;
    });
    const block=titleMatch?.blocks.find(candidate=>candidate.type!=='metadata');
    return titleMatch&&block?[{sourceId:titleMatch.identity.id,blockId:block.id,page:block.location.page,sectionId:block.location.sectionId,origin:'source' as const}]:[];
  };
  const requestedSpecs:CoverageSpec[]=options.requirements??brief.mustCover.map(concept=>({concept,treatment:'explain',required:true}));
  const specs=requestedSpecs.map(spec=>({...spec,evidence:spec.evidence??(request.groundingPolicy==='general'?[]:evidenceFor(spec.concept))}));
  const initialCoverage=planCoverage(specs,duration);
  const initialHierarchy=buildLessonHierarchy(brief,duration,initialCoverage);
  const planned=planTeachingBeats(brief,initialHierarchy,initialCoverage,specs);
  return validateTeachingArchitecture({brief,duration,arc:buildNarrativeArc(brief),...planned});
}

const clipLabel=(value:string,max:number):{text:string;shortened:boolean}=>{
  if(value.length<=max)return {text:value,shortened:false};
  const cutoff=value.slice(0,Math.max(1,max-1)).trimEnd();
  const boundary=cutoff.lastIndexOf(' ');
  const safe=boundary>10?cutoff.slice(0,boundary).trimEnd():cutoff;
  return {text:`${safe}…`,shortened:true};
};
const legacyEvidenceId=(ref:EvidenceRef,index:number):string=>`p${Math.max(1,Math.floor(ref.page??1))}:c${index+1}`;

/**
 * Temporary one-way adapter into Plan v1. It cannot be used to reconstruct the
 * canonical lesson: evidence and provenance are retained in explicit sidecars.
 */
export function lowerTeachingPlan(input:TeachingArchitecturePlan):CompatibilityLowering {
  validateTeachingArchitecture(input);
  const beatById=new Map(input.beats.map(beat=>[beat.id,beat]));
  const evidenceByLegacyId:Record<string,EvidenceRef>={};
  const textProvenanceByNodeId:Record<string,TextProvenance>={};
  const textProvenanceByPath:Record<string,TextProvenance>={'plan.title':{origin:'lesson-plan',generatedBy:'teaching-plan-v1-lowering'}};
  const beatByNodeId:Record<string,string>={};
  const adaptations:CompatibilityLowering['adaptations']=[];
  let evidenceIndex=0;
  const scenes:Scene[]=input.hierarchy.scenes.map(scenePlan=>{
    const beats=scenePlan.beatIds.map(id=>beatById.get(id)).filter((beat):beat is TeachingBeat=>Boolean(beat));
    if(!beats.length)throw new Error(`Scene ${scenePlan.id} has no teaching beats`);
    if(beats.length>6)throw new Error(`Scene ${scenePlan.id} has more than six beats; repartition it before Plan v1 lowering`);
    const narration=beats.map(beat=>beat.spokenText.text).join(' ');
    if(narration.length>1800)throw new Error(`Scene ${scenePlan.id} narration exceeds the Plan v1 limit; repartition it instead of truncating`);
    const wordStarts:number[]=[];let words=0;
    for(const beat of beats){wordStarts.push(words);words+=beat.spokenText.text.trim().split(/\s+/).filter(Boolean).length;}
    const nodes:PlanNode[]=beats.map((beat,index)=>{
      const nodeId=stableId('node',scenePlan.id,beat.id);
      const label=clipLabel(beat.displayText?.text??beat.spokenText.text,64);
      if(label.shortened)adaptations.push({sceneId:scenePlan.id,kind:'label-shortened',detail:`Display text for beat ${beat.id} was shortened to the Plan v1 node limit`});
      const ids=beat.evidence.slice(0,4).map(ref=>{
        const id=legacyEvidenceId(ref,evidenceIndex++);evidenceByLegacyId[id]=ref;return id;
      });
      textProvenanceByNodeId[nodeId]=beat.displayText?.provenance??beat.spokenText.provenance;
      textProvenanceByPath[`scene.${scenePlan.id}.node.${nodeId}.label`]=textProvenanceByNodeId[nodeId];
      beatByNodeId[nodeId]=beat.id;
      return {id:nodeId,label:label.text,wordIndex:wordStarts[index],keyPoint:clipLabel(label.text,60).text,visualIntent:clean(beat.visualIntent,120),conceptId:stableId('c',beat.visualMutation.subjectId??label.text).slice(0,40),...(ids.length?{evidenceIds:ids}:{}),...(beats.length>=2&&beats.length<=4?{beatId:beat.id}:{})};
    });
    if(nodes.length===1){
      const supportId=stableId('node',scenePlan.id,'support');
      nodes.push({id:supportId,label:'Key idea',wordIndex:Math.max(0,Math.floor(words/2)),conceptId:stableId('c',scenePlan.id,'support').slice(0,40)});
      textProvenanceByNodeId[supportId]={origin:'compiler',generatedBy:'teaching-plan-v1-lowering'};
      textProvenanceByPath[`scene.${scenePlan.id}.node.${supportId}.label`]=textProvenanceByNodeId[supportId];
      beatByNodeId[supportId]=beats[0].id;
      adaptations.push({sceneId:scenePlan.id,kind:'support-node',detail:'Plan v1 requires at least two nodes; a provenance-labelled support node was added'});
    }
    const layout=beats.some(beat=>beat.role==='compare')?'compare':'flow';
    const edges=nodes.slice(1).map((node,index)=>({from:nodes[index].id,to:node.id}));
    textProvenanceByPath[`scene.${scenePlan.id}.title`]={origin:'lesson-plan',generatedBy:'teaching-plan-v1-lowering'};
    return {id:scenePlan.id,title:clipLabel(scenePlan.title,70).text,narration,layout,nodes,edges,note:'',...(beats.length>=2&&beats.length<=4?{beats:beats.map(beat=>({id:beat.id,narration:beat.spokenText.text}))}:{})};
  });
  const plan=validatePlan({version:1,title:clipLabel(input.brief.subject,90).text,scenes});
  return {plan,evidenceByLegacyId,textProvenanceByNodeId,textProvenanceByPath,beatByNodeId,adaptations};
}
