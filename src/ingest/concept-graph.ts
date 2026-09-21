import {createHash} from 'node:crypto';
import type {CoveragePlan,SourceIR,TeachingBeat} from '../types/contracts.js';

const CONCEPT_GRAPH_SCHEMA_VERSION='concept-graph-v1';
type ConceptGraphLevel='L0'|'L1'|'L2'|'L3';
interface ConceptNode {id:string;label:string;kind:'section'|'source-block'|'concept'|'requirement'|'beat';sourceBlockIds:string[]}
interface ConceptEdge {from:string;to:string;kind:'contains'|'mentions'|'requires'|'teaches'|'relates'}
interface ConceptGraph {
  version:1;
  schemaVersion:string;
  sourceHash:string;
  level:ConceptGraphLevel;
  nodes:ConceptNode[];
  edges:ConceptEdge[];
  fingerprint:string;
}
interface ConceptSeed {id:string;label:string;sourceBlockIds:string[];relatedTo?:string[]}

const ORDER:Record<ConceptGraphLevel,number>={L0:0,L1:1,L2:2,L3:3};
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');
const uniq=<T>(values:T[],key:(value:T)=>string):T[]=>[...new Map(values.map(value=>[key(value),value])).values()];
const sortedNodes=(nodes:ConceptNode[])=>uniq(nodes,node=>node.id).sort((a,b)=>a.id.localeCompare(b.id));
const sortedEdges=(edges:ConceptEdge[])=>uniq(edges,edge=>`${edge.from}\u0000${edge.to}\u0000${edge.kind}`).sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)||a.kind.localeCompare(b.kind));

function graph(sourceHash:string,level:ConceptGraphLevel,nodes:ConceptNode[],edges:ConceptEdge[]):ConceptGraph {
  const base={version:1 as const,schemaVersion:CONCEPT_GRAPH_SCHEMA_VERSION,sourceHash,level,nodes:sortedNodes(nodes),edges:sortedEdges(edges)};
  return {...base,fingerprint:hash(base)};
}

export function conceptGraphCacheKey(sourceHash:string,level:ConceptGraphLevel,schemaVersion=CONCEPT_GRAPH_SCHEMA_VERSION):string {
  if(!/^[a-f0-9]{64}$/i.test(sourceHash))throw new Error('Concept graph cache requires a SHA-256 source hash');
  return `concept-graph/${schemaVersion}/${sourceHash}/${level}`;
}

/** L0 is a cheap document topology and is sufficient to start the fast lane. */
export function buildL0DocumentGraph(source:SourceIR):ConceptGraph {
  const nodes:ConceptNode[]=source.blocks.map(block=>({id:block.id,label:block.type==='heading'?block.text:block.type,kind:block.type==='heading'?'section':'source-block',sourceBlockIds:[block.id]}));
  const edges:ConceptEdge[]=[];
  let section:string|undefined;
  for(const block of source.blocks){
    if(block.type==='heading'){section=block.id;continue;}
    if(section)edges.push({from:section,to:block.id,kind:'contains'});
  }
  return graph(source.identity.sha256,'L0',nodes,edges);
}

export function buildL1RetrievedGraph(sourceHash:string,seeds:ConceptSeed[]):ConceptGraph {
  const ids=new Set(seeds.map(seed=>seed.id));
  const nodes=seeds.map(seed=>({id:seed.id,label:seed.label,kind:'concept' as const,sourceBlockIds:[...seed.sourceBlockIds].sort()}));
  const edges=seeds.flatMap(seed=>(seed.relatedTo??[]).filter(id=>ids.has(id)&&id!==seed.id).map(to=>({from:seed.id,to,kind:'relates' as const})));
  return graph(sourceHash,'L1',nodes,edges);
}

export function buildL2LessonGraph(sourceHash:string,coverage:CoveragePlan,beats:TeachingBeat[]):ConceptGraph {
  const nodes:ConceptNode[]=[
    ...coverage.requirements.map(req=>({id:req.id,label:req.concept,kind:'requirement' as const,sourceBlockIds:req.evidence.map(ref=>ref.blockId)})),
    ...beats.map(beat=>({id:beat.id,label:beat.displayText?.text??beat.spokenText.text,kind:'beat' as const,sourceBlockIds:beat.evidence.map(ref=>ref.blockId)})),
  ];
  const beatIds=new Set(beats.map(beat=>beat.id));
  const edges=coverage.requirements.filter(req=>req.beatId&&beatIds.has(req.beatId)).map(req=>({from:req.id,to:req.beatId!,kind:'teaches' as const}));
  return graph(sourceHash,'L2',nodes,edges);
}

/** L3 accepts compiler-independent semantic seeds and is safe to schedule at P4. */
export function buildL3GlobalGraph(sourceHash:string,seeds:ConceptSeed[]):ConceptGraph {
  const base=buildL1RetrievedGraph(sourceHash,seeds);
  return graph(sourceHash,'L3',base.nodes,base.edges);
}

interface GraphCache {get(key:string):Promise<ConceptGraph|undefined>;put(key:string,value:ConceptGraph):Promise<void>}
export class MemoryGraphCache implements GraphCache {
  #values=new Map<string,ConceptGraph>();
  async get(key:string):Promise<ConceptGraph|undefined>{const found=this.#values.get(key);return found?structuredClone(found):undefined;}
  async put(key:string,value:ConceptGraph):Promise<void>{this.#values.set(key,structuredClone(value));}
}

interface CommittedGraphView {sceneId:string;graph:ConceptGraph;committedAtSequence:number}

/**
 * Progressive graph coordinator. A scene captures its graph at commit time; subsequent
 * L3 enrichment can affect only uncommitted work. Thus playback artifacts never drift.
 */
export class ProgressiveConceptGraph {
  #latest?:ConceptGraph;
  #committed=new Map<string,CommittedGraphView>();
  #sequence=0;
  constructor(readonly sourceHash:string){}
  enrich(next:ConceptGraph):void {
    if(next.sourceHash!==this.sourceHash)throw new Error('Concept graph source mismatch');
    if(next.schemaVersion!==CONCEPT_GRAPH_SCHEMA_VERSION)throw new Error('Concept graph schema mismatch');
    if(this.#latest&&ORDER[next.level]<ORDER[this.#latest.level])throw new Error('Concept graph cannot regress');
    this.#latest=structuredClone(next);
  }
  isFirstPlaybackReady():boolean{return Boolean(this.#latest&&ORDER[this.#latest.level]>=ORDER.L0);}
  latest():ConceptGraph|undefined{return this.#latest?structuredClone(this.#latest):undefined;}
  commitScene(sceneId:string):CommittedGraphView {
    const prior=this.#committed.get(sceneId);if(prior)return structuredClone(prior);
    if(!this.#latest)throw new Error('Cannot commit a scene before L0');
    const committed={sceneId,graph:structuredClone(this.#latest),committedAtSequence:++this.#sequence};
    this.#committed.set(sceneId,committed);return structuredClone(committed);
  }
  graphForScene(sceneId:string):ConceptGraph|undefined {
    const committed=this.#committed.get(sceneId);return structuredClone(committed?.graph??this.#latest);
  }
}
