import test from 'node:test';
import assert from 'node:assert/strict';
import {mapBatchCount,batchChunks,mapChunksToFragments} from '../dist/src/semantic/knowledge/graph-map.js';
import {reduceFragments,gateBaseGraph,focusGraph,baseGraphHash} from '../dist/src/semantic/knowledge/reducer.js';
import {buildBaseConceptGraph} from '../dist/src/semantic/knowledge/index.js';
import {saveBaseConceptGraph} from '../dist/src/semantic/knowledge/cache.js';
import {runGraphReducer} from '../dist/src/semantic/knowledge/graph-reduce.js';
import {createFileCache} from '../dist/src/semantic/cache/store.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMemoryCache} from '../dist/src/semantic/cache/store.js';

const chunk=(id,text,sectionPath=['Section'])=>({id,sectionPath,start:0,text,blockTypes:['text'],tokens:20});

const evidence=(id,quote)=>({id,quote});
const concept=(key,canonicalName,aliases=[])=>({key,canonicalName,aliases,semanticType:'entity',evidenceRefs:['e1']});
const fragment=(overrides={})=>({
  concepts:[concept('plant','Plant')],
  relations:[],
  claims:[{id:'cl1',statement:'Plants use sunlight.',critical:true,evidenceRefs:['e1']}],
  mechanisms:[],
  prerequisites:[],
  terminology:[],
  evidence:[evidence('e1','Plants use sunlight to make glucose.')],
  ...overrides,
});

/** Minimal JsonModel: returns the scripted fragment for each successive call. */
function fakeModel(script){
  let index=0;
  const model={
    calls:[],
    events:[],
    async generate(stage,_instructions,_input,_schema,validate){
      const value=script[Math.min(index,script.length-1)];index++;
      model.calls.push({stage});
      return validate(value);
    },
  };
  return model;
}

test('W2 batching: source size maps to a bounded, predictable map-call count',()=>{
  assert.equal(mapBatchCount(5),1);
  assert.equal(mapBatchCount(12),2);
  assert.equal(mapBatchCount(30),4);
  assert.equal(mapBatchCount(60),8);
  const chunks=Array.from({length:11},(_v,i)=>chunk(`c${i}`,`text ${i}`));
  const groups=batchChunks(chunks,mapBatchCount(11));
  assert.equal(groups.length,2);
  assert.equal(groups.flat().length,11,'every chunk is used exactly once');
  assert.deepEqual(groups.flat().map(c=>c.id),chunks.map(c=>c.id),'document order is preserved');
});

test('W2 graph map: one call per batch, fragments returned in batch order',async()=>{
  const chunks=Array.from({length:12},(_v,i)=>chunk(`c${i}`,`text ${i}`));
  const model=fakeModel([
    fragment({concepts:[concept('alpha','Alpha')]}),
    fragment({concepts:[concept('beta','Beta')]}),
  ]);
  const fragments=await mapChunksToFragments(chunks,'objective',{model});
  assert.equal(fragments.length,2);
  assert.equal(model.calls.length,2,'one graph-map call per batch, not per chunk');
  assert.ok(model.calls.every(call=>call.stage==='graphMap'));
  assert.deepEqual(fragments.map(f=>f.concepts[0].key),['alpha','beta']);
});

test('W2 reducer: dedupes concepts/claims, merges aliases, drops unsupported claims and dangling relations',()=>{
  const a=fragment({concepts:[concept('plant','Plant',['flora'])],relations:[{from:'plant',to:'ghost',type:'causes',evidenceRefs:['e1']}],claims:[{id:'cl1',statement:'Plants use sunlight.',critical:false,evidenceRefs:['e1']}]});
  const b=fragment({concepts:[concept('plant','Plant',['vegetation'])],claims:[{id:'cl2',statement:'Plants use sunlight.',critical:true,evidenceRefs:['e1']},{id:'cl3',statement:'Unsupported claim.',critical:true,evidenceRefs:['missing']}]});
  const graph=reduceFragments([a,b]);
  assert.equal(graph.concepts.length,1,'one canonical concept after merge');
  assert.deepEqual(graph.concepts[0].aliases.sort(),['flora','vegetation']);
  assert.equal(graph.relations.length,0,'a relation to an unknown concept is dropped');
  assert.equal(graph.claims.length,1,'the duplicate merges and the unsupported claim is rejected');
  assert.equal(graph.claims[0].critical,true,'critical survives the merge');
  assert.equal(graph.thesis,'Plants use sunlight.');
});

test('W2 gate: unsupported evidence and prerequisite cycles are hard failures',()=>{
  const good=reduceFragments([fragment()]);
  assert.equal(gateBaseGraph(good).passed,true);
  const badEvidence=reduceFragments([fragment({claims:[{id:'cl1',statement:'no evidence',critical:true,evidenceRefs:['missing']}]})]);
  assert.equal(badEvidence.claims.length,0,'the reducer rejects first, so the gate sees a clean graph');
  const cyclic=reduceFragments([fragment({concepts:[concept('a','A'),concept('b','B')],prerequisites:[{before:'a',after:'b'},{before:'b',after:'a'}]})]);
  const gate=gateBaseGraph(cyclic);
  assert.equal(gate.passed,false);
  assert.ok(gate.findings.some(finding=>/cycle/.test(finding)));
  // Directly exercise the gate's own evidence branch (bypassing the reducer).
  const dangling=gateBaseGraph({version:1,concepts:[concept('a','A')],relations:[],claims:[{id:'cl1',statement:'x',critical:true,evidenceRefs:['missing']}],mechanisms:[],prerequisites:[],terminology:[],evidence:[evidence('e1','q')],centralConcepts:['a'],thesis:'x'});
  assert.equal(dangling.passed,false);
  assert.ok(dangling.findings.some(finding=>/no valid evidence/.test(finding)));
});

