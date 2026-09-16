import {parseTeachingPlan,parseVisualScene} from '../schemas.js';
import {segmentWords} from '../../shared/language.js';
import {log} from '../../shared/logger.js';
import type {TeachingPlanV2,VisualSceneV2} from '../types.js';
export function uniqueIds(items:{id:string}[],label:string):Set<string>{const ids=new Set(items.map(x=>x.id));if(ids.size!==items.length)throw new Error(`Duplicate ${label} ID`);return ids;}
const normalizeWord=(w:string)=>w.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const wordsOf=(text:string)=>segmentWords(text).map(normalizeWord).filter(Boolean);
function refs(values:string[],allowed:Set<string>,label:string){for(const v of values)if(!allowed.has(v))throw new Error(`Unknown ${label}: ${v}`);}
/** Teacher-voice lints: narration must read like prose teaching, never slide bullets. */
export function lintTeacherVoice(text:string,id:string):void{
  const lower=text.toLowerCase();
  if(/^\s*step\s*\d+\b|\bstep\s*(one|two|three|four|five)\b/.test(lower))throw new Error(`Meta-numbered narration (teacher voice, not steps): ${id}`);
  if(/\b(first step|second step|next slide|point number)\b/.test(lower))throw new Error(`Slide-bullet narration: ${id}`);
  const words=wordsOf(text);
  if(words.length<6)throw new Error(`Narration too short to teach: ${id}`);
}
export function validateTeachingPlan(input:unknown,priorConcepts:ReadonlySet<string>=new Set()):{plan:TeachingPlanV2;warnings:string[]}{
  const plan=parseTeachingPlan(input),warnings:string[]=[];
  const concepts=uniqueIds(plan.conceptRegistry,'concept'),evidence=uniqueIds(plan.evidenceRefs,'evidence');
  uniqueIds(plan.scenes,'scene');
  const requirements=[...plan.requiredClaims,...plan.requiredMechanisms],ids=uniqueIds(requirements,'requirement');
  const covered=new Set<string>(),transformed=new Set<string>(),aliases=new Map<string,string>();
  for(const c of plan.conceptRegistry){refs(c.evidenceRefs,evidence,'evidence');for(const name of [c.canonicalName,...c.aliases]){const key=name.toLowerCase().trim();if(aliases.has(key)&&aliases.get(key)!==c.id)throw new Error(`Ambiguous concept alias: ${name}`);aliases.set(key,c.id);}}
  for(const r of requirements)refs(r.evidenceRefs,evidence,'evidence');
  for(const m of plan.requiredMechanisms)refs(m.conceptIds,concepts,'concept');
  const prior=new Set<string>();
  for(const scene of plan.scenes){
    uniqueIds(scene.beats,'beat');const relations=uniqueIds(scene.requiredRelations,'relation');
    refs(scene.requiredConceptIds,concepts,'concept');refs([scene.centralConceptId],new Set(scene.requiredConceptIds),'central concept');refs(scene.continuity.keepFromPrevious,new Set([...priorConcepts,...prior]),'previous concept');refs(scene.continuity.prepareForNext,concepts,'next concept');
    for(const r of scene.requiredRelations)refs([r.fromConceptId,r.toConceptId],new Set(scene.requiredConceptIds),'relation concept');
    // Deterministic heal: models smuggle requirement ids into relationFocus; drop those,
    // then attach any untaught required relation to a beat that covers both endpoints.
    for(const b of scene.beats){const kept=b.relationFocus.filter(id=>relations.has(id));if(kept.length!==b.relationFocus.length){warnings.push(`${scene.id}/${b.id}: relation-focus healed, non-relation ids dropped`);b.relationFocus=kept;}}
    for(const r of scene.requiredRelations)if(!scene.beats.some(beat=>beat.relationFocus.includes(r.id))){
      const beat=scene.beats.find(b=>{const covered=new Set([...b.introduce,...b.reinforce,...b.transform.map(t=>t.conceptId)]);return covered.has(r.fromConceptId)&&covered.has(r.toConceptId);});
      if(!beat)throw new Error(`Untaught relation: ${r.id}`);
      beat.relationFocus.push(r.id);warnings.push(`${scene.id}: relation ${r.id} attached to ${beat.id} (relation-focus healed)`);
    }
    const signatures=new Set<string>(),seen=new Set<string>();
    for(const b of scene.beats){
      lintTeacherVoice(b.narrationDraft,b.id);
      refs(b.requirementIds,ids,'requirement');refs(b.evidenceRefs,evidence,'evidence');refs([...b.introduce,...b.reinforce,...b.transform.map(t=>t.conceptId)],concepts,'beat concept');refs(b.relationFocus,relations,'relation');
      b.requirementIds.forEach(x=>covered.add(x));b.transform.forEach(t=>{if(t.fromState===t.toState)throw new Error('State change must change state');transformed.add(t.conceptId);});
      [...b.introduce,...b.reinforce,...b.transform.map(t=>t.conceptId)].forEach(x=>seen.add(x));
      const words=new Set(wordsOf(b.narrationDraft));const signature=[...words].sort().join(' ');
      if(signatures.has(signature))throw new Error(`Duplicate beat: ${b.id}`);signatures.add(signature);
      for(const earlier of scene.beats.slice(0,scene.beats.indexOf(b))){const other=new Set(wordsOf(earlier.narrationDraft));const overlap=[...words].filter(w=>other.has(w)).length;if(overlap/new Set([...words,...other]).size>0.88)throw new Error(`Near-identical beat: ${b.id}`);}
      if(new Set([...b.introduce,...b.reinforce]).size>4)warnings.push(`${scene.id}/${b.id}: excessive concept density`);
      if(plan.evidenceRefs.length&&b.requirementIds.some(r=>requirements.find(x=>x.id===r)!.critical)&&!b.evidenceRefs.length)throw new Error(`Critical beat lacks evidence: ${b.id}`);
    }
    refs(scene.requiredConceptIds,seen,'unrepresented scene concept');
    scene.requiredConceptIds.forEach(c=>prior.add(c));
  }
  for(const r of requirements)if(r.critical&&!covered.has(r.id))throw new Error(`Uncovered critical requirement: ${r.id}`);
  for(const m of plan.requiredMechanisms)if(m.requiresStateChange&&!m.conceptIds.some(c=>transformed.has(c)))throw new Error(`Unrepresented state mechanism: ${m.id}`);
  return {plan,warnings};
}
export function validateVisualScene(input:unknown,conceptIds?:Set<string>,previousObjectIds=new Set<string>()):VisualSceneV2{
  const s=parseVisualScene(input),objects=uniqueIds(s.objects,'object'),relations=uniqueIds(s.relations,'relation');uniqueIds(s.beats,'beat');uniqueIds(s.beats.flatMap(b=>b.actions),'action');
  if(s.continuity.transitions){const concepts=new Set(s.objects.map(o=>o.conceptId).filter((id):id is string=>Boolean(id)));const seen=new Set<string>();for(const transition of s.continuity.transitions){if(transition.action!=='REMOVE'&&!concepts.has(transition.conceptId))throw new Error(`Unknown continuity concept: ${transition.conceptId}`);if(seen.has(transition.conceptId))throw new Error(`Duplicate continuity decision: ${transition.conceptId}`);seen.add(transition.conceptId);if(transition.action==='TRANSFORM'&&(!transition.fromState||!transition.toState||transition.fromState===transition.toState))throw new Error(`Transform continuity requires distinct states: ${transition.conceptId}`);if(transition.action==='REPLACE'&&!transition.toRepresentation)throw new Error(`Replace continuity requires target representation: ${transition.conceptId}`);}}
  refs(s.continuity.keepFromPrevious,previousObjectIds,'previous object');refs(s.continuity.keepFromPrevious,objects,'persistent object');
  // Deterministic heal: prepareForNext may name concepts instead of object ids; map
  // concept references to a matching object, drop unmatched entries (advisory hint).
  const conceptToObject=new Map(s.objects.filter(o=>o.conceptId).map(o=>[o.conceptId!,o.id]));
  s.continuity.prepareForNext=s.continuity.prepareForNext.map(id=>objects.has(id)?id:conceptToObject.get(id)).filter((id):id is string=>Boolean(id));
  for(const o of s.objects){
    if(conceptIds&&o.conceptId)refs([o.conceptId],conceptIds,'concept');
    if(Boolean(o.assetRef)===Boolean(o.primitiveRef))throw new Error(`Object ${o.id} needs exactly one asset or primitive`);
    if(!o.allowedStates.includes(o.state))throw new Error(`Invalid object state: ${o.id}`);
    refs(o.children,objects,'child');if(o.parentId)refs([o.parentId],objects,'parent');
    const visited=new Set([o.id]);let parent=o.parentId;
    while(parent){if(visited.has(parent))throw new Error('Parent cycle');visited.add(parent);const p=s.objects.find(x=>x.id===parent)!;if(!p.children.includes(o.id)&&parent===o.parentId)throw new Error('Parent/child mismatch');parent=p.parentId;}
    for(const c of o.children)if(s.objects.find(x=>x.id===c)!.parentId!==o.id)throw new Error('Child/parent mismatch');
    if(['contain','overlay','touch'].includes(o.collisionPolicy)&&!o.parentId)throw new Error('Relative collision policy requires parent');
  }
  for(const r of s.relations)refs([r.from.objectId,r.to.objectId],objects,'relation object');
  for(const b of s.beats)for(const a of b.actions){
    refs(a.objectIds,objects,'action object');refs(a.relationIds,relations,'action relation');
    /** Mechanical target-kind heal, scoped to actions the rules below would
     *  actually reject. The direction contract lets a model attach a relation
     *  reference to an object/state action (or object refs to a relation
     *  action); the resolved action then carries the wrong target kind and is
     *  rejected as unrenderable, which killed the live job twice. Actions that
     *  legitimately target both kinds (pulse/highlight on a relation) are left
     *  untouched. Recorded, never silent. */
    if(['trace','flow'].includes(a.type)&&a.objectIds.length){log('v2.direction.action-kind-heal',{action:a.id,type:a.type,dropped:'object-targets',count:a.objectIds.length},'warn');a.objectIds=[];}
    else if(['draw','reveal','fill'].includes(a.type)&&a.relationIds.length){
     if(a.objectIds.length){log('v2.direction.action-kind-heal',{action:a.id,type:a.type,dropped:'relation-targets',count:a.relationIds.length},'warn');a.relationIds=[];}
     else{log('v2.direction.action-kind-heal',{action:a.id,from:a.type,to:'flow',reason:'object action with relation-only target'},'warn');a.type='flow';}
    }
    else if(['replace','morph'].includes(a.type)){
     if(!a.objectIds.length&&a.relationIds.length){log('v2.direction.action-kind-heal',{action:a.id,from:a.type,to:'flow',reason:'state action with relation-only target'},'warn');a.type='flow';}
     else if(a.objectIds.length&&!a.toState){log('v2.direction.action-kind-heal',{action:a.id,from:a.type,to:'highlight',reason:'state action without toState'},'warn');a.type='highlight';}
    }
    if(!a.objectIds.length&&!a.relationIds.length)throw new Error('Action has no target');
    if(['trace','flow'].includes(a.type)&&(!a.relationIds.length||a.objectIds.length))throw new Error('Trace/flow require relation targets only');
    if(['draw','reveal','fill'].includes(a.type)&&(!a.objectIds.length||a.relationIds.length))throw new Error('Object action requires object targets only');
    if(a.type==='move'&&!a.destination)throw new Error('Move requires destination');
    if(['replace','morph'].includes(a.type)&&!a.toState)throw new Error('State action requires toState');
    for(const id of a.objectIds){const o=s.objects.find(x=>x.id===id)!;for(const state of [a.fromState,a.toState])if(state&&!o.allowedStates.includes(state))throw new Error(`Unsupported state: ${state}`);}
  }
  for(const o of s.objects){
   if(o.role==='decorative_support'||s.continuity.keepFromPrevious.includes(o.id))continue;
   if(s.beats.some(b=>b.actions.some(a=>a.objectIds.includes(o.id)&&['draw','reveal'].includes(a.type))))continue;
   // Deterministic heal: give the object a reveal in its first targeting beat.
   const beat=s.beats.find(b=>b.actions.some(a=>a.objectIds.includes(o.id)));
   if(!beat)throw new Error(`Required object never appears: ${o.id}`);
   beat.actions.unshift({id:`reveal_${o.id}_healed`,type:'reveal',objectIds:[o.id],relationIds:[],durationMs:800,leadMs:-180,easing:'linear'});
  }
  return s;
}
