import type {CompiledSceneV2} from './types.js';
import {lintCompiledScene,type Finding} from './evaluation.js';
import {contactSheetTimes,createSheetRenderer,type SheetRenderer} from './contact-sheet.js';
import {criticRepairPrompt} from './planning/prompt-builder.js';
import type {CriticContext,CriticImage,VisionJudge} from './vision-judge.js';
import type {JsonModel} from './planning/model-adapter.js';
import {visualSceneSchema,type Schema} from './schemas.js';
import {validateVisualScene} from './planning/validate.js';
import {directVisual} from './planning/visual-director.js';
import {compileScene} from './compiler/compile-scene.js';
import type {ConceptIdentity,SemanticScenePlan,VisualSceneV2} from './types.js';
import type {VisualModel} from './planning/visual-model.js';

export interface CriticDecision {action:'accept'|'repair'|'fail';errors:string[];reason:string}
/** Pairwise judgment: the critic sees the candidate against the same context twice
 *  (A/B and B/A) so position bias is measured, not assumed away. */
export function decideFromPairwise(forward:{preferred:'A'|'B'|'tie';criticalErrors:string[];reason:string},reverse:{preferred:'A'|'B'|'tie';criticalErrors:string[];reason:string}):CriticDecision{
  const errors=[...new Set([...forward.criticalErrors,...reverse.criticalErrors])];
  if(forward.preferred==='A'&&reverse.preferred==='B')return {action:'accept',errors:[],reason:forward.reason};
  const reason=forward.preferred===reverse.preferred&&forward.preferred!=='A'?`Critic consistently rejected the candidate (${forward.reason})`:forward.reason;
  return {action:errors.length?'repair':'accept',errors,reason};
}

export interface CriticRepairDeps {
  judge:VisionJudge;
  model:JsonModel;
  registry:ConceptIdentity[];
  semantic:SemanticScenePlan;
  mentalModel:VisualModel;
  previous?:CompiledSceneV2;
  sheet?:SheetRenderer;
  context?:CriticContext;
}

const repairSchema:Schema={type:'object',additionalProperties:false,required:['scene'],properties:{scene:visualSceneSchema}};

/** One bounded critic-repair: deterministic lints first ($0), one judge call, at
 *  most one director repair call, then re-lint. Never more. */
export async function criticRepair(candidate:CompiledSceneV2,deps:CriticRepairDeps):Promise<{scene:CompiledSceneV2;decision:CriticDecision;findingsBefore:Finding[];findingsAfter:Finding[];repaired:boolean}>{
  const findingsBefore=lintCompiledScene(candidate);
  const hard=findingsBefore.filter(f=>f.severity==='hard');
  if(hard.length)throw new Error(`Deterministic preflight failed before critic: ${hard.map(f=>f.code).join(', ')}`);
  const sheet=deps.sheet??createSheetRenderer();
  const context=deps.context??{goal:deps.semantic.teachingGoal,requirements:deps.semantic.beats.map(b=>b.purpose),narration:deps.semantic.beats.map(b=>b.narrationDraft).join(' ')};
  const image=await sheet.png(candidate,'candidate');
  const baselineImage=await sheet.png(candidate,'candidate');
  const forward=await deps.judge.judge(image,baselineImage,context),reverse=await deps.judge.judge(baselineImage,image,context);
  const decision=decideFromPairwise(forward,reverse);
  if(decision.action!=='repair')return {scene:candidate,decision,findingsBefore,findingsAfter:findingsBefore,repaired:false};
  if(decision.errors.length>8)throw new Error('Critic repair instruction budget exceeded');
  const instructions=criticRepairPrompt({criticalErrors:decision.errors,reason:decision.reason});
  const previousIds=new Set(deps.previous?.objects.map(o=>o.id)??[]);
  const repaired=await deps.model.generate('director',instructions,{scene:candidate.scene,semanticScene:deps.semantic,mentalModel:deps.mentalModel,conceptRegistry:deps.registry},repairSchema,value=>{
    const visual=validateVisualScene((value as {scene:VisualSceneV2}).scene,new Set(deps.registry.map(c=>c.id)),previousIds);
    if(visual.id!==candidate.scene.id)throw new Error('Repair changed scene identity');
    if(visual.beats.length!==candidate.scene.beats.length)throw new Error('Repair changed beat count');
    for(const [i,b] of candidate.scene.beats.entries())if(visual.beats[i].id!==b.id||visual.beats[i].narration!==b.narration)throw new Error(`Repair changed narration/beat ${b.id}`);
    return {scene:visual};
  }) as {scene:VisualSceneV2};
  const scene=compileScene(repaired.scene,candidate.timing,deps.previous);
  const findingsAfter=lintCompiledScene(scene);
  const hardAfter=findingsAfter.filter(f=>f.severity==='hard');
  if(hardAfter.length)throw new Error(`Critic repair failed deterministic preflight: ${hardAfter.map(f=>f.code).join(', ')}`);
  return {scene,decision,findingsBefore,findingsAfter,repaired:true};
}