test('W2 focus: prompt narrows the base graph to a matching concept plus one hop',()=>{
  const base=reduceFragments([fragment({
    concepts:[concept('photosynthesis','Photosynthesis'),concept('sunlight','Sunlight'),concept('taxation','Taxation')],
    relations:[{from:'photosynthesis',to:'sunlight',type:'causes',evidenceRefs:['e1']}],
    claims:[
      {id:'cl1',statement:'Photosynthesis uses sunlight.',critical:true,evidenceRefs:['e1'],conceptKeys:['photosynthesis']},
      {id:'cl2',statement:'Taxation funds government.',critical:false,evidenceRefs:['e1'],conceptKeys:['taxation']},
    ],
  })]);
  const focused=focusGraph(base,'explain sunlight');
  assert.deepEqual(focused.concepts.map(c=>c.key).sort(),['photosynthesis','sunlight']);
  assert.deepEqual(focused.claims.map(c=>c.id),['cl1'],'claims are scoped to the focused concepts');
  assert.equal(focused.baseHash,baseGraphHash(base));
  const fallback=focusGraph(base,'completely unrelated prompt');
  assert.ok(fallback.concepts.length>=1,'focus never empties the lesson');
});

test('W2 orchestrator: builds and caches a base graph, and the second lesson reuses it',async()=>{
  const doc={kind:'text',label:'t',text:'Plants use sunlight to make glucose.','sha256':'sha-w2',blocks:[]};
  const model=fakeModel([fragment()]);
  const store=createMemoryCache();
  const first=await buildBaseConceptGraph({doc,objective:'photosynthesis',model,store});
  assert.equal(first.cached,false);
  assert.equal(first.base.concepts[0].key,'plant');
  assert.equal(first.gate.passed,true);
  assert.equal(first.focus.baseHash,baseGraphHash(first.base));
  const second=await buildBaseConceptGraph({doc,objective:'photosynthesis',model,store});
  assert.equal(second.cached,true,'the source-tier cache is reused');
  assert.equal(second.fragments.length,0,'a cache hit buys zero graph-map calls');
});

test('W2 cache: refuses to persist a graph that cannot pass its gate',async()=>{
  const store=createMemoryCache();
  await saveBaseConceptGraph(store,'sha-w2',reduceFragments([fragment()]));
  await assert.rejects(saveBaseConceptGraph(store,'sha-x',{version:1,concepts:[],relations:[],claims:[],mechanisms:[],prerequisites:[],terminology:[],evidence:[],centralConcepts:[],thesis:''}),/failed its gate/);
});

test('W2 model reducer: cannot smuggle unsupported claims, falls back on bad output',async()=>{
  const source=fragment();
  const modelGraph={
    version:1,
    concepts:[concept('plant','Plant')],
    relations:[],
    claims:[{id:'cl1',statement:'Plants use sunlight.',critical:true,evidenceRefs:['e1']},{id:'bad',statement:'Invented fact',critical:true,evidenceRefs:['missing']}],
    mechanisms:[],prerequisites:[],terminology:[],evidence:[evidence('e1','Plants use sunlight to make glucose.'),evidence('madeup','fabricated quote')],centralConcepts:['plant'],thesis:'Plants use sunlight.',
  };
  const valid=await runGraphReducer(fakeModel([modelGraph]),[source]);
  assert.equal(valid.usedModel,true);
  assert.deepEqual(valid.graph.claims.map(c=>c.id),['cl1'],'the unsupported claim is pruned by the deterministic re-reduce');
  const invalid=await runGraphReducer(fakeModel([{not:'a graph'}]),[source]);
  assert.equal(invalid.usedModel,false);
  assert.equal(invalid.graph.concepts[0].key,'plant','deterministic reducer is the fallback');
});

test('W2 file cache: round-trips the stored value, not its envelope',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ecl-cache-'));
  try{
    const store=createFileCache(dir);
    await store.put('k',{a:1},{validated:true,kind:'probe'});
    assert.deepEqual(await store.get('k'),{a:1});
    const document={kind:'text',label:'t',text:'Plants use sunlight to make glucose.','sha256':'sha-file',blocks:[]};
    const {saveSourceDocument,loadSourceDocument}=await import('../dist/src/semantic/source/cache.js');
    await saveSourceDocument(store,document);
    const loaded=await loadSourceDocument(store,'sha-file');
    assert.equal(loaded.text,document.text,'the file cache returns the document, not the wrapper');
  }finally{await rm(dir,{recursive:true,force:true});}
});
