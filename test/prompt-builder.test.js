import test from 'node:test';
import assert from 'node:assert/strict';
import {teachingPrompt,directorPrompt,criticRepairPrompt,TEACHER_VOICE_RULES,MATH_TEACHING_RULES,STYLE_FAMILY,assertPromptVocabulary} from '../dist/src/semantic/planning/prompt-builder.js';
import {lintTeacherVoice} from '../dist/src/semantic/planning/validate.js';
import {MOTIONS} from '../dist/src/semantic/types.js';

test('teaching prompt contains pedagogy, vocabulary and source rules',()=>{
  const p=teachingPrompt({maxScenes:3,hasSource:true});
  for(const rule of TEACHER_VOICE_RULES)assert.ok(p.includes(rule),`missing teacher rule: ${rule}`);
  for(const rule of MATH_TEACHING_RULES)assert.ok(p.includes(rule),`missing math rule: ${rule}`);
  assert.ok(p.includes('at most 3 scenes'));
  assert.ok(p.includes('quote exact source spans'));
  assert.ok(p.includes('step one'.length?'Step 1':''));
});
test('teaching prompt forbids inventing sources when absent',()=>{
  const p=teachingPrompt({maxScenes:1,hasSource:false});
  assert.ok(p.includes('evidenceRefs arrays stay empty'));
  assert.ok(!p.includes('quote exact source spans'));
});
test('director prompt carries richness, style and archetype guidance',()=>{
  const p=directorPrompt({archetype:'equation_walkthrough'});
  assert.ok(p.includes(`Supported actions: ${MOTIONS.join(',')}`),'the prompt must advertise exactly the implemented motions');
  assert.ok(p.includes(STYLE_FAMILY));
  assert.ok(p.includes('equation_walkthrough archetype'));
  assert.ok(p.includes('persistent context visible'));
});
test('critic repair prompt lists every error and forbids identity change',()=>{
  const p=criticRepairPrompt({criticalErrors:['arrow points the wrong way','hero is missing'],reason:'layout broke teaching'});
  assert.ok(p.includes('- arrow points the wrong way'));
  assert.ok(p.includes('- hero is missing'));
  assert.ok(p.includes('layout broke teaching'));
  assert.ok(p.includes('same scene identity'));
  assert.throws(()=>criticRepairPrompt({criticalErrors:[],reason:'x'}));
});
test('prompt vocabulary drift guard passes and catches drift',()=>{
  assertPromptVocabulary();
});
test('teacher-voice lints accept real narration and reject slide-bullet patterns',()=>{
  lintTeacherVoice('A plant makes its own food. Watch how its leaves and roots collect what it needs.','b1');
  lintTeacherVoice('Water enters through the roots and travels up the stem toward the leaves.','b2');
  assert.throws(()=>lintTeacherVoice('Step 1: sunlight arrives at the leaf surface.','b3'));
  assert.throws(()=>lintTeacherVoice('First step, look at the diagram.','b4'));
  assert.throws(()=>lintTeacherVoice('Next slide shows water.','b5'));
  assert.throws(()=>lintTeacherVoice('Too short.','b6'));
});
