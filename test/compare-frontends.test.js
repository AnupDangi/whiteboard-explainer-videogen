import test from 'node:test';
import assert from 'node:assert/strict';
import {durationRatio,durationPasses,renderMarkdown,DEFAULT_CASES} from '../dist/scripts/compare-frontends.js';

test('front-end compare: duration ratio and gate boundaries',()=>{
  assert.equal(durationRatio(60000,1),1);
  assert.equal(durationRatio(0,1),0);
  assert.equal(durationPasses(1),true);
  assert.equal(durationPasses(0.85),true);
  assert.equal(durationPasses(1.15),true);
  assert.equal(durationPasses(0.84),false);
  assert.equal(durationPasses(1.16),false);
});

test('front-end compare: markdown report carries every run including failures',()=>{
  const cases=DEFAULT_CASES.map(testCase=>testCase.id);
  assert.deepEqual(cases,['photosynthesis','http','gradient']);
  const markdown=renderMarkdown([
    {pipeline:'semantic-v3',case:'http',scenes:2,wallSec:12.34,outputSec:60.7,ratio:1.01,durationPass:true,calls:6,costUsd:0.0324},
    {pipeline:'semantic-v3',case:'gradient',scenes:2,wallSec:15.0,outputSec:72.4,ratio:1.21,durationPass:false,calls:4,costUsd:0.0153},
    {pipeline:'semantic',case:'http',scenes:0,wallSec:1.2,outputSec:0,ratio:0,durationPass:false,calls:2,costUsd:0.001,error:'stage failed'},
  ],1);
  assert.match(markdown,/semantic-v3/);
  assert.match(markdown,/PASS/);
  assert.match(markdown,/MISS/);
  assert.match(markdown,/FAIL/);
  assert.match(markdown,/stage failed/);
});
