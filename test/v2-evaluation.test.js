import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileScene} from '../dist/src/v2/compiler/compile-scene.js';
import {evaluatePlant,lintCompiledScene,judgeCalibration,reviewAndRepair} from '../dist/src/v2/evaluation.js';
const golden=()=>compileScene(JSON.parse(readFileSync('examples/v2/photosynthesis-plant.scene.json','utf8')));
test('V2 semantic benchmark accepts manual golden without requiring pixel identity',()=>{const s=golden();assert.equal(evaluatePlant(s).pass,true);const renamed=JSON.parse(JSON.stringify(s));renamed.scene.title='A different teaching title';assert.equal(evaluatePlant(renamed).pass,true);});
test('V2 deterministic critic catches known teaching and geometry corruptions',()=>{
 const corruptions=[s=>s.relations.find(r=>r.id==='water_to_roots').to.anchor='leaf.top',s=>s.objects=s.objects.filter(o=>o.id!=='sunlight'),s=>s.objects.find(o=>o.id==='carbon_dioxide').label='Oxygen (O2)',s=>s.objects.find(o=>o.id==='plant').y=500,s=>s.actions[0].startMs=s.durationMs+1,s=>{const o=s.objects.find(o=>o.id==='plant');delete o.assetRef;o.primitiveRef='rectangle';},s=>{const r=s.relations[0];[r.from,r.to]=[r.to,r.from];},s=>s.objects[0].x=NaN];
 for(const corrupt of corruptions){const s=golden();corrupt(s);assert.equal(evaluatePlant(s).pass,false);}
});
test('V2 critic calibration rejects order bias and missing known-corruption wins',()=>{const correct=Array.from({length:8},(_,i)=>({corruption:String(i),forward:{preferred:'A',criticalErrors:[],reason:'correct'},reverse:{preferred:'B',criticalErrors:[],reason:'correct'}}));assert.equal(judgeCalibration(correct).reliable,true);correct[0].reverse.preferred='A';assert.equal(judgeCalibration(correct).reliable,false);assert.deepEqual(judgeCalibration(correct).inconsistent,['0']);});
test('V2 critic never runs before hard lints and repairs at most once',async()=>{let calls=0;const bad=golden();bad.objects[0].x=NaN;await assert.rejects(reviewAndRepair(bad,{lint:lintCompiledScene,judge:async()=>{calls++;return {needsRepair:true,instructions:[]};},repair:async v=>v}),/preflight/);assert.equal(calls,0);const result=await reviewAndRepair(golden(),{lint:lintCompiledScene,judge:async()=>({needsRepair:true,instructions:['Clarify the leaf label']}),repair:async v=>{calls++;return v;}});assert.equal(calls,1);assert.equal(result.repairs,1);});
