import test from 'node:test';
import assert from 'node:assert/strict';
import {checkQuantities,checkKeyPoints,checkBoardText,checkFirstVisual,checkConceptContinuity,checkShapeMix,checkKindCollision,checkEdgeLabels,upgradeShapes,checkConceptBudget,resolveAnchors,checkEvidence,deriveBeats,fillBeats} from '../dist/src/planner.js';
import {retrieveChapterEvidence} from '../dist/src/retrieval.js';
import {directorSchema} from '../dist/src/schema.js';

test('quantity manifest: narrated number+noun must be drawn or labeled',()=>{
  const ok=[{id:'s',narration:'The cluster runs on 8 GPUs.',nodes:[{id:'a',label:'GPU cluster (8 units)'}],note:''}];
  assert.deepEqual(checkQuantities(ok),[]);
  const missing=[{id:'s',narration:'The cluster runs on 8 GPUs.',nodes:[{id:'a',label:'Cluster'},{id:'b',label:'Power'},{id:'c',label:'Cooling'}],note:''}];
  const failures=checkQuantities(missing);
  assert.equal(failures.length,1);assert.match(failures[0],/8 GPUs/);
  // Bare years without a following noun are not quantities.
  const year=[{id:'s',narration:'In 2017, attention was introduced.',nodes:[{id:'a',label:'Attention'},{id:'b',label:'Context'}],note:''}];
  assert.deepEqual(checkQuantities(year),[]);
});

test('key-point coverage: claimed, drawn, and narrated',()=>{
  const kps=['Parallel training speedup','Softmax weight blending'];
  const good=[{id:'s',narration:'Parallel training speedup comes from matrix math. Softmax weight blending combines values.',nodes:[{id:'a',label:'Speedup',keyPoint:kps[0]},{id:'b',label:'Blending',keyPoint:kps[1]}]}];
  assert.deepEqual(checkKeyPoints(good,kps),[]);
  const unclaimed=[{id:'s',narration:'Parallel training speedup comes from matrix math. Softmax weight blending combines values.',nodes:[{id:'a',label:'Speedup',keyPoint:kps[0]},{id:'b',label:'Blending',keyPoint:kps[0]}]}];
  assert.match(checkKeyPoints(unclaimed,kps).join('|'),/never drawn/);
  const unknown=[{id:'s',narration:'Parallel training speedup comes from matrix math.',nodes:[{id:'a',label:'Speedup',keyPoint:'Something else entirely'}]}];
  assert.match(checkKeyPoints(unknown,kps).join('|'),/unknown key point/);
  // Harmless rewording (≥70% word overlap) does not burn a repair attempt.
  const reword=[{id:'s',narration:'Parallel training speedup comes from matrix math. Softmax weight blending combines values.',nodes:[{id:'a',label:'Speedup',keyPoint:kps[0]},{id:'b',label:'Blending',keyPoint:'Softmax weight blending method'}]}];
  assert.deepEqual(checkKeyPoints(reword,kps),[]);
});

test('shape mix: all-box scenes fail, mixed scenes pass',()=>{
  const mixed=[{id:'s',narration:'x',nodes:[{id:'a',shape:'box'},{id:'b',shape:'icon',kind:'database'}]}];
  assert.deepEqual(checkShapeMix(mixed),[]);
  const boxes=[{id:'s',narration:'x',nodes:[{id:'a'},{id:'b',shape:'box'}]}];
  assert.match(checkShapeMix(boxes).join('|'),/only "box"/);
});

