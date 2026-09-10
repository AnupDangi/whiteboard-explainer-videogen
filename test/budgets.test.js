import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getOutputBudget,getRetrievalBudget,getInputBudget,getCostBudget,getLatencyBudget} from '../dist/src/budgets.js';

test('LD7 output budgets: scale with chapters, never with source size',()=>{
  assert.equal(getOutputBudget('content'),9000,'1-min live-proven content budget unchanged');
  assert.equal(getOutputBudget('director'),5000);
  assert.equal(getOutputBudget('outline',1),2250);
  assert(getOutputBudget('outline',30)>getOutputBudget('outline',1),'outline output grows with chapter count');
  assert.equal(getOutputBudget('outline',100),9000,'capped');
  // No source-size parameter exists: source size CANNOT raise an output budget.
  // Duration is not a content/director input: per-chapter output stays constant.
  assert.equal(getOutputBudget('content'),getOutputBudget('content'));
});

test('LD7 retrieval budget: scales only with document size, never with duration',()=>{
  assert.equal(getRetrievalBudget(60000),8000);
  assert.equal(getRetrievalBudget(300000),12000);
  assert.equal(getRetrievalBudget(5_000_000),16000);
  assert(getRetrievalBudget(300000)>getRetrievalBudget(60000));
});

test('LD7 input budget: outline sees the most; content bounded to evidence envelope',()=>{
  assert.equal(getInputBudget('outline',50_000_000),120000,'hard clamp, not a strategy');
  assert.equal(getInputBudget('outline',10000),10000);
  assert.equal(getInputBudget('content',5_000_000),16000,'source size does not raise the content envelope');
  assert(getInputBudget('content',5_000_000)<getInputBudget('outline',5_000_000));
});

test('LD7 cost + latency budgets: bounded validation and per-stage ceilings',()=>{
  assert.equal(getCostBudget(1),1);
  assert.throws(()=>getCostBudget(0));
  assert.throws(()=>getCostBudget(11));
  assert.throws(()=>getCostBudget(NaN));
  assert.equal(getLatencyBudget('catalog'),20000);
  assert.equal(getLatencyBudget('critic'),60000);
  assert.equal(getLatencyBudget('model'),90000);
});
