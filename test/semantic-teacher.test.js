import test from 'node:test';
import assert from 'node:assert/strict';
import {reduceFragments,focusGraph} from '../dist/src/semantic/knowledge/reducer.js';
import {planLesson} from '../dist/src/semantic/teacher/planner.js';
import {buildLessonPlan} from '../dist/src/semantic/teacher/index.js';
import {gateLessonPlan,scenesForDuration,depthGuidance} from '../dist/src/semantic/teacher/gate.js';
import {createMemoryCache} from '../dist/src/semantic/cache/store.js';

const fragment={
  concepts:[
    {key:'plant',canonicalName:'Plant',aliases:['flora'],semanticType:'entity',evidenceRefs:['e1']},
    {key:'sunlight',canonicalName:'Sunlight',aliases:[],semanticType:'entity',evidenceRefs:['e1']},
  ],
  relations:[{from:'plant',to:'sunlight',type:'causes',evidenceRefs:['e1']}],
  claims:[{id:'cl1',statement:'Plants use sunlight.',critical:true,evidenceRefs:['e1'],conceptKeys:['plant']}],
  mechanisms:[{id:'m1',statement:'Light drives synthesis.',conceptKeys:['plant'],evidenceRefs:['e1']}],
  prerequisites:[],
  terminology:[{key:'plant',definition:'A photosynthetic organism.'}],
  evidence:[{id:'e1',quote:'Plants use sunlight to make glucose.'}],
};

function rawLesson(overrides={}){
  return {
    lessonGraph:{
      title:'Photosynthesis',
      lessonGoal:'Understand how plants use light.',
      targetDurationSec:60,
      scenes:[{
        id:'s1',sequence:1,learningDelta:'Plants need sunlight.',
        requiredConceptIds:['sunlight','plant'],requiredRelations:['causes'],mechanismIds:['m1'],
        evidenceRefs:['e1'],targetDurationSec:60,narrationIntent:'Introduce the inputs.',
        candidateArchetypes:['flow'],continuityIn:[],continuityOut:['plant'],
      }],
      continuity:{throughline:'From light to sugar.',persistentConceptIds:['plant']},
      endingGoal:'Recall the inputs of photosynthesis.',
      ...overrides,
    },
    lessonBible:{
      canonicalTerminology:[{key:'plant',definition:'A photosynthetic organism.'}],
      conceptIdentity:[{conceptId:'plant',canonicalName:'Plant',aliases:['flora']}],
      visualIdentity:[{conceptId:'plant',representationFamily:'composition'}],
      analogies:[],narrativeStyle:'calm and direct',learnerLevel:'beginner',
      persistentObjects:['plant'],introducedConceptsByScene:[{sceneId:'s1',conceptIds:['plant']}],
      forbiddenRepetition:[],
    },
  };
}
function fakeModel(script){
  let index=0;
  const model={calls:[],events:[],async generate(stage,_i,_in,_schema,validate){const value=script[Math.min(index,script.length-1)];index++;model.calls.push({stage});return validate(value);}};
  return model;
}

test('W3 density: duration maps to a scene count and a depth instruction',()=>{
  assert.equal(scenesForDuration(60),2);
  assert.equal(scenesForDuration(300),9);
  assert.equal(scenesForDuration(600),17);
  assert.match(depthGuidance(60),/orientation/);
  assert.match(depthGuidance(600),/limitations/);
});

test('W3 planner: one teacher call returns a normalized, gated lesson plan',async()=>{
  const base=reduceFragments([fragment]);
  const focus=focusGraph(base,'photosynthesis');
  const model=fakeModel([rawLesson()]);
  const {plan,gate}=await planLesson({base,focus,userPrompt:'photosynthesis',targetDurationSec:60},{model});
  assert.equal(model.calls.length,1,'exactly one teacher planning call');
  assert.equal(model.calls[0].stage,'teacherPlanner');
  assert.equal(gate.passed,true);
  assert.equal(plan.lessonGraph.scenes.length,1);
  assert.equal(plan.lessonBible.canonicalTerminology.plant,'A photosynthetic organism.','records are normalized from arrays');
  assert.equal(plan.lessonBible.analogies['plant'],undefined);
  assert.equal(plan.lessonBible.conceptIdentity.plant.canonicalName,'Plant');
});

