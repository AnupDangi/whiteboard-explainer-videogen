import {createHash} from 'node:crypto';
import {RELATIONS} from '../types.js';
import type {BaseConceptGraph,FocusedConceptGraph,FragmentConcept,FragmentRelation,FragmentClaim,FragmentMechanism,FragmentPrerequisite,FragmentTerm,FragmentEvidence,GraphFragment} from './types.js';

/** Deterministic reducer (`Architecture_plan.md` §13). The LLM reducer may
 *  canonicalize, but this function is the guarantee: it never invents content,
 *  drops every claim/mechanism that lacks valid source evidence, and produces a
 *  stable hash for caching. No network, no clock, no randomness, no locale-
 *  dependent ordering (plain ASCII compares only). */
const RELATION_TYPES=new Set<string>(RELATIONS);
const cmp=(a:string,b:string):number=>(a<b?-1:a>b?1:0);

export function reduceFragments(fragments:GraphFragment[]):BaseConceptGraph{
  const evidence=mergeEvidence(fragments);
  const evidenceIds=new Set(evidence.map(item=>item.id));
  const prune=(refs:string[]):string[]=>[...new Set(refs??[])].filter(ref=>evidenceIds.has(ref));
  const concepts=mergeConcepts(fragments);
  const conceptKeys=new Set(concepts.map(concept=>concept.key));
  const relations=dedupeRelations(fragments)
    .filter(relation=>RELATION_TYPES.has(relation.type)&&conceptKeys.has(relation.from)&&conceptKeys.has(relation.to))
    .map(relation=>({...relation,evidenceRefs:prune(relation.evidenceRefs)}));
  // §57: an unsupported factual claim is rejected, never guessed. Dangling
  // evidence refs are pruned; a claim left with none is dropped.
  const claims=dedupeClaims(fragments)
    .map(claim=>({...claim,evidenceRefs:prune(claim.evidenceRefs)}))
    .filter(claim=>claim.evidenceRefs.length>0);
  const mechanisms=dedupeMechanisms(fragments)
    .map(mechanism=>({...mechanism,evidenceRefs:prune(mechanism.evidenceRefs),conceptKeys:mechanism.conceptKeys.filter(key=>conceptKeys.has(key))}))
    .filter(mechanism=>mechanism.evidenceRefs.length>0&&mechanism.conceptKeys.length>0);
  const prerequisites=dedupePrerequisites(fragments).filter(edge=>conceptKeys.has(edge.before)&&conceptKeys.has(edge.after)&&edge.before!==edge.after);
  const terminology=mergeTerminology(fragments);
  const degree=new Map<string,number>();
  for(const concept of concepts)degree.set(concept.key,0);
  for(const relation of relations){degree.set(relation.from,(degree.get(relation.from)??0)+1);degree.set(relation.to,(degree.get(relation.to)??0)+1);}
  const centralConcepts=[...degree.entries()].sort((a,b)=>b[1]-a[1]||cmp(a[0],b[0])).slice(0,3).filter(entry=>entry[1]>0).map(entry=>entry[0]);
  const thesis=claims.find(claim=>claim.critical)?.statement??[...claims].sort((a,b)=>b.statement.length-a.statement.length||cmp(a.id,b.id))[0]?.statement??'';
  return {version:1,concepts,relations,claims,mechanisms,prerequisites,terminology,evidence,centralConcepts,thesis};
}

