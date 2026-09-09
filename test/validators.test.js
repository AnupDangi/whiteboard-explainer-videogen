import test from 'node:test';
import assert from 'node:assert/strict';
import {checkQuantities,checkKeyPoints,checkShapeMix,checkKindCollision,checkEdgeLabels,upgradeShapes} from '../dist/src/planner.js';

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