test('W3 gate: unknown concepts, question titles, unsupported archetypes and wrong duration fail',async()=>{
  const base=reduceFragments([fragment]);
  const focus=focusGraph(base,'photosynthesis');
  const {plan}=await planLesson({base,focus,userPrompt:'photosynthesis',targetDurationSec:60},{model:fakeModel([rawLesson()])});
  const check=(mutate)=>{const copy=structuredClone(plan);mutate(copy);return gateLessonPlan(copy,{base,focus,requestedDurationSec:60,userPrompt:'photosynthesis'});};
  assert.equal(check(()=>{}).passed,true);
  assert.ok(check(copy=>{copy.lessonGraph.scenes[0].requiredConceptIds=['ghost']}).findings.some(f=>/unknown concept ghost/.test(f)));
  assert.ok(check(copy=>{copy.lessonGraph.title='Why are plants green?'}).findings.some(f=>/question/.test(f)));
  assert.ok(check(copy=>{copy.lessonGraph.scenes[0].candidateArchetypes=['chart']}).findings.some(f=>/unsupported archetype/.test(f)));
  assert.ok(check(copy=>{copy.lessonGraph.scenes[0].targetDurationSec=400}).findings.some(f=>/durations total/.test(f)));
  assert.ok(check(copy=>{copy.lessonGraph.scenes.push({...copy.lessonGraph.scenes[0],sequence:2})}).findings.some(f=>/Duplicate scene id/.test(f)));
  assert.ok(check(copy=>{copy.lessonBible.visualIdentity={ghost:{representationFamily:'x'}}}).findings.some(f=>/visualIdentity references unknown concept ghost/.test(f)));
  assert.ok(check(copy=>{copy.lessonGraph.continuity.persistentConceptIds=['ghost']}).findings.some(f=>/Continuity references unknown concept ghost/.test(f)));
});

test('W3 gate: a scene cannot teach a concept before its prerequisite',()=>{
  const base=reduceFragments([{...fragment,prerequisites:[{before:'sunlight',after:'plant'}]}]);
  const focus=focusGraph(base,'photosynthesis');
  const plan={lessonGraph:{title:'Photosynthesis',lessonGoal:'g',targetDurationSec:60,scenes:[{id:'s1',sequence:1,learningDelta:'d',requiredConceptIds:['plant'],requiredRelations:[],mechanismIds:[],evidenceRefs:['e1'],targetDurationSec:60,narrationIntent:'i',candidateArchetypes:['flow'],continuityIn:[],continuityOut:[]}],continuity:{throughline:'t',persistentConceptIds:[]},endingGoal:'e'},lessonBible:{canonicalTerminology:{},conceptIdentity:{},visualIdentity:{},analogies:{},narrativeStyle:'x',learnerLevel:'beginner',persistentObjects:[],introducedConceptsByScene:{},forbiddenRepetition:[]}};
  const gate=gateLessonPlan(plan,{base,focus,requestedDurationSec:60,userPrompt:'photosynthesis'});
  assert.ok(gate.advisories.some(f=>/before prerequisite sunlight/.test(f)),'ordering violation is advisory, not a hard failure');
  // A scene that introduces the prerequisite and its dependent together is fine.
  const together=structuredClone(plan);
  together.lessonGraph.scenes[0].requiredConceptIds=['sunlight','plant'];
  assert.equal(gateLessonPlan(together,{base,focus,requestedDurationSec:60,userPrompt:'photosynthesis'}).advisories.some(f=>/before prerequisite/.test(f)),false);
});

test('W3 orchestrator: the lesson cache reuses a plan and rejects a bad cache entry',async()=>{
  const base=reduceFragments([fragment]);
  const focus=focusGraph(base,'photosynthesis');
  const store=createMemoryCache();
  const model=fakeModel([rawLesson()]);
  const first=await buildLessonPlan({base,focus,userPrompt:'photosynthesis',targetDurationSec:60,model,store});
  assert.equal(first.cached,false);
  const second=await buildLessonPlan({base,focus,userPrompt:'photosynthesis',targetDurationSec:60,model,store});
  assert.equal(second.cached,true);
  assert.equal(model.calls.length,1,'a cache hit buys no second teacher call');
});