export function baseGraphHash(graph:BaseConceptGraph):string{
  const canonical={...graph,centralConcepts:[...graph.centralConcepts].sort(cmp)};
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface GraphGate {passed:boolean;findings:string[]}

/** Executable knowledge gate: evidence integrity, prerequisite acyclicity and a
 *  non-empty graph. Mirrors `harness/gates.ts` semantics for the v3 front end. */
export function gateBaseGraph(graph:BaseConceptGraph):GraphGate{
  const findings:string[]=[];
  const evidenceIds=new Set((graph.evidence??[]).map(item=>item.id));
  const conceptKeys=new Set((graph.concepts??[]).map(concept=>concept.key));
  if(!graph.concepts?.length)findings.push('Graph has no concepts');
  for(const claim of graph.claims??[])if(!claim.evidenceRefs.some(ref=>evidenceIds.has(ref)))findings.push(`Claim ${claim.id} has no valid evidence`);
  for(const mechanism of graph.mechanisms??[])if(!mechanism.evidenceRefs.some(ref=>evidenceIds.has(ref)))findings.push(`Mechanism ${mechanism.id} has no valid evidence`);
  for(const relation of graph.relations??[])if(!conceptKeys.has(relation.from)||!conceptKeys.has(relation.to))findings.push(`Relation ${relation.from}->${relation.to} references an unknown concept`);
  if(hasCycle(graph.prerequisites??[]))findings.push('Prerequisite graph contains a cycle');
  return {passed:findings.length===0,findings};
}

/** Narrow the immutable base graph to a lesson focus. Deterministic term match
 *  plus one hop of neighbours; falls back to the central concepts when the
 *  prompt matches nothing, so focus can never empty the lesson. Claims and
 *  mechanisms are scoped to the surviving concepts when they declare concept
 *  links; a claim with no concept link is kept (it cannot be scoped safely). */
export function focusGraph(base:BaseConceptGraph,userPrompt:string):FocusedConceptGraph{
  const terms=new Set(userPrompt.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)??[]);
  const matched=new Set<string>();
  for(const concept of base.concepts){
    const names=[concept.key,concept.canonicalName,...concept.aliases].map(name=>name.toLowerCase());
    if(names.some(name=>terms.has(name)))matched.add(concept.key);
  }
  const focusKeys=new Set(matched.size?matched:base.centralConcepts);
  const neighbours=new Set(focusKeys);
  for(const relation of base.relations){if(focusKeys.has(relation.from))neighbours.add(relation.to);if(focusKeys.has(relation.to))neighbours.add(relation.from);}
  const keep=neighbours.size?neighbours:new Set(base.concepts.map(concept=>concept.key));
  const evidenceIds=new Set(base.evidence.map(item=>item.id));
  const concepts=base.concepts.filter(concept=>keep.has(concept.key));
  return {
    version:1,
    baseHash:baseGraphHash(base),
    focus:userPrompt,
    concepts,
    relations:base.relations.filter(relation=>keep.has(relation.from)&&keep.has(relation.to)),
    claims:base.claims.filter(claim=>claim.evidenceRefs.some(ref=>evidenceIds.has(ref))&&(claim.conceptKeys?claim.conceptKeys.some(key=>keep.has(key)):true)),
    mechanisms:base.mechanisms
      .filter(mechanism=>mechanism.conceptKeys.some(key=>keep.has(key)))
      .map(mechanism=>({...mechanism,conceptKeys:mechanism.conceptKeys.filter(key=>keep.has(key))})),
    prerequisites:base.prerequisites.filter(edge=>keep.has(edge.before)&&keep.has(edge.after)),
    terminology:base.terminology.filter(term=>keep.has(term.key)),
  };
}

