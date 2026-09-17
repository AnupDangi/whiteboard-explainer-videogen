import {SUPPORTED_ARCHETYPES} from '../compiler/zones.js';
import type {BaseConceptGraph,FocusedConceptGraph} from '../knowledge/types.js';
import type {LessonPlan} from './types.js';

/** Executable teacher gate (`Architecture_plan.md` §16-25). Shapes the lesson,
 *  never the content: scene count vs duration, closed-world concept/mechanism/
 *  evidence references, prerequisite ordering, archetype support and the title
 *  policy. Pure and deterministic. */
export interface LessonGate {passed:boolean;findings:string[];advisories:string[]}

/** Approximate teacher-planner density: ~35 seconds per teaching scene
 *  (`Architecture_plan.md` §40). Guidance for the prompt and the gate; the
 *  teacher may deviate within the band. */
export function scenesForDuration(targetDurationSec:number):number{
  return Math.max(1,Math.round(targetDurationSec/35));
}

export function depthGuidance(targetDurationSec:number):string{
  if(targetDurationSec<=90)return 'orientation, one mental model, one central mechanism, main takeaway';
  if(targetDurationSec<=150)return 'add important components and one example';
  if(targetDurationSec<=360)return 'add prerequisites, the mechanism in stages, an example, one caveat and a summary';
  return 'allow context, architecture, components, step-by-step mechanism, example, interactions, limitations, implications and a summary';
}

export function gateLessonPlan(plan:LessonPlan,context:{base:BaseConceptGraph;focus:FocusedConceptGraph;requestedDurationSec:number;userPrompt:string}):LessonGate{
  const findings:string[]=[];
  /** Prerequisite edges are model-authored and noisy, so an ordering violation
   *  is reported as an advisory rather than failing the lesson (a live v3 run
   *  rejected "sunlight before chlorophyll", which is not a real dependency). */
  const advisories:string[]=[];
  const {lessonGraph,lessonBible}=plan;
  const conceptKeys=new Set([...context.base.concepts,...context.focus.concepts].map(concept=>concept.key));
  const mechanismIds=new Set(context.base.mechanisms.map(mechanism=>mechanism.id));
  const evidenceIds=new Set(context.base.evidence.map(evidence=>evidence.id));
  const supported=new Set<string>(SUPPORTED_ARCHETYPES);

  if(!lessonGraph.title.trim())findings.push('Lesson has no title');
  if(lessonGraph.title.trim().endsWith('?')&&!context.userPrompt.includes('?'))findings.push('Title is a question; the default is a direct subject title');
  if(!lessonGraph.scenes.length)findings.push('Lesson has no scenes');

  const expected=scenesForDuration(context.requestedDurationSec);
  const maxScenes=Math.max(1,Math.ceil(expected*1.5)+1);
  if(lessonGraph.scenes.length>maxScenes)findings.push(`Lesson has ${lessonGraph.scenes.length} scenes, more than the duration supports (${maxScenes})`);

  const total=lessonGraph.scenes.reduce((sum,scene)=>sum+scene.targetDurationSec,0);
  if(context.requestedDurationSec>0&&Math.abs(total-context.requestedDurationSec)>context.requestedDurationSec*0.2)findings.push(`Scene durations total ${total}s against a requested ${context.requestedDurationSec}s`);

  const appeared=new Set<string>();
  const sceneIds=new Set<string>();
  let previous=0;
  for(const scene of lessonGraph.scenes){
    if(sceneIds.has(scene.id))findings.push(`Duplicate scene id ${scene.id}`);
    sceneIds.add(scene.id);
    if(scene.sequence<=previous)findings.push(`Scene ${scene.id} sequence is not strictly increasing`);
    previous=scene.sequence;
    for(const key of scene.requiredConceptIds)if(!conceptKeys.has(key))findings.push(`Scene ${scene.id} requires unknown concept ${key}`);
    for(const key of scene.mechanismIds)if(!mechanismIds.has(key))findings.push(`Scene ${scene.id} requires unknown mechanism ${key}`);
    for(const ref of scene.evidenceRefs)if(!evidenceIds.has(ref))findings.push(`Scene ${scene.id} cites unknown evidence ${ref}`);
    for(const key of [...scene.continuityIn,...scene.continuityOut])if(!conceptKeys.has(key))findings.push(`Scene ${scene.id} continuity references unknown concept ${key}`);
    if(!scene.candidateArchetypes.length)findings.push(`Scene ${scene.id} has no candidate archetype`);
    for(const archetype of scene.candidateArchetypes)if(!supported.has(archetype))findings.push(`Scene ${scene.id} proposes unsupported archetype ${archetype}`);
    if(!scene.narrationIntent.trim())findings.push(`Scene ${scene.id} has no narration intent`);
    // Prerequisite ordering: a concept may not be required in a scene until its
    // prerequisite has been established — but a scene may introduce both
    // together (a live v3 run showed a legitimate "chloroplast hosts
    // chlorophyll" scene rejected by a stricter rule). Cross-scene ordering is
    // the enforceable contract; intra-scene beat order is not modelled.
    for(const prerequisite of context.base.prerequisites){
      if(scene.requiredConceptIds.includes(prerequisite.after)&&!appeared.has(prerequisite.before)&&!scene.requiredConceptIds.includes(prerequisite.before))advisories.push(`Scene ${scene.id} teaches ${prerequisite.after} before prerequisite ${prerequisite.before}`);
    }
    for(const key of scene.requiredConceptIds)appeared.add(key);
  }

  for(const conceptId of Object.keys(lessonBible.conceptIdentity))if(!conceptKeys.has(conceptId))findings.push(`LessonBible conceptIdentity references unknown concept ${conceptId}`);
  for(const conceptId of Object.keys(lessonBible.visualIdentity))if(!conceptKeys.has(conceptId))findings.push(`LessonBible visualIdentity references unknown concept ${conceptId}`);
  for(const conceptId of Object.keys(lessonBible.analogies))if(!conceptKeys.has(conceptId))findings.push(`LessonBible analogy references unknown concept ${conceptId}`);
  for(const key of lessonBible.persistentObjects)if(!conceptKeys.has(key))findings.push(`LessonBible persistentObjects references unknown concept ${key}`);
  for(const key of lessonGraph.continuity.persistentConceptIds)if(!conceptKeys.has(key))findings.push(`Continuity references unknown concept ${key}`);
  for(const sceneId of Object.keys(lessonBible.introducedConceptsByScene)){
    if(!sceneIds.has(sceneId))findings.push(`LessonBible introducedConceptsByScene references unknown scene ${sceneId}`);
    for(const key of lessonBible.introducedConceptsByScene[sceneId])if(!conceptKeys.has(key))findings.push(`LessonBible introducedConceptsByScene references unknown concept ${key}`);
  }
  return {passed:findings.length===0,findings,advisories};
}
