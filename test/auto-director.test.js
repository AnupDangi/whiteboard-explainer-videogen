import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canAutoDirect,autoDirect} from '../dist/src/auto-director.js';

const scene=(nodes,intent='grow over time')=>({id:'s1',title:'t',narration:'x',layout:'flow',nodes:nodes.map((label,i)=>({id:`n${i}`,label,wordIndex:0,keyPoint:'k',visualIntent:intent})),edges:[],note:''});

test('Auto-director: high-precision label→kind hints and quantity shapes',()=>{
  const plan={version:1,title:'t',scenes:[scene(['User request','Database storage','671B parameters'])]};
  assert.equal(canAutoDirect(plan),true);
  const directed=autoDirect(plan,['k']);
  const nodes=directed.scenes[0].nodes;
  assert.equal(nodes[0].kind,'user');
  assert.equal(nodes[1].kind,'database');
  assert.equal(nodes[2].kind,'graph');
  assert.equal(nodes[2].shape,'number','quantity label renders as a big badge');
  assert.equal(nodes[0].shape,'icon','icon-capable kinds render as icons');
  assert.equal(nodes[0].emphasis,true,'node claiming the first key point gets emphasis');
});

test('Auto-director: visualIntent decides the layout deterministically',()=>{
  const compare=autoDirect({version:1,title:'t',scenes:[scene(['Pixels vs Features','before/after contrast'],'contrast two things side by side')]});
  assert.equal(compare.scenes[0].layout,'compare');
  const timeline=autoDirect({version:1,title:'t',scenes:[scene(['Step one','Step two'],'strict sequence of steps')]});
  assert.equal(timeline.scenes[0].layout,'timeline');
  const flow=autoDirect({version:1,title:'t',scenes:[scene(['User request','Database storage'],'unrelated')]});
  assert.equal(flow.scenes[0].layout,'flow');
});

test('Auto-director: generic-heavy scenes defer to the LLM director',()=>{
  const plan={version:1,title:'t',scenes:[scene(['Some abstract notion','Another vague thing','Mystery third'])]};
  assert.equal(canAutoDirect(plan),false,'no label maps to a concrete kind');
});

test('Auto-director: live-run numeric/routing labels map (regression)',()=>{
  const plan={version:1,title:'t',scenes:[scene(['671B total params','37B active params','Sparse Routing','Cost Efficiency','FP8 precision'])]};
  assert.equal(canAutoDirect(plan),true);
  const directed=autoDirect(plan);
  const kinds=directed.scenes[0].nodes.map(n=>n.kind);
  assert.equal(kinds[0],'graph','separated quantity noun maps to graph');
  assert.equal(kinds[1],'graph');
  assert(kinds.includes('process'),'routing/precision labels map to process');
  // Engine-synthesized nodes never block the fast path.
  const withAuto={version:1,title:'t',scenes:[{...scene(['671B total params','37B active params'])[0],nodes:[{id:'a',label:'671B total params',wordIndex:0,visualIntent:'x'},{id:'b',label:'unknown concept zzz',wordIndex:1,visualIntent:'x',auto:true}]}]};
  assert.equal(canAutoDirect(withAuto),true,'auto nodes excluded from classification');
});
