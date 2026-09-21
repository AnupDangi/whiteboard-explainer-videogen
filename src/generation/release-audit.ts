import {subjectFromInstruction} from '../planning/teaching-planner.js';


interface LessonReleaseAuditInput {
  title:string;
  instruction?:string;
  narration:string;
  targetMs:number;
  actualMs:number;
  scenes?:Array<{narration:string;nodes?:Array<{label?:string;shape?:string}>;timing?:{durationMs:number}}>;
  requiredConcepts?:string[];
  learnerLevel?:string;
}

interface LessonReleaseAudit {
  version:1;
  ok:boolean;
  findings:string[];
  title:string;
  targetMs:number;
  actualMs:number;
  durationDeltaMs:number;
}

const SYNTHETIC_TITLE=/^(?:text|prompt|source|inline|unknown)(?::|$)/i;
const BAD_NARRATION=[
  /\btext:text\b/i,
  /\bprompt:prompt\b/i,
  /\bthe lesson explains\b/i,
  /\bpeople darkweb\b/i,
  /\bspiritual build trust blind\b/i,
];
const TEACHER_OPENING=/\b(?:today|first|now|next|we\s+(?:will|are|begin|start)|let(?:'|’)s|in this lesson)\b/i;
const STOP_WORDS=new Set(['a','an','the','and','or','to','of','for','with','how','why','what','is','are','can','does','do','this','that','learn','teach','explain']);

function meaningfulTokens(value:string):string[]{
  return value.toLocaleLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g)?.filter(token=>!STOP_WORDS.has(token))??[];
}

/** Validate intent, teacher-like orientation, and the exact timeline before MP4 export. */
export function auditLessonRelease(input:LessonReleaseAuditInput):LessonReleaseAudit {
  const findings:string[]=[];
  const instruction=input.instruction?.trim()??'';
  const title=input.title.trim();
  const sceneNarration=(input.scenes??[]).map(scene=>scene.narration.trim()).filter(Boolean);
  const narration=(sceneNarration.length?sceneNarration:[input.narration.trim()]).join(' ');
  if(input.scenes){
    if(!input.scenes.length)findings.push('no-scenes');
    if(input.scenes.some(scene=>!scene.narration.trim()))findings.push('empty-scene-narration');
    if(input.scenes.some(scene=>scene.nodes!==undefined&&scene.nodes.length<2))findings.push('scene-missing-visual-anchors');
    if(input.scenes.some(scene=>scene.timing&&(!Number.isFinite(scene.timing.durationMs)||scene.timing.durationMs<=0)))findings.push('invalid-scene-timing');
  }
  if(instruction&&SYNTHETIC_TITLE.test(title))findings.push('synthetic-title');
  if(instruction){
    const subject=subjectFromInstruction(instruction);
    const subjectTokens=meaningfulTokens(subject);
    const titleTokens=new Set(meaningfulTokens(title));
    const overlap=subjectTokens.filter(token=>titleTokens.has(token)).length;
    if(subjectTokens.length&&!overlap)findings.push('title-does-not-reflect-instruction');
  }
  if(!TEACHER_OPENING.test(narration))findings.push('missing-teacher-orientation');
  if(BAD_NARRATION.some(pattern=>pattern.test(narration)))findings.push('generic-or-tokenized-narration');
  if(input.requiredConcepts?.length){
    const full=meaningfulTokens(`${title} ${narration}`).join(' ');
    for(const concept of input.requiredConcepts){const tokens=meaningfulTokens(concept);if(tokens.length&&!tokens.some(token=>full.includes(token)))findings.push(`missing-required-concept:${concept}`);}
  }
  if(!Number.isFinite(input.targetMs)||!Number.isFinite(input.actualMs)||Math.abs(input.actualMs-input.targetMs)>250)
    findings.push('duration-outside-release-tolerance');
  return {
    version:1,
    ok:findings.length===0,
    findings,
    title,
    targetMs:input.targetMs,
    actualMs:input.actualMs,
    durationDeltaMs:input.actualMs-input.targetMs,
  };
}