function mergeEvidence(fragments:GraphFragment[]):FragmentEvidence[]{
  const byId=new Map<string,FragmentEvidence>();
  for(const fragment of fragments)for(const item of fragment.evidence??[]){
    if(!item.quote?.trim())continue;
    const existing=byId.get(item.id);
    if(!existing)byId.set(item.id,item);
    else if(!existing.section&&item.section)existing.section=item.section;
  }
  return [...byId.values()].sort((a,b)=>cmp(a.id,b.id));
}
function mergeConcepts(fragments:GraphFragment[]):FragmentConcept[]{
  const byKey=new Map<string,FragmentConcept>();
  for(const fragment of fragments)for(const concept of fragment.concepts??[]){
    const existing=byKey.get(concept.key);
    if(!existing){byKey.set(concept.key,{...concept,aliases:[...new Set(concept.aliases??[])],evidenceRefs:[...new Set(concept.evidenceRefs??[])]});continue;}
    existing.aliases=[...new Set([...existing.aliases,...(concept.aliases??[])])];
    existing.evidenceRefs=[...new Set([...existing.evidenceRefs,...(concept.evidenceRefs??[])])];
  }
  return [...byKey.values()].sort((a,b)=>cmp(a.key,b.key));
}
function dedupeRelations(fragments:GraphFragment[]):FragmentRelation[]{
  const seen=new Map<string,FragmentRelation>();
  for(const fragment of fragments)for(const relation of fragment.relations??[]){
    const key=`${relation.from}|${relation.type}|${relation.to}`;
    const existing=seen.get(key);
    if(existing)existing.evidenceRefs=[...new Set([...existing.evidenceRefs,...(relation.evidenceRefs??[])])];
    else seen.set(key,{...relation,evidenceRefs:[...new Set(relation.evidenceRefs??[])]});
  }
  return [...seen.values()].sort((a,b)=>cmp(a.from+a.to+a.type,b.from+b.to+b.type));
}
function dedupeClaims(fragments:GraphFragment[]):FragmentClaim[]{
  const seen=new Map<string,FragmentClaim>();
  for(const fragment of fragments)for(const claim of fragment.claims??[]){
    const key=claim.statement.toLowerCase().replace(/\s+/g,' ').trim();
    const existing=seen.get(key);
    if(existing){
      existing.critical=existing.critical||claim.critical;
      existing.evidenceRefs=[...new Set([...existing.evidenceRefs,...claim.evidenceRefs])];
      if(claim.conceptKeys)existing.conceptKeys=[...new Set([...(existing.conceptKeys??[]),...claim.conceptKeys])];
    }
    else seen.set(key,{...claim,evidenceRefs:[...new Set(claim.evidenceRefs??[])],...(claim.conceptKeys?{conceptKeys:[...new Set(claim.conceptKeys)]}:{})});
  }
  return [...seen.values()].sort((a,b)=>cmp(a.id,b.id));
}
function dedupeMechanisms(fragments:GraphFragment[]):FragmentMechanism[]{
  const seen=new Map<string,FragmentMechanism>();
  for(const fragment of fragments)for(const mechanism of fragment.mechanisms??[]){
    const existing=seen.get(mechanism.id);
    if(existing){existing.conceptKeys=[...new Set([...existing.conceptKeys,...mechanism.conceptKeys])];existing.evidenceRefs=[...new Set([...existing.evidenceRefs,...mechanism.evidenceRefs])];}
    else seen.set(mechanism.id,{...mechanism,conceptKeys:[...new Set(mechanism.conceptKeys??[])],evidenceRefs:[...new Set(mechanism.evidenceRefs??[])]});
  }
  return [...seen.values()].sort((a,b)=>cmp(a.id,b.id));
}
function dedupePrerequisites(fragments:GraphFragment[]):FragmentPrerequisite[]{
  const seen=new Map<string,FragmentPrerequisite>();
  for(const fragment of fragments)for(const edge of fragment.prerequisites??[]){
    const key=`${edge.before}|${edge.after}`;
    if(!seen.has(key))seen.set(key,edge);
  }
  return [...seen.values()].sort((a,b)=>cmp(a.before+a.after,b.before+b.after));
}
function mergeTerminology(fragments:GraphFragment[]):FragmentTerm[]{
  const byKey=new Map<string,FragmentTerm>();
  for(const fragment of fragments)for(const term of fragment.terminology??[]){
    if(!byKey.has(term.key))byKey.set(term.key,term);
  }
  return [...byKey.values()].sort((a,b)=>cmp(a.key,b.key));
}
function hasCycle(edges:FragmentPrerequisite[]):boolean{
  const adjacency=new Map<string,string[]>();
  for(const edge of edges){adjacency.set(edge.before,[...(adjacency.get(edge.before)??[]),edge.after]);}
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(node:string):boolean=>{
    if(done.has(node))return false;
    if(visiting.has(node))return true;
    visiting.add(node);
    for(const next of adjacency.get(node)??[])if(visit(next))return true;
    visiting.delete(node);done.add(node);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}
