import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileScene} from '../dist/src/v2/compiler/compile-scene.js';
import {evaluatePlant,lintCompiledScene,judgeCalibration,reviewAndRepair} from '../dist/src/v2/evaluation.js';
import {knownCorruptions,runCriticCalibration} from '../dist/src/v2/calibration.js';
import {createVisionJudge} from '../dist/src/v2/vision-judge.js';
import {renderSVG} from '../dist/src/v2/renderer/render-svg.js';
const golden=()=>compileScene(JSON.parse(readFileSync('examples/v2/photosynthesis-plant.scene.json','utf8')));
test('V2 semantic benchmark accepts manual golden without requiring pixel identity',()=>{const s=golden();assert.equal(evaluatePlant(s).pass,true);const renamed=JSON.parse(JSON.stringify(s));renamed.scene.title='A different teaching title';assert.equal(evaluatePlant(renamed).pass,true);});
test('V2 deterministic critic catches known teaching and geometry corruptions',()=>{
 const corruptions=[s=>s.relations.find(r=>r.id==='water_to_roots').to.anchor='leaf.top',s=>s.objects=s.objects.filter(o=>o.id!=='sunlight'),s=>s.objects.find(o=>o.id==='carbon_dioxide').label='Oxygen (O2)',s=>s.objects.find(o=>o.id==='plant').y=500,s=>s.actions[0].startMs=s.durationMs+1,s=>{const o=s.objects.find(o=>o.id==='plant');delete o.assetRef;o.primitiveRef='rectangle';},s=>{const r=s.relations[0];[r.from,r.to]=[r.to,r.from];},s=>s.objects[0].x=NaN];
 for(const corrupt of corruptions){const s=golden();corrupt(s);assert.equal(evaluatePlant(s).pass,false);}
});
test('V2 critic calibration rejects order bias and missing known-corruption wins',()=>{const correct=Array.from({length:8},(_,i)=>({corruption:String(i),forward:{preferred:'A',criticalErrors:[],reason:'correct'},reverse:{preferred:'B',criticalErrors:[],reason:'correct'}}));assert.equal(judgeCalibration(correct).reliable,true);correct[0].reverse.preferred='A';assert.equal(judgeCalibration(correct).reliable,false);assert.deepEqual(judgeCalibration(correct).inconsistent,['0']);});
test('V2 critic never runs before hard lints and repairs at most once',async()=>{let calls=0;const bad=golden();bad.objects[0].x=NaN;await assert.rejects(reviewAndRepair(bad,{lint:lintCompiledScene,judge:async()=>{calls++;return {needsRepair:true,instructions:[]};},repair:async v=>v}),/preflight/);assert.equal(calls,0);const result=await reviewAndRepair(golden(),{lint:lintCompiledScene,judge:async()=>({needsRepair:true,instructions:['Clarify the leaf label']}),repair:async v=>{calls++;return v;}});assert.equal(calls,1);assert.equal(result.repairs,1);});
test('V2 critic corruption suite yields nine visibly distinct degradations',()=>{
 const baseline=golden(),signature=s=>[0,.25,.5,.75,1].map(p=>renderSVG(s,s.durationMs*p)).join('|'),base=signature(baseline),names=[];
 for(const corruption of knownCorruptions()){const s=structuredClone(baseline);corruption.apply(s);assert.notEqual(signature(s),base,corruption.name);names.push(corruption.name);}
 assert.equal(new Set(names).size,9);
});
test('V2 critic calibration runs both orders and exposes position bias',async()=>{
 const baseline=golden(),context={goal:'g',requirements:['r'],narration:'n'};
 let calls=0;const judge={calls:[],async judge(a,b){calls++;return {preferred:a.pngBase64==='good'?'A':'B',criticalErrors:[],reason:'x'};}};
 const render=async(s,label)=>({label,pngBase64:label.endsWith('original')?'good':'bad'});
 const result=await runCriticCalibration({baseline,judge,context,render});
 assert.equal(result.report.reliable,true);assert.equal(result.report.accuracy,1);assert.equal(calls,18);
 const biased={calls:[],async judge(){return {preferred:'A',criticalErrors:[],reason:'x'};}};
 assert.equal((await runCriticCalibration({baseline,judge:biased,context,render})).report.reliable,false);
});
test('V2 vision judge sends both candidates as image parts and stays metered',async()=>{
 const bodies=[],fetcher=async(url,init)=>{const target=String(url);if(target.endsWith('/models'))return new Response(JSON.stringify({data:[{id:'test/vision',pricing:{prompt:'0.000001',completion:'0.000001'}}]}));bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'```json\n'+JSON.stringify({preferred:'B',criticalErrors:[],reason:'clearer'})+'\n```'}}],usage:{prompt_tokens:120,completion_tokens:30,cost:.00012}}));};
 const judge=createVisionJudge({env:{OPENROUTER_API_KEY:'test',OPENROUTER_VISION_MODEL:'test/vision'},maxCostUsd:1,fetcher});
 const verdict=await judge.judge({label:'good',pngBase64:'AAAA'},{label:'bad',pngBase64:'BBBB'},{goal:'g',requirements:['r'],narration:'n'});
 assert.equal(verdict.preferred,'B');assert.equal(bodies.length,1);assert.deepEqual(bodies[0].response_format,{type:'json_object'});
 const parts=bodies[0].messages[1].content;assert.ok(parts.some(p=>p.type==='image_url'&&p.image_url.url==='data:image/png;base64,AAAA'));assert.ok(parts.some(p=>p.type==='image_url'&&p.image_url.url==='data:image/png;base64,BBBB'));
 assert.equal(judge.calls.length,1);assert.ok(judge.calls[0].costUsd>0);
});
test('V2 vision judge exposes provider failures and unmetered responses',async()=>{
 const failing=createVisionJudge({env:{OPENROUTER_API_KEY:'test',OPENROUTER_VISION_MODEL:'test/vision'},fetcher:async url=>String(url).endsWith('/models')?new Response(JSON.stringify({data:[{id:'test/vision',pricing:{prompt:'0',completion:'0'}}]})):new Response('Unavailable',{status:503})});
 await assert.rejects(failing.judge({label:'a',pngBase64:'A'},{label:'b',pngBase64:'B'},{goal:'g',requirements:[],narration:''}),/503/);
 const unmetered=createVisionJudge({env:{OPENROUTER_API_KEY:'test',OPENROUTER_VISION_MODEL:'test/vision'},fetcher:async url=>String(url).endsWith('/models')?new Response(JSON.stringify({data:[{id:'test/vision',pricing:{prompt:'0',completion:'0'}}]})):new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{}'}}]}))});
 await assert.rejects(unmetered.judge({label:'a',pngBase64:'A'},{label:'b',pngBase64:'B'},{goal:'g',requirements:[],narration:''}),/usage/);
});
