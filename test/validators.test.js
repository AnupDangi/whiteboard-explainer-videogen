import test from 'node:test';
import assert from 'node:assert/strict';
import {checkQuantities,checkKeyPoints,checkBoardText,checkFirstVisual,checkShapeMix,checkKindCollision,checkEdgeLabels,upgradeShapes,checkConceptBudget} from '../dist/src/planner.js';
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
test('A5: directorSchema is parameterized by scene count, matching outlineSchema\'s existing convention',()=>{
  const one=directorSchema(1);
  assert.equal(one.properties.scenes.minItems,1);
  assert.equal(one.properties.scenes.maxItems,1);
  const two=directorSchema(2);
  assert.equal(two.properties.scenes.minItems,2);
  assert.equal(two.properties.scenes.maxItems,2);
});
