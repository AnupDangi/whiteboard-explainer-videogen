import type {CompiledSceneV2,SemanticScenePlan,TeachingPlanV2,VisualSceneV2} from '../types.js';
import type {ConceptGraph,GateFinding,GateResult,HarnessStage,LearnerState,SemanticRegistrySnapshot,TeachingContract,WhiteboardPlan} from './contracts.js';

const result=(stage:HarnessStage,findings:GateFinding[]):GateResult=>({stage,passed:!findings.some(f=>f.severity==='hard'),findings});
const finding=(code:GateFinding['code'],stage:HarnessStage,message:string,context?:Record<string,unknown>,severity:GateFinding['severity']='hard'):GateFinding=>({code,stage,severity,message,context});

export function gateConceptGraph(graph:ConceptGraph):GateResult{
 const findings:GateFinding[]=[],keys=new Set(graph.concepts.map(c=>c.id)),evidenceIds=new Set(graph.evidence.map(e=>e.id));
 for(const [alias,key] of Object.entries(graph.aliases))if(!keys.has(key))findings.push(finding('GROUNDING','knowledge-compiler',`Alias ${alias} targets an unknown concept`,{alias,key}));
 for(const edge of graph.prerequisites)if(!keys.has(edge.before)||!keys.has(edge.after)||edge.before===edge.after)findings.push(finding('PREREQUISITE_ORDER','knowledge-compiler','Invalid prerequisite edge',edge));
 for(const evidence of graph.evidence)if(!evidence.quote.trim())findings.push(finding('GROUNDING','knowledge-compiler',`Evidence ${evidence.id} is empty`));
 for(const item of [...graph.concepts,...graph.mechanisms,...graph.quantities])for(const ref of item.evidenceRefs)if(!evidenceIds.has(ref)){const named=item as {id?:string;conceptId?:string};findings.push(finding('GROUNDING','knowledge-compiler',`${named.id??named.conceptId??'item'} references unknown evidence ${ref}`));}
 const outgoing=new Map<string,string[]>();for(const edge of graph.prerequisites)outgoing.set(edge.before,[...(outgoing.get(edge.before)??[]),edge.after]);
 const visiting=new Set<string>(),visited=new Set<string>();const visit=(key:string):boolean=>{if(visiting.has(key))return true;if(visited.has(key))return false;visiting.add(key);if((outgoing.get(key)??[]).some(visit))return true;visiting.delete(key);visited.add(key);return false;};
 if([...keys].some(visit))findings.push(finding('PREREQUISITE_ORDER','knowledge-compiler','Prerequisite graph contains a cycle'));
 return result('knowledge-compiler',findings);
}
export function gateTeachingContracts(contracts:TeachingContract[],state:LearnerState,graph:ConceptGraph):GateResult{
 const findings:GateFinding[]=[],known=new Set(state.establishedConcepts),valid=new Set(graph.concepts.map(c=>c.id)),signatures=new Set<string>();
 for(const contract of contracts){
  if(!contract.learnerDelta.after.trim()||contract.learnerDelta.after===contract.learnerDelta.before)findings.push(finding('LEARNER_DELTA','teaching-architect',`Contract ${contract.id} has no learner delta`));
  for(const prerequisite of contract.prerequisites)if(!valid.has(prerequisite)||!known.has(prerequisite))findings.push(finding('PREREQUISITE_ORDER','teaching-architect',`Prerequisite ${prerequisite} is used before it is established`,{contractId:contract.id}));
  if(contract.learnerDelta.newConcepts.length>3)findings.push(finding('COGNITIVE_LOAD','teaching-architect',`Contract ${contract.id} introduces too many concepts`,{count:contract.learnerDelta.newConcepts.length}));
  const signature=contract.narrationDraft.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(signatures.has(signature))findings.push(finding('DUPLICATION','teaching-architect',`Duplicate narration in ${contract.id}`));signatures.add(signature);
  for(const mechanism of contract.mechanismIds)if(!graph.mechanisms.some(m=>m.id===mechanism))findings.push(finding('MECHANISM_COVERAGE','teaching-architect',`Unknown mechanism ${mechanism}`));
  for(const concept of contract.learnerDelta.newConcepts)known.add(concept);for(const concept of contract.learnerDelta.reinforcedConcepts)if(valid.has(concept))known.add(concept);
 }
 return result('teaching-architect',findings);
}
export function gateWhiteboard(plan:WhiteboardPlan,semantic:SemanticScenePlan):GateResult{
 const findings:GateFinding[]=[];
 for(const beat of plan.beats){if(!beat.semanticKeys.length)findings.push(finding('VISUAL_SUPPORT','whiteboard-planner',`${beat.contractId} has narration without a semantic visual target`));}
 if(plan.beats.some(b=>b.diffs.some(d=>d.operation==='RESET'))&&!plan.resetReason)findings.push(finding('CONTINUITY','whiteboard-planner','Canvas reset has no pedagogical reason'));
 const covered=new Set(plan.beats.flatMap(b=>b.semanticKeys));for(const key of semantic.requiredConceptIds)if(!covered.has(key))findings.push(finding('VISUAL_SUPPORT','whiteboard-planner',`Required concept ${key} has no visual beat`));
 return result('whiteboard-planner',findings);
}
export function gateVisual(scene:VisualSceneV2,registry:SemanticRegistrySnapshot):GateResult{
 const findings:GateFinding[]=[],keys=new Set(registry.entries.map(e=>e.semanticKey));
 const labelFriendly=new Set(['numbered_steps','timeline','trajectory','hierarchy','simple_explanation']);
 for(const object of scene.objects){if(object.role==='decorative_support')findings.push(finding('COGNITIVE_LOAD','visual-director',`Decorative object ${object.id} is not permitted`,{},'advisory'));if(object.conceptId&&!keys.has(object.conceptId))findings.push(finding('VISUAL_SUPPORT','visual-director',`Object ${object.id} has unknown concept identity`));if(object.importance==='primary'&&['rectangle','label'].includes(object.primitiveRef??'')&&!labelFriendly.has(scene.archetype))findings.push(finding('REPRESENTATION_DEGRADATION','visual-director',`Critical object ${object.id} degraded to a generic primitive`));}
 return result('visual-director',findings);
}
export function gateCompiled(scene:CompiledSceneV2):GateResult{
 const findings:GateFinding[]=[];if(!Number.isFinite(scene.durationMs)||scene.durationMs<=0)findings.push(finding('COMPILE','compiler','Compiled duration is invalid'));
 for(const object of scene.objects)for(const value of [object.x,object.y,object.w,object.h])if(!Number.isFinite(value))findings.push(finding('COMPILE','compiler',`Object ${object.id} contains non-finite geometry`));
 for(const action of scene.actions)if(Math.abs(action.signedLagMs)>1500)findings.push(finding('TIMING','tts-alignment',`Action ${action.id} is too far from its spoken anchor`,{signedLagMs:action.signedLagMs},'advisory'));
 return result('compiler',findings);
}
export function gateLesson(plan:TeachingPlanV2,gates:GateResult[]):GateResult{
 const findings=gates.flatMap(g=>g.findings.filter(f=>f.severity==='hard'));
 const covered=new Set(plan.scenes.flatMap(s=>s.beats.flatMap(b=>b.requirementIds)));for(const requirement of [...plan.requiredClaims,...plan.requiredMechanisms])if(requirement.critical&&!covered.has(requirement.id))findings.push(finding('MECHANISM_COVERAGE','pedagogy-critic',`Critical requirement ${requirement.id} is not taught`));
 return result('pedagogy-critic',findings);
}
