import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gateBoardAlignment} from '../dist/src/semantic/harness/gates.js';
import {conceptGraphFromPlan,contractsFromScene,defaultLearnerProfile,initialLearnerState,whiteboardPlanFromContracts} from '../dist/src/semantic/harness/state.js';
import {WHITEBOARD_ALIGNMENT_RULE,directorPrompt} from '../dist/src/semantic/planning/prompt-builder.js';
import {generateV2} from '../dist/src/semantic/planning/generate.js';

const plan=()=>JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8'));
const scene=()=>{const value=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));for(const object of value.objects)if(['plant','sunlight','water','carbon_dioxide'].includes(object.id))object.conceptId=object.id;return value;};
const model=()=>({calls:[],events:[],async generate(stage,_instructions,_input,_schema,validate){return validate(stage==='teaching'?plan():{scene:scene(),decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'plant and inputs',labelsOnly:'labels',movingRelations:'flows',persistentContext:'plant',stateChanges:'activation',omit:'decoration'}});}});
const board=()=>{const teaching=plan(),scenePlan=teaching.scenes[0],before=initialLearnerState(defaultLearnerProfile('en'));return whiteboardPlanFromContracts(scenePlan,contractsFromScene(scenePlan,teaching,before));};

test('the fixture whiteboard plan aligns beat for beat with the fixture scene',()=>{
 assert.equal(gateBoardAlignment(board(),scene()).passed,true);
});

test('an INTRODUCE concept must be drawn or revealed in its own beat',()=>{
 const value=scene(),valueboard=board();
 valueboard.beats[0].diffs.unshift({operation:'INTRODUCE',semanticKeys:['water'],reason:'test'});
 const gate=gateBoardAlignment(valueboard,value);
 assert.equal(gate.passed,false);assert.ok(gate.findings.some(f=>f.code==='VISUAL_SUPPORT'&&f.message.includes('INTRODUCE water')));
});

test('a PRESERVED concept must not be re-drawn in its preserve beat',()=>{
 const value=scene(),valueboard=board();
 valueboard.beats[1].diffs.push({operation:'PRESERVE',semanticKeys:['sunlight'],reason:'test'});
 const gate=gateBoardAlignment(valueboard,value);
 assert.equal(gate.passed,false);assert.ok(gate.findings.some(f=>f.code==='CONTINUITY'&&f.message.includes('PRESERVE sunlight')));
});

test('a TRANSFORM requires a state-changing action reaching the required toState',()=>{
 const value=scene(),valueboard=board();
 valueboard.beats[2].diffs.push({operation:'TRANSFORM',semanticKeys:['plant'],reason:'test',fromState:'neutral',toState:'activated'});
 const gate=gateBoardAlignment(valueboard,value);
 assert.equal(gate.passed,false);assert.ok(gate.findings.some(f=>f.code==='VISUAL_SUPPORT'&&f.message.includes('TRANSFORM plant')));
});

test('an aligned TRANSFORM diff passes when the beat reaches the toState',()=>{
 const value=scene();
 value.beats[2].actions.push({id:'activate_plant',type:'morph',objectIds:['plant'],relationIds:[],durationMs:1200,leadMs:-180,easing:'linear',fromState:'neutral',toState:'activated'});
 const valueboard=board();valueboard.beats[2].diffs.push({operation:'TRANSFORM',semanticKeys:['plant'],reason:'test',fromState:'neutral',toState:'activated'});
 const gate=gateBoardAlignment(valueboard,value);
 assert.equal(gate.passed,true);
});

test('beat-count mismatch between plan and scene fails closed',()=>{
 const valueboard=board();valueboard.beats.push({...valueboard.beats[0]});
 const gate=gateBoardAlignment(valueboard,scene());
 assert.equal(gate.passed,false);assert.match(gate.findings[0].message,/beats but the scene/);
});

test('the director prompt carries canvas-diff discipline only when a plan is supplied',()=>{
 assert.match(directorPrompt({whiteboard:true}),new RegExp(WHITEBOARD_ALIGNMENT_RULE.slice(0,40)));
 assert.equal(directorPrompt().includes('PRESERVE'),false);
});

test('generateV2 enforces board alignment end to end without changing renderer contracts',async()=>{
 const results=[];for await(const result of generateV2({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],maxScenes:1},model()))results.push(result);
 const director=results[0].gates.filter(gate=>gate.stage==='visual-director');
 assert.equal(results.length,1);assert.equal(results[0].manifest.status,'PASS');
 assert.equal(director.length,1);assert.equal(director[0].passed,true);
 assert.equal(gateBoardAlignment(results[0].whiteboardPlan,results[0].directed.scene).passed,true);
});
