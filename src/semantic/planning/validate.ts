import {parseTeachingPlan,parseVisualScene} from '../schemas.js';
import type {TeachingPlanV2,VisualSceneV2} from '../types.js';
export function uniqueIds(items:{id:string}[],label:string):Set<string>{const ids=new Set(items.map(x=>x.id));if(ids.size!==items.length)throw new Error(`Duplicate ${label} ID`);return ids;}
function refs(values:string[],allowed:Set<string>,label:string){for(const v of values)if(!allowed.has(v))throw new Error(`Unknown ${label}: ${v}`);}
/** Teacher-voice lints: narration must read like prose teaching, never slide bullets. */
export function lintTeacherVoice(text:string,id:string):void{
  const lower=text.toLowerCase();
  if(/^\s*step\s*\d+\b|\bstep\s*(one|two|three|four|five)\b/.test(lower))throw new Error(`Meta-numbered narration (teacher voice, not steps): ${id}`);
  if(/\b(first step|second step|next slide|point number)\b/.test(lower))throw new Error(`Slide-bullet narration: ${id}`);
  const words=lower.match(/[a-z0-9']+/g)??[];
  if(words.length<6)throw new Error(`Narration too short to teach: ${id}`);
}
export function validateTeachingPlan(input:unknown):{plan:TeachingPlanV2;warnings:string[]}{
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
    refs(scene.requiredConceptIds,concepts,'concept');refs([scene.centralConceptId],new Set(scene.requiredConceptIds),'central concept');refs(scene.continuity.keepFromPrevious,prior,'previous concept');refs(scene.continuity.prepareForNext,concepts,'next concept');
    // Deterministic heal: continuity entries that name undeclared concepts (models
    // sometimes write 'mechanism_photosynthesis') are replaced by the closest declared
    // concept mentioned in the scene's own requiredConceptIds by word overlap.
    const healedContinuity:string[]=[];
    for(const id of scene.continuity.prepareForNext){
     if(concepts.has(id)){healedContinuity.push(id);continue;}
     const words=new Set(id.split(/[_-]+/));
     let best:string|undefined,bestScore=0;
     for(const c of scene.requiredConceptIds){const cw=new Set(c.split(/[_-]+/));const overlap=[...words].filter(w=>cw.has(w)).length;const score=overlap/Math.max(1,words.size);if(score>bestScore){bestScore=score;best=c;}}
     if(best&&bestScore>=.5){warnings.push(`${scene.id}: healed continuity concept ${id} -> ${best}`);healedContinuity.push(best);}
     else warnings.push(`${scene.id}: dropped unmatched continuity concept ${id}`);
    }
    scene.continuity.prepareForNext=healedContinuity;
    for(const r of scene.requiredRelations)refs([r.fromConceptId,r.toConceptId],concepts,'relation concept');
    // Deterministic heal: an empty requiredConceptIds inventory derives from the beats'
    // own introduce/reinforce/transform references plus the central concept.
    if(!scene.requiredConceptIds.length){
     const derived=new Set([scene.centralConceptId]);
     for(const b of scene.beats)for(const c of [...b.introduce,...b.reinforce,...b.transform.map(t=>t.conceptId)])if(concepts.has(c))derived.add(c);
     scene.requiredConceptIds=[...derived];
     warnings.push(`${scene.id}: derived requiredConceptIds from beat references (${scene.requiredConceptIds.length})`);
    }
    // Deterministic heal: relationFocus entries that reference undeclared relations get
    // declared from the beat's own semantics — from = the concept the beat introduces or
    // reinforces that is not the central system, to = centralConceptId, type flows_to.
    const declared=new Set(scene.requiredRelations.map(r=>r.id));
    const conceptIds=scene.requiredConceptIds;
    for(const b of scene.beats)for(const focus of b.relationFocus){
     if(declared.has(focus))continue;
     // Derive endpoints from the focus id's own words when they name registry concepts
     // (e.g. rel-sunlight-to-photosynthesis), else from the beat's introduced concepts.
     const parts=focus.split(/[_-]+/).filter(w=>w&&w!=='relation'&&w.length>1);
     const conceptWords=(c:string)=>{const cw=new Set(c.split(/[_-]+/));const concept=plan.conceptRegistry.find(x=>x.id===c);if(concept)for(const alias of [concept.canonicalName,...concept.aliases])for(const w of alias.toLowerCase().match(/[a-z0-9]+/g)??[])if(w.length>1)cw.add(w);return cw;};
     const position=(c:string)=>{const cw=conceptWords(c);let first=Infinity;parts.forEach((w,i)=>{if(cw.has(w)&&i<first)first=i;});return first;};
     const mentioned=conceptIds.filter(c=>position(c)<Infinity).sort((a,b)=>position(a)-position(b));
     const source=mentioned[0]??[...b.introduce,...b.reinforce,...b.transform.map(t=>t.conceptId)].find(c=>c!==scene.centralConceptId)??scene.centralConceptId;
     const target=mentioned.length>1?mentioned[mentioned.length-1]:scene.centralConceptId;
     scene.requiredRelations.push({id:focus,fromConceptId:source,toConceptId:target,relationType:'flows_to'});
     declared.add(focus);relations.add(focus);
     warnings.push(`${scene.id}: derived undeclared relation ${focus} (${source} -> ${target}) from beat ${b.id}`);
    }
    const signatures=new Set<string>(),seen=new Set<string>();
    for(const b of scene.beats){
      lintTeacherVoice(b.narrationDraft,b.id);
      refs(b.requirementIds,ids,'requirement');refs(b.evidenceRefs,evidence,'evidence');refs([...b.introduce,...b.reinforce,...b.transform.map(t=>t.conceptId)],concepts,'beat concept');refs(b.relationFocus,relations,'relation');
      b.requirementIds.forEach(x=>covered.add(x));b.transform.forEach(t=>{if(t.fromState===t.toState)throw new Error('State change must change state');transformed.add(t.conceptId);});
      [...b.introduce,...b.reinforce,...b.transform.map(t=>t.conceptId)].forEach(x=>seen.add(x));
      const words=new Set(b.narrationDraft.toLowerCase().match(/[a-z0-9]+/g)??[]);const signature=[...words].sort().join(' ');
      if(signatures.has(signature))throw new Error(`Duplicate beat: ${b.id}`);signatures.add(signature);
      for(const earlier of scene.beats.slice(0,scene.beats.indexOf(b))){const other=new Set(earlier.narrationDraft.toLowerCase().match(/[a-z0-9]+/g)??[]);const overlap=[...words].filter(w=>other.has(w)).length;if(overlap/new Set([...words,...other]).size>0.88)throw new Error(`Near-identical beat: ${b.id}`);}
      if(new Set([...b.introduce,...b.reinforce]).size>4)warnings.push(`${scene.id}/${b.id}: excessive concept density`);
      if(plan.evidenceRefs.length&&b.requirementIds.some(r=>requirements.find(x=>x.id===r)!.critical)&&!b.evidenceRefs.length)throw new Error(`Critical beat lacks evidence: ${b.id}`);
    }
    refs(scene.requiredConceptIds,seen,'unrepresented scene concept');
    // Deterministic heal: a declared-but-untaught relation duplicates a taught one
    // (e.g. sunlight->plant vs sunlight->leaf.top). Dropping it keeps the teaching
    // contract honest without a paid repair; a UNIQUE untaught relation still throws.
    const untaught=scene.requiredRelations.filter(r=>!scene.beats.some(b=>b.relationFocus.includes(r.id)));
    for(const r of untaught){
      const covered=scene.requiredRelations.some(o=>o!==r&&o.id!==r.id&&scene.beats.some(b=>b.relationFocus.includes(o.id))&&o.fromConceptId===r.fromConceptId&&o.toConceptId===r.toConceptId&&o.relationType===r.relationType);
      const sameFrom=scene.requiredRelations.some(o=>o.id!==r.id&&scene.beats.some(b=>b.relationFocus.includes(o.id))&&o.fromConceptId===r.fromConceptId);
      // Containment between the central system and its own subpart is taught implicitly
      // by the hero's semantic anchors; it never needs its own beat.
      const structural=r.relationType==='contains'||r.relationType==='part_of';
      if(covered||sameFrom||structural){scene.requiredRelations=scene.requiredRelations.filter(x=>x.id!==r.id);warnings.push(`${scene.id}: dropped ${structural?'implicit structural':'redundant untaught'} relation ${r.id}`);continue;}
      // Deterministic heal: attach the relation to the beat whose narration mentions both
      // endpoints' concept vocabulary (id words, canonical name, aliases).
      const vocab=(id:string)=>{
       const words=new Set(id.split(/[_-]+/));
       const concept=concepts.has(id)?plan.conceptRegistry.find(c=>c.id===id):undefined;
       if(concept)for(const name of [concept.canonicalName,...concept.aliases])for(const w of name.toLowerCase().match(/[a-z0-9]+/g)??[])words.add(w);
       return words;
      };
      const fromWords=vocab(r.fromConceptId),toWords=vocab(r.toConceptId);
      const beat=scene.beats.find(b=>{const words=new Set(b.narrationDraft.toLowerCase().match(/[a-z0-9]+/g)??[]);return [...fromWords].every(w=>words.has(w))&&[...toWords].some(w=>words.has(w));});
      if(beat){beat.relationFocus.push(r.id);warnings.push(`${scene.id}: attached untaught relation ${r.id} to beat ${beat.id}`);}
      else throw new Error(`Untaught relation: ${r.id}`);
    }
    scene.requiredConceptIds.forEach(c=>prior.add(c));
  }
  // Deterministic heal: a critical requirement declared but never attached to a beat
  // is attached to the beat whose narration shares the most words with the statement,
  // when that overlap is decisive. A truly untaught requirement still throws.
  for(const r of requirements){
   if(!r.critical||covered.has(r.id))continue;
   const statementWords:string[]=(r.statement.toLowerCase().match(/[a-z0-9]+/g)??[]);
   let best:{beat:typeof plan.scenes[number]['beats'][number];score:number}|undefined;
   for(const scene of plan.scenes)for(const b of scene.beats){
    const words=new Set(b.narrationDraft.toLowerCase().match(/[a-z0-9]+/g)??[]);
    const overlap=statementWords.filter(w=>words.has(w)).length;
    const score=overlap/Math.max(1,statementWords.length);
    if(!best||score>best.score)best={beat:b,score};
   }
   if(best&&best.score>=.3){best.beat.requirementIds.push(r.id);covered.add(r.id);warnings.push(`healed: attached uncovered critical requirement ${r.id} to beat ${best.beat.id}`);}
   else throw new Error(`Uncovered critical requirement: ${r.id}`);
  }
  for(const m of plan.requiredMechanisms)if(m.requiresStateChange&&!m.conceptIds.some(c=>transformed.has(c)))throw new Error(`Unrepresented state mechanism: ${m.id}`);
  return {plan,warnings};
}
export function validateVisualScene(input:unknown,conceptIds?:Set<string>,previousObjectIds=new Set<string>()):VisualSceneV2{
  const s=parseVisualScene(input),objects=uniqueIds(s.objects,'object'),relations=uniqueIds(s.relations,'relation');uniqueIds(s.beats,'beat');uniqueIds(s.beats.flatMap(b=>b.actions),'action');
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
