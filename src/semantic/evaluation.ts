import type {CompiledSceneV2} from './types.js';
import {BOARD} from './compiler/zones.js';
import {contains,findCollisions} from './compiler/collisions.js';
import {visualBounds} from './compiler/text.js';
import {resolveAsset} from './assets/registry.js';
import {staticIntervals} from './compiler/timeline.js';
import {MAX_STATIC_INTERVAL_MS} from '../shared/language.js';
export interface Finding {code:string;severity:'hard'|'advisory';message:string}
/** These are deterministic engineering checks, never a substitute for teaching-quality judgment. */
export function lintCompiledScene(scene:CompiledSceneV2):Finding[]{
 const findings:Finding[]=[],fail=(code:string,message:string)=>findings.push({code,severity:'hard',message});
 for(const o of scene.objects){if(![o.x,o.y,o.w,o.h,o.fontSize].every(Number.isFinite))fail('nonfinite',o.id);else if(!contains(BOARD.safe,visualBounds(o)))fail('clipping',o.id);if(o.fontSize<18)fail('text-size',o.id);if(o.assetRef){try{resolveAsset(o.assetRef,scene.assetCatalog);}catch{fail('missing-asset',o.id);}}}
 for(const pair of findCollisions(scene.objects))fail('text-or-object-collision',pair);
 const ids=new Set(scene.objects.map(o=>o.id)),relations=new Set(scene.relations.map(r=>r.id));
 for(const a of scene.actions){if(![a.startMs,a.durationMs].every(Number.isFinite)||a.startMs<0||a.durationMs<=0||a.startMs+a.durationMs>scene.durationMs)fail('action-window',a.id);if(a.objectIds.some(id=>!ids.has(id))||a.relationIds.some(id=>!relations.has(id)))fail('action-target',a.id);}
 for(const r of scene.relations){const from=scene.objects.find(o=>o.id===r.from.objectId)?.anchors[r.from.anchor],to=scene.objects.find(o=>o.id===r.to.objectId)?.anchors[r.to.anchor];if(!from||!to||r.points.some(p=>![p.x,p.y].every(Number.isFinite)))fail('relation-anchor',r.id);else if(JSON.stringify(r.points[0])!==JSON.stringify(from)||JSON.stringify(r.points.at(-1))!==JSON.stringify(to))fail('relation-endpoint',r.id);}
 const gaps=staticIntervals(scene.scene,scene.timing,scene.actions);for(const gap of gaps)if(gap.endMs-gap.startMs>MAX_STATIC_INTERVAL_MS)findings.push({code:'static-interval',severity:'advisory',message:`${Math.round(gap.endMs-gap.startMs)}ms at ${Math.round(gap.startMs)}ms`});
 return findings;
}
/** Asset/concept relationships are compared semantically, never by pixel equality or object ID spelling. */
export function evaluatePlant(scene:CompiledSceneV2):{pass:boolean;checks:Record<string,boolean>;findings:Finding[]}{
 const plant=scene.objects.find(o=>o.assetRef==='biology.plant.sapling.v2'&&o.role==='hero'),water=scene.objects.find(o=>o.assetRef==='nature.water.v2'),sun=scene.objects.find(o=>o.assetRef==='nature.sun.v2'),co2=scene.objects.find(o=>o.assetRef==='chemistry.co2.v2');
 const connects=(id:string|undefined,anchors:string[])=>Boolean(plant&&id&&scene.relations.some(r=>r.from.objectId===id&&r.to.objectId===plant.id&&anchors.includes(r.to.anchor)&&['arrow','flow'].includes(r.visualForm)));
 const normalized=(s:string)=>s.normalize('NFKC').toLowerCase();
 const checks={plantHero:Boolean(plant),sunlight:Boolean(sun),water:Boolean(water),carbonDioxide:Boolean(co2),waterToRoots:connects(water?.id,['roots']),sunlightToLeaf:connects(sun?.id,['leaf.top','leaf.left','leaf.right','leaf.side','canopy']),carbonToLeaf:connects(co2?.id,['leaf.top','leaf.left','leaf.right','leaf.side','canopy']),carbonLabelCorrect:Boolean(co2&&(/carbon dioxide|co2/.test(normalized(co2.label)))),noGenericBoxes:!scene.objects.some(o=>o.primitiveRef==='rectangle'),structuralModel:['structural_diagram','convergence'].includes(scene.scene.archetype)};
 const findings=lintCompiledScene(scene);return {pass:Object.values(checks).every(Boolean)&&!findings.some(f=>f.severity==='hard'),checks,findings};
}
export interface PairwiseJudgment {preferred:'A'|'B'|'tie';criticalErrors:string[];reason:string}
export interface CalibrationPair {corruption:string;forward:PairwiseJudgment;reverse:PairwiseJudgment}
export function judgeCalibration(pairs:CalibrationPair[]):{reliable:boolean;misses:string[];inconsistent:string[]}{
 const misses=pairs.filter(p=>p.forward.preferred!=='A'||p.reverse.preferred!=='B').map(p=>p.corruption),inconsistent=pairs.filter(p=>p.forward.preferred===p.reverse.preferred&&p.forward.preferred!=='tie').map(p=>p.corruption);
 return {reliable:pairs.length>=8&&!misses.length,misses,inconsistent};
}
export const CRITIC_RUBRIC=['teaching clarity','representation correctness','hero clarity','relationship correctness','layout and hierarchy','readability','continuity','semantic motion','asset appropriateness'] as const;
/** One repair at most; caller supplies a calibrated judge and a semantic-only repair stage. */
export async function reviewAndRepair<T>(candidate:T,options:{lint:(v:T)=>Finding[];judge:(v:T)=>Promise<{needsRepair:boolean;instructions:string[]}>;repair:(v:T,instructions:string[])=>Promise<T>}):Promise<{value:T;repairs:number;findings:Finding[]}>{
 const before=options.lint(candidate);if(before.some(f=>f.severity==='hard'))throw new Error('Deterministic preflight failed before critic');
 const judgment=await options.judge(candidate);if(!judgment.needsRepair)return {value:candidate,repairs:0,findings:before};if(judgment.instructions.length>8)throw new Error('Critic repair instruction budget exceeded');
 const repaired=await options.repair(candidate,judgment.instructions),after=options.lint(repaired);if(after.some(f=>f.severity==='hard'))throw new Error('Critic repair failed deterministic preflight');return {value:repaired,repairs:1,findings:after};
}
