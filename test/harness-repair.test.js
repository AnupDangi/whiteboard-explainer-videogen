import test from 'node:test';
import assert from 'node:assert/strict';
import {executeStage,DEFAULT_STAGE_POLICIES} from '../dist/src/semantic/harness/stage.js';
import {MemoryStageJournal} from '../dist/src/semantic/harness/journal.js';
import {repairOwnerForStage} from '../dist/src/semantic/repair.js';
import {teachingPrompt} from '../dist/src/semantic/planning/prompt-builder.js';

const ok=stage=>({stage,passed:true,findings:[]});
const bad=(stage,code='LEARNER_DELTA')=>({stage,passed:false,findings:[{stage,code,severity:'hard',message:`${code} failed`}]});

test('one owning-stage repair: failed attempt journaled, repaired attempt validated, run not regenerated',async()=>{
 const journal=new MemoryStageJournal();let repairs=0,runs=0;
 const {output,envelope}=await executeStage({stage:'teaching-architect',input:{beat:1},run:()=>{runs++;return {value:'first'};},gate:value=>value.value==='first'?bad('teaching-architect'):ok('teaching-architect'),repair:async context=>{repairs++;assert.equal(context.owner,'teaching-architect');assert.equal(context.attempt,0);assert.equal(context.gate.findings[0].code,'LEARNER_DELTA');return {value:'fixed'};},journal});
 assert.equal(runs,1);assert.equal(repairs,1);assert.equal(output.value,'fixed');assert.equal(envelope.attempt,1);assert.equal(envelope.owner,'teaching-architect');
 assert.equal(journal.entries.length,2);assert.equal(journal.entries[0].status,'FAIL');assert.equal(journal.entries[0].attempt,0);assert.equal(journal.entries[1].attempt,1);assert.equal(journal.entries[1].status,undefined);
});

test('repair exhaustion fails visibly with exactly one retry',async()=>{
 const journal=new MemoryStageJournal();let repairs=0;
 await assert.rejects(()=>executeStage({stage:'visual-director',input:{},run:()=>({value:'first'}),gate:()=>bad('visual-director','VISUAL_SUPPORT'),repair:async()=>{repairs++;return {value:'still-bad'};},journal}),/gate failed/);
 assert.equal(repairs,1);assert.equal(journal.entries.length,2);assert.deepEqual(journal.entries.map(entry=>entry.status),['FAIL','FAIL']);assert.deepEqual(journal.entries.map(entry=>entry.attempt),[0,1]);
});

test('without a repair function a failed gate is a single visible attempt',async()=>{
 const journal=new MemoryStageJournal();
 await assert.rejects(()=>executeStage({stage:'compiler',input:{},run:()=>({value:'x'}),gate:()=>bad('compiler','COMPILE'),journal}),/gate failed/);
 assert.equal(journal.entries.length,1);assert.equal(journal.entries[0].attempt,0);
});

test('a first-attempt run error is offered to the owning repair instead of being regenerated',async()=>{
 const journal=new MemoryStageJournal();let repairs=0;
 const {output,envelope}=await executeStage({stage:'knowledge-compiler',input:{},run:()=>{throw new Error('invalid plan')},gate:()=>ok('knowledge-compiler'),repair:async context=>{repairs++;assert.equal(context.error.message,'invalid plan');return {value:'corrected'};},journal});
 assert.equal(repairs,1);assert.equal(output.value,'corrected');assert.equal(envelope.attempt,1);assert.equal(journal.entries.length,2);
});

test('stages with maxRepairs zero never invoke a supplied repair',async()=>{
 const journal=new MemoryStageJournal();let repairs=0;
 await assert.rejects(()=>executeStage({stage:'representation-guide',input:{},run:()=>({value:'x'}),gate:()=>bad('representation-guide','REPRESENTATION_DEGRADATION'),repair:async()=>{repairs++;return {value:'y'};},journal}),/gate failed/);
 assert.equal(repairs,0);assert.equal(DEFAULT_STAGE_POLICIES['representation-guide'].maxRepairs,0);assert.equal(DEFAULT_STAGE_POLICIES.compiler.maxRepairs,0);assert.equal(DEFAULT_STAGE_POLICIES['knowledge-compiler'].maxRepairs,1);
});

test('repair ownership routes by failure class and failing stage',()=>{
 assert.equal(repairOwnerForStage({class:'REPRESENTATION',stage:'representation'}),'representation-resolver');
 assert.equal(repairOwnerForStage({class:'GEOMETRY',stage:'compiler'}),'compiler');
 assert.equal(repairOwnerForStage({class:'TIMING',stage:'timeline'}),'timeline');
 assert.equal(repairOwnerForStage({class:'SPEECH',stage:'tts'}),'speech-layer');
 assert.equal(repairOwnerForStage({class:'PROVIDER',stage:'knowledge-compiler'}),'model-router');
 assert.equal(repairOwnerForStage({class:'SEMANTIC',stage:'knowledge-compiler'}),'knowledge-compiler');
 assert.equal(repairOwnerForStage({class:'SEMANTIC',stage:'teaching-architect'}),'teaching-architect');
 assert.equal(repairOwnerForStage({class:'SEMANTIC',stage:'whiteboard-planner'}),'whiteboard-planner');
 assert.equal(repairOwnerForStage({class:'SEMANTIC',stage:'visual-director'}),'visual-director');
});

test('repair prompts carry bounded findings and forbid upstream regeneration',()=>{
 const base=teachingPrompt({maxScenes:2,hasSource:false});
 const repaired=teachingPrompt({maxScenes:2,hasSource:false,repairNotes:['PREREQUISITE_ORDER: water is used before it is taught']});
 assert.equal(base.includes('previous attempt failed'),false);
 assert.match(repaired,/PREREQUISITE_ORDER/);
 assert.match(repaired,/Do not regenerate unrelated content/);
});
