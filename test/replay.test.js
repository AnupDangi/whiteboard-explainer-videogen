import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {assertSchema,healSchema} from '../dist/src/semantic/schemas.js';
import {teachingIntentSchema} from '../dist/src/semantic/identity/runtime-schemas.js';
import {validateTeachingPlan} from '../dist/src/semantic/planning/validate.js';
import {teachingIntentToPlan} from '../dist/src/semantic/identity/intent-adapter.js';
import {validateKnowledge} from '../dist/src/semantic/planning/knowledge-compiler.js';
import {ARCHETYPES} from '../dist/src/semantic/types.js';

/** Replay corpus: raw model outputs captured from live failures (2026-09-15/16).
 *  Each fixture replays through the exact gate that rejected it, so every live
 *  whack-a-mole hit becomes a deterministic regression. */

const fixture=async name=>JSON.parse(await readFile(`test/fixtures/replay/${name}.json`,'utf8'));
const intent=p=>{const {plan}=validateTeachingPlan?{plan:null}:{plan:null};return p;};

test('replay: teaching responses are still rejected when the root is a bare array',async()=>{
 const f=await fixture('root-array');
 assert.throws(()=>assertSchema(f.payload,teachingIntentSchema),/\$: expected object/);
});

test('replay: empty intentionalPause strings are healed, not fatal',async()=>{
 const f=await fixture('intentional-pause');
 assert.throws(()=>assertSchema(f.payload,teachingIntentSchema),/intentionalPause: invalid string/,'records the original live failure');
 const healed=healSchema(f.payload,teachingIntentSchema);
 assertSchema(healed,teachingIntentSchema);
 for(const scene of healed.scenes)for(const beat of scene.beats)assert.ok(beat.intentionalPause===undefined||String(beat.intentionalPause).trim(),'no empty pause survives');
});

test('replay: a plan-level evidence id that is not in the knowledge inventory still fails',async()=>{
 const f=await fixture('untaught-relation');
 assert.throws(()=>validateTeachingPlan(teachingIntentToPlan(f.payload)),/Untaught relation|Missing|Unknown/);
});

test('replay: beat references to unknown concepts are rejected',async()=>{
 const f=await fixture('unknown-concept');
 assert.throws(()=>validateTeachingPlan(teachingIntentToPlan(f.payload)),/Unknown concept: prefill_activation/);
});

test('replay: a beat citing evidence the plan never declared drops the citation',async()=>{
 const f=await fixture('unknown-evidence');
 // The beat keeps its narration and concepts; only the dangling citation goes.
 // Measured: `Unknown evidence: e6` failed a source-grounded run outright over an
 // id the model invented while quoting real text. Unknown CONCEPTS still reject
 // (above) - a concept is what the beat teaches, a citation is bookkeeping.
 const {plan}=validateTeachingPlan(teachingIntentToPlan(f.payload));
 const refs=plan.scenes.flatMap(scene=>scene.beats.flatMap(beat=>beat.evidenceRefs));
 assert.equal(refs.includes('ev_csa2_reduction'),false,'the undeclared citation is dropped');
});

test('replay: knowledge formula evidence now snaps to the math-italic source instead of failing',async()=>{
 const f=await fixture('fabricated-formula');
 const payload=f.payload;
 payload.evidence=[payload.evidence.find(e=>e.id==='ev_penalty_formula')];
 payload.claims=payload.claims.map(c=>({...c,evidenceRefs:['ev_penalty_formula']}));
 payload.mechanisms=payload.mechanisms.map(m=>({...m,evidenceRefs:['ev_penalty_formula']}));
 payload.quantities=payload.quantities.map(q=>({...q,evidenceRefs:['ev_penalty_formula']}));
 payload.concepts=payload.concepts.map(c=>({...c,evidenceRefs:['ev_penalty_formula']}));
 const coefficient='\u{1D458}',b='\u{1D466}',tau='\u{1D70F}';
 const scope=`The token-penalty coefficient decreases exponentially with the requested effort:\n${coefficient}(${b}) = ${coefficient}0 exp\n\u0012\n\u2212\n${b} \u2212 ${b}min\n${tau}\n\u0013\n, (12)\nwhere ${coefficient}0 is the penalty coefficient at the lowest effort level ${b}min and ${tau} controls the rate of penalty decay.`;
 const healed=validateKnowledge(payload,scope);
 assert.ok(scope.includes(healed.evidence[0].quote),'the formula quote snapped to real source text');
});

test('replay: document-keyed evidence with a verbatim quote is bridged, not fabricated',async()=>{
 const f=await fixture('sourceid-evidence');
 const payload=f.payload;
 const graph={version:1,
  concepts:payload.conceptRegistry.map(c=>({id:c.key,canonicalName:c.canonicalName,aliases:c.aliases,semanticType:c.semanticType,visualFamily:c.visualFamily})),
  aliases:{},prerequisites:[],mechanisms:payload.requiredMechanisms.map(m=>({id:m.id,statement:m.statement,conceptIds:m.conceptKeys,requiresStateChange:m.requiresStateChange,evidenceRefs:[]})),
  claims:payload.requiredClaims.map(c=>({id:c.id,statement:c.statement,critical:c.critical,evidenceRefs:[]})),
  terminology:{},quantities:[],
  evidence:[{id:'ev_real',sourceId:'source',quote:'Real source sentence about the KV cache footprint.'}],
  sourceVisuals:[]};
 const scope=payload.evidenceRefs.map(entry=>entry.quote).join(' ');
 const {planTeaching}=await import('../dist/src/semantic/planning/teaching-planner.js');
 const model={generate:async(_s,_i,_inp,_schema,validate)=>validate(structuredClone(payload))};
 /** Thin-teaching: the document-keyed id is NOT in the compiled inventory, so
  *  the entry is dropped - with no grounded evidence left the plan is
  *  rejected rather than published with ungrounded beats. */
 await assert.rejects(planTeaching({prompt:'teach kv cache',sourceText:scope,evidenceScope:scope,sourceId:'src_dc9a790964b67d2b85361fbfb6a4',allowedArchetypes:ARCHETYPES,maxScenes:4},model,{conceptGraph:graph}),/requires evidence|lacks evidence|Unknown evidence/);
});
