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
