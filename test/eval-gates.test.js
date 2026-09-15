import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMigrationGates} from '../dist/eval/live/gates.js';
import {expectedLearnerCoverage} from '../dist/eval/live/metrics.js';
import {LIVE_EVAL_CASES,SMOKE_CASE_IDS,LONG_FORM_CASES,LIVE_EVAL_CATEGORIES,caseSource,getCase} from '../dist/eval/live/manifest.js';
import {chapterWindows} from '../dist/src/semantic/planning/knowledge-compiler.js';
import {aggregateReport,reportToMarkdown} from '../dist/eval/live/compare.js';

const metric=overrides=>({
  sourceUnderstandingSuccess:true,teachingPlanSuccess:true,storyboardSuccess:true,mentalModelSuccess:true,representationResolutionSuccess:true,visualDirectionSuccess:true,sceneGraphSuccess:true,compileSuccess:true,timelineSuccess:true,ttsSuccess:false,fullJobSuccess:true,partialJob:false,
  plannerRepairCount:0,directorRepairCount:0,representationFallbackCount:0,geometryRepairCount:0,timelineRepairCount:0,ttsFallbackCount:0,invalidReferenceCount:0,missingRepresentationCount:0,schemaRetryCount:0,modelRetryCount:0,
  firstAVPlayableMs:null,fullPlayableMs:null,firstVisualReadyMs:null,
  criticalClaimCoverage:1,conceptCoverage:1,relationshipCoverage:1,archetypeAppropriate:true,forbiddenPatternCount:0,criticalAssetRoleCoverage:1,
  normalizationCount:0,staticIntervalCount:0,continuityPreservationRate:1,unexplainedResetCount:0,teachingFailureCount:0,...overrides});
const run=(overrides={},metrics={})=>({caseId:'c',runIndex:0,runId:'r',modelConfigHash:'h',envHash:'e',status:'complete',scenes:[],metrics:metric({...metrics,...(overrides.metrics||{})}),rawModelEvents:[],telemetryEvents:[],startedAt:'',finishedAt:''});
const report=over=>({
  generatedAt:'',configHash:'',totalCases:1,totalRuns:2,
  stageSuccess:{compileSuccess:{pass:2,fail:0,rate:100},fullJobSuccess:{pass:2,fail:0,rate:100}},
  byCategory:{},byArchetype:{},repairs:{},failureTaxonomy:{},latency:{},cost:{P50:0,P95:0,mean:0,total:0},stageAccounting:{},
  dimensions:{truth:1,teaching:1,visual:1,timing:1,continuity:0.95,reliability:1,performance:{firstAVP50Ms:9000},cost:{meanUsd:0.01}},
  migrationGates:[],caseResults:[],regressions:[],limitations:[],...over});

test('migration gates pass a healthy report and stay pending on human protocols',()=>{
  const result=evaluateMigrationGates(report(),[run(),run({},{}),run({caseId:'x'})].slice(0,2));
  assert.equal(result.gates.length,11);
  assert.equal(result.allPassed,true);
  assert.equal(result.pendingHuman,4);
  const failing=evaluateMigrationGates(report({dimensions:{truth:1,teaching:1,visual:1,timing:1,continuity:0.7,reliability:1,performance:{firstAVP50Ms:9000},cost:{meanUsd:0.01}}}),[run()]);
  const continuity=failing.gates.find(gate=>gate.id==='continuity');
  assert.equal(continuity.pass,false);
  assert.equal(failing.allPassed,false);
});

test('migration gates fail closed on empty evidence and name human-pending gates',()=>{
  const empty=evaluateMigrationGates(report({stageSuccess:{},dimensions:{truth:0,teaching:0,visual:0,timing:0,continuity:0,reliability:0,performance:{firstAVP50Ms:0},cost:{meanUsd:0}}}),[]);
  assert.equal(empty.allPassed,false);
  for(const id of ['blind_human_preference','comprehension_gain','browser_export_determinism']){
    const gate=empty.gates.find(candidate=>candidate.id===id);
    assert.equal(gate.pass,null);
  }
  const firstAv=empty.gates.find(gate=>gate.id==='first_av_p50');
  assert.equal(firstAv.pass,null,'no data means no claim');
});

test('every smoke case carries the comprehension protocol; coverage is structural',()=>{
  for(const id of SMOKE_CASE_IDS){
    const item=getCase(id);
    assert.ok(item.comprehension&&item.comprehension.length>=3,`${id} lacks comprehension questions`);
    const kinds=new Set(item.comprehension.map(question=>question.kind));
    assert.ok(kinds.has('factual')&&kinds.has('mechanism')&&kinds.has('transfer'),`${id} misses a question kind`);
  }
  assert.equal(expectedLearnerCoverage(getCase('photosynthesis_inputs').comprehension,['Plant','Sunlight','Water','Carbon Dioxide','Leaf','Roots','Photosynthesis']),1);
  assert.equal(expectedLearnerCoverage(getCase('photosynthesis_inputs').comprehension,['plant','leaf','roots']),0.333);
  assert.equal(expectedLearnerCoverage(undefined,[]),undefined);
  assert.equal(expectedLearnerCoverage(getCase('photosynthesis_inputs').comprehension,undefined),0);
});

test('the fixed long-form document case is present, sized for chapter windows, and readable',()=>{
  assert.equal(LONG_FORM_CASES.length,1);
  const item=LONG_FORM_CASES[0];
  assert.equal(item.sourceFixture,'deepseek-report-excerpt.md');
  assert.equal(item.category,'long_document');
  assert.equal(item.maxScenes,4);
  assert.ok(item.comprehension.some(question=>question.kind==='mechanism'));
  const text=caseSource(item);
  assert.ok(text.length>12000,`fixture must exceed the chapter-window threshold, got ${text.length}`);
  const windows=chapterWindows(text);
  assert.ok(windows.length>=2,`expected chapter windows, got ${windows.length}`);
  assert.ok(item.expectedConcepts.includes('latent')&&item.expectedConcepts.includes('cache'));
  assert.ok(LIVE_EVAL_CATEGORIES.includes('long_document'));
  assert.ok(LIVE_EVAL_CASES.length>=48);
});

test('the aggregated report embeds machine-evaluated migration gates in JSON and Markdown',()=>{
  const runs=[run(),run()];
  const aggregate=aggregateReport([getCase('photosynthesis_inputs')],runs,'hash');
  assert.ok(Array.isArray(aggregate.migrationGates)&&aggregate.migrationGates.length===11);
  const markdown=reportToMarkdown(aggregate);
  assert.match(markdown,/## Migration gates \(machine-evaluated\)/);
  assert.match(markdown,/blind_human_preference/);
  assert.match(markdown,/PENDING-HUMAN/);
});