test('kind collision: one glyph per concept; identical labels pass',()=>{
  const clash=[{id:'s',narration:'x',nodes:[{id:'a',label:'Attraction',kind:'energy'},{id:'b',label:'Repulsion',kind:'energy'}]}];
  assert.match(checkKindCollision(clash).join('|'),/share kind "energy"/);
  const twins=[{id:'s',narration:'x',nodes:[{id:'a',label:'Hidden units',kind:'token'},{id:'b',label:'Hidden units',kind:'token'}]}];
  assert.deepEqual(checkKindCollision(twins),[]);
  const generic=[{id:'s',narration:'x',nodes:[{id:'a',label:'Foo'},{id:'b',label:'Bar'}]}];
  assert.deepEqual(checkKindCollision(generic),[]);
});
test('kind collision (A4): repeated instances of one concept pass; different concepts still fail',()=>{
  const tokens=[{id:'s',narration:'x',nodes:[
    {id:'t1',label:'Token 1',kind:'token'},{id:'t2',label:'Token 2',kind:'token'},{id:'t3',label:'Token 3',kind:'token'},
  ]}];
  assert.deepEqual(checkKindCollision(tokens),[]);
  const keys=[{id:'s',narration:'x',nodes:[{id:'k1',label:'Key A',kind:'key'},{id:'k2',label:'Key B',kind:'key'}]}];
  assert.deepEqual(checkKindCollision(keys),[]);
  const bases=[{id:'s',narration:'x',nodes:[{id:'b1',label:'Base pair',kind:'molecule'},{id:'b2',label:'Base pair',kind:'molecule'}]}];
  assert.deepEqual(checkKindCollision(bases),[]);
  const clash=[{id:'s',narration:'x',nodes:[{id:'a',label:'Attraction',kind:'energy'},{id:'b',label:'Repulsion',kind:'energy'}]}];
  assert.match(checkKindCollision(clash).join('|'),/share kind "energy"/);
});
test('upgradeShapes: quantities, recaps, round entities, documents',()=>{
  const scenes=[
    {id:'s1',nodes:[{id:'a',label:'8 GPUs',shape:'icon',kind:'server'},{id:'b',label:'Long quantity label with many words here',shape:'box',kind:'server'},{id:'c',label:'Plain step',shape:'box',kind:'process'}]},
    {id:'s2',nodes:[{id:'d',label:'Heat flows. Coils cool.',shape:'box',kind:'process'},{id:'e',label:'Single point',shape:'box',kind:'process'}]},
    {id:'s3',nodes:[{id:'f',label:'Water cycle',shape:'box',kind:'cycle'},{id:'g',label:'Readme file',shape:'box',kind:'document'},{id:'h',label:'Teacher',shape:'illustration',kind:'teacher'}]},
  ];
  const out=upgradeShapes(scenes,{s1:'build',s2:'recap',s3:'build'});
  const shape=(sid,id)=>out.find(s=>s.id===sid).nodes.find(n=>n.id===id).shape;
  assert.equal(shape('s1','a'),'number','short quantity becomes a badge');
  assert.equal(shape('s1','b'),'box','long quantity label stays put (badge would overflow)');
  assert.equal(shape('s1','c'),'box');
  assert.equal(shape('s2','d'),'bullet','recap multi-point list becomes bullets');
  assert.equal(shape('s2','e'),'box','single recap point stays a box');
  assert.equal(shape('s3','f'),'circle','cycle becomes a circle');
  assert.equal(shape('s3','g'),'square','document becomes a square');
  assert.equal(shape('s3','h'),'illustration','illustrations are never touched');
});
test('edge naming: every arrow gets a name',()=>{
  const bare=[{id:'s',narration:'x',nodes:[],edges:[{from:'a',to:'b',label:''},{from:'b',to:'c',label:''}]}];
  assert.match(checkEdgeLabels(bare).join('|'),/names none/);
  const named=[{id:'s',narration:'x',nodes:[],edges:[{from:'a',to:'b',label:'heats'},{from:'b',to:'c',label:''}]}];
  assert.deepEqual(checkEdgeLabels(named),[]);
  const singleBare=[{id:'s',narration:'x',nodes:[],edges:[{from:'a',to:'b',label:''}]}];
  assert.match(checkEdgeLabels(singleBare).join('|'),/names none/);
  const singleNamed=[{id:'s',narration:'x',nodes:[],edges:[{from:'a',to:'b',label:'becomes'}]}];
  assert.deepEqual(checkEdgeLabels(singleNamed),[]);
  const noEdges=[{id:'s',narration:'x',nodes:[]}];
  assert.deepEqual(checkEdgeLabels(noEdges),[]);
});
test('concept budget: split crowded scenes past 5 distinct kinds, generic never counts',()=>{
  const crowded=[{id:'s',narration:'x',nodes:[{id:'a',kind:'database'},{id:'b',kind:'server'},{id:'c',kind:'user'},{id:'d',kind:'cloud'},{id:'e',kind:'model'},{id:'f',kind:'agent'}]}];
  assert.match(checkConceptBudget(crowded).join('|'),/6 distinct concepts/);
  const roomy=[{id:'s',narration:'x',nodes:[{id:'a',kind:'database'},{id:'b',kind:'server'},{id:'c',kind:'user'}]}];
  assert.deepEqual(checkConceptBudget(roomy),[]);
  // Repeated kinds and generic don't count toward the budget.
  const repeatsAndGeneric=[{id:'s',narration:'x',nodes:[{id:'a',kind:'database'},{id:'b',kind:'database'},{id:'c'},{id:'d'},{id:'e'},{id:'f'}]}];
  assert.deepEqual(checkConceptBudget(repeatsAndGeneric),[]);
});
test('V3-1 board text: key points must be written on the canvas, not just claimed',()=>{
  const kps=['Parallel training speedup','Softmax weight blending'];
  const board=[{id:'s',narration:'x',nodes:[{id:'a',label:'Parallel training speedup',keyPoint:kps[0]},{id:'b',label:'Softmax blending weights',keyPoint:kps[1]}]}];
  assert.deepEqual(checkBoardText(board,kps),[]);
  const metaOnly=[{id:'s',narration:'x',nodes:[{id:'a',label:'Cluster',keyPoint:kps[0]},{id:'b',label:'Blending',keyPoint:kps[1]}]}];
  const failures=checkBoardText(metaOnly,kps);
  assert.equal(failures.length,2);assert.match(failures.join('|'),/never written on the board/);
});
test('V3-1 first visual: some node anchors in the opening 30 words',()=>{
  const early=[{id:'s',nodes:[{id:'a',wordIndex:5},{id:'b',wordIndex:40}]}];
  assert.deepEqual(checkFirstVisual(early),[]);
  const late=[{id:'s',nodes:[{id:'a',wordIndex:45},{id:'b',wordIndex:60}]}];
  assert.match(checkFirstVisual(late).join('|'),/opening 30 words/);
  const unanchored=[{id:'s',nodes:[{id:'a'}]}];
  assert.match(checkFirstVisual(unanchored).join('|'),/opening 30 words/);
});
test('V3-2 beats: anchors resolve inside their own beat, never a repeated word elsewhere',()=>{
  const plan={version:1,title:'Beats',scenes:[{id:'s',title:'T',narration:'cat sat cat mat',layout:'flow',
    beats:[{id:'b1',narration:'cat sat'},{id:'b2',narration:'cat mat'}],
    nodes:[{id:'a',label:'First cat',anchor:'cat',beatId:'b1'},{id:'b',label:'Second cat',anchor:'cat',beatId:'b2'}],edges:[],note:''}]};
  const resolved=resolveAnchors(structuredClone(plan));
  assert.equal(resolved.scenes[0].nodes[0].wordIndex,0);
  assert.equal(resolved.scenes[0].nodes[1].wordIndex,2,'second-beat cat resolves to word 2, not word 0');
  assert.deepEqual(resolved.scenes[0].beats.map(b=>b.id),['b1','b2']);
  const outsideBeat=structuredClone(plan);outsideBeat.scenes[0].nodes[1].anchor='mat';outsideBeat.scenes[0].nodes[1].beatId='b1';
  assert.throws(()=>resolveAnchors(outsideBeat),/inside its beat/);
  const badPartition=structuredClone(plan);badPartition.scenes[0].beats[1].narration='cat';
  assert.throws(()=>resolveAnchors(badPartition),/partition/);
  const unknownBeat=structuredClone(plan);unknownBeat.scenes[0].nodes[0].beatId='nope';
  assert.throws(()=>resolveAnchors(unknownBeat),/not a beat/);
  // No beats at all: legacy global resolution still works.
  const legacy={version:1,title:'Legacy',scenes:[{id:'s',title:'T',narration:'cat sat mat',layout:'flow',nodes:[{id:'a',label:'Cat',anchor:'cat'},{id:'b',label:'Mat',anchor:'mat'}],edges:[],note:''}]};
  const leg=resolveAnchors(legacy);
  assert.equal(leg.scenes[0].nodes[1].wordIndex,2);
});
test('V3-2 concept continuity: one conceptId means one label and kind',()=>{
  const stable=[{id:'s1',nodes:[{id:'a',label:'Bank token',kind:'token',conceptId:'bank'}]},{id:'s2',nodes:[{id:'b',label:'Bank token',kind:'token',conceptId:'bank'}]}];
  assert.deepEqual(checkConceptContinuity(stable),[]);
  const renamed=[{id:'s1',nodes:[{id:'a',label:'Bank token',kind:'token',conceptId:'bank'}]},{id:'s2',nodes:[{id:'b',label:'Bank store',kind:'token',conceptId:'bank'}]}];
  assert.match(checkConceptContinuity(renamed).join('|'),/changes identity/);
  const rekinded=[{id:'s1',nodes:[{id:'a',label:'Bank token',kind:'token',conceptId:'bank'}]},{id:'s2',nodes:[{id:'b',label:'Bank token',kind:'database',conceptId:'bank'}]}];
  assert.match(checkConceptContinuity(rekinded).join('|'),/changes identity/);
  const distinct=[{id:'s1',nodes:[{id:'a',label:'Bank token',kind:'token',conceptId:'bank'}]},{id:'s2',nodes:[{id:'b',label:'Bank token',kind:'token',conceptId:'vault'}]}];
  assert.deepEqual(checkConceptContinuity(distinct),[]);
});
test('LD3 retrieval: chapter evidence matches the objective, not the ordinal position',()=>{
  const doc=['Filler paragraph about administrative policy and budgeting procedures with no relation.',
    'The attention mechanism computes compatibility between a query and every key in the context.',
    'Completely unrelated paragraph about office furniture logistics.',
    'The softmax function normalizes the compatibility scores into weights that sum to one.'].join('\n\n');
  const source={kind:'text',label:'t',text:doc,sha256:'x'};
  const retrieved=retrieveChapterEvidence(source,'How attention compares query against keys and normalizes into softmax weights',['Compatibility scores'],300,{maxChars:150});
  assert(retrieved.text.includes('attention mechanism'),'attention paragraph retrieved');
  assert(retrieved.text.includes('softmax'),'softmax paragraph retrieved');
  assert(!retrieved.text.includes('office furniture'),'unrelated paragraph dropped');
  const small=retrieveChapterEvidence({...source,text:'short doc'},'anything',[]);
  assert.equal(small.text,'short doc','tiny sources pass through whole');
});
test('Perf: deriveBeats partitions narration exactly and deterministically',()=>{
  const narration='Transformers changed everything. Attention replaced recurrence entirely. The model reads the whole sequence at once.';
  const beats=deriveBeats(narration);
  assert(beats.length>=2&&beats.length<=4,'2-4 beats');
  assert.equal(beats.map(b=>b.narration).join(' ').replace(/\s+/g,' ').trim(),narration.replace(/\s+/g,' ').trim(),'exact partition');
  assert.deepEqual(deriveBeats(narration),beats,'deterministic');
  // Single-sentence narration still yields two beats (engine requires 2-4).
  const single=deriveBeats('Just one long sentence with many words that must split on a boundary.');
  assert(single.length>=2);
});
test('Perf: resolveAnchors derives beats and assigns beatId without model output',()=>{
  const raw={version:1,title:'t',scenes:[{id:'s1',title:'S',narration:'Alpha starts here and continues. Beta finishes the thought cleanly.',layout:'flow',nodes:[{id:'a',label:'Alpha',anchor:'Alpha starts',keyPoint:'A'},{id:'b',label:'Beta',anchor:'Beta finishes',keyPoint:'B'}],edges:[],note:''}]};
  const plan=resolveAnchors(raw);
  const scene=plan.scenes[0];
  assert(Array.isArray(scene.beats)&&scene.beats.length>=2,'beats derived');
  assert(scene.nodes.every(n=>typeof n.beatId==='string'),'every node got a beatId');
  assert.equal(scene.nodes[0].beatId,'b1');
});
test('Perf: fillBeats synthesizes a node for a visual-less beat from its own words',()=>{
  const narration='Alpha introduces the model. Beta explains the routing mechanism clearly. Gamma closes with the training result.';
  const scene={id:'s1',title:'t',narration,layout:'flow',beats:[{id:'b1',narration:'Alpha introduces the model.'},{id:'b2',narration:'Beta explains the routing mechanism clearly.'},{id:'b3',narration:'Gamma closes with the training result.'}],nodes:[{id:'a',label:'Alpha model',wordIndex:0,beatId:'b1',evidenceIds:['p1:c1']}],edges:[],note:''};
  const plan={version:1,title:'t',scenes:[scene]};
  const chunks=[{id:'p1:c1',text:'Alpha introduces the model.'},{id:'p1:c2',text:'Beta explains the routing mechanism clearly with experts.'},{id:'p1:c3',text:'Gamma closes with the training result and scale.'}];
  const added=fillBeats(plan,chunks);
  assert.equal(added,2);
  assert.equal(plan.scenes[0].nodes.length,3);
  const b2=plan.scenes[0].nodes.find(n=>n.beatId==='b2');
  assert(b2&&b2.wordIndex>=4&&b2.wordIndex<10,'filled node lands inside its beat');
  assert(b2.label.toLowerCase().includes('beta')||b2.label.toLowerCase().includes('routing'),'label quotes the beat');
  assert(b2.evidenceIds&&b2.evidenceIds.length===1,'evidence assigned');
  // A fully covered scene is untouched.
  const full={version:1,title:'t',scenes:[{...scene,nodes:[{id:'a',label:'A',wordIndex:0,beatId:'b1'},{id:'b',label:'B',wordIndex:5,beatId:'b2'},{id:'c',label:'C',wordIndex:11,beatId:'b3'}]}]};
  assert.equal(fillBeats(full,chunks),0);
});
test('LD6 grounding: evidenceIds must exist and actually support the node',()=>{
  const scene={id:'s1',nodes:[
    {id:'a',label:'Attention mechanism',keyPoint:'Attention fact',evidenceIds:['p1:c1']},
    {id:'b',label:'Furniture logistics',keyPoint:'Furniture fact',evidenceIds:['p9:c9']},
    {id:'c',label:'Softmax weights',keyPoint:'Softmax fact',evidenceIds:['p1:c2']},
    {id:'d',label:'Random claim',keyPoint:'Nothing fact',evidenceIds:['p1:c1']},
  ]};
  const chunks=[{id:'p1:c1',text:'The attention mechanism computes compatibility between queries and keys.'},{id:'p1:c2',text:'The softmax function turns scores into weights that sum to one.'}];
  const failures=checkEvidence([scene],chunks);
  assert(failures.some(f=>f.includes('b: evidenceIds cites unknown chunk "p9:c9"')),'nonexistent chunk flagged');
  assert(failures.some(f=>f.includes('d: cited chunk "p1:c1" does not support')),'unsupported claim flagged');
  assert(!failures.some(f=>f.startsWith('s1/a')),'supported node passes');
  assert(!failures.some(f=>f.startsWith('s1/c')),'second supported node passes');
  assert.deepEqual(checkEvidence([{id:'s1',nodes:[{id:'a',label:'x'}]}],undefined),[],'no evidence chunks -> check disabled');
});
test('A5: directorSchema is parameterized by scene count, matching outlineSchema\'s existing convention',()=>{
  const one=directorSchema(1);
  assert.equal(one.properties.scenes.minItems,1);
  assert.equal(one.properties.scenes.maxItems,1);
  const two=directorSchema(2);
  assert.equal(two.properties.scenes.minItems,2);
  assert.equal(two.properties.scenes.maxItems,2);
});
