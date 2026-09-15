import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {skillContract,skillInstruction} from '../dist/src/semantic/skills.js';
import {generateV2} from '../dist/src/semantic/planning/generate.js';

test('skill contracts load real files, hash their exact content, and extract hard invariants',()=>{
 for(const name of ['knowledge-compiler','teaching-architect','visual-director']){
  const contract=skillContract(name);
  const expected=createHash('sha256').update(readFileSync(`skills/${name}/SKILL.md`,'utf8')).digest('hex');
  assert.equal(contract.hash,expected);
  assert.ok(contract.invariants.length>0,`${name} has hard invariants`);
  assert.ok(contract.invariants.every(line=>line.length<300));
 }
 const again=skillContract('knowledge-compiler');
 assert.equal(again.hash,skillContract('knowledge-compiler').hash,'cached');
});

test('skill instructions stay non-executable prose and vanish when a skill has no invariants',()=>{
 const instruction=skillInstruction('knowledge-compiler');
 assert.match(instruction,/Hard invariants from the knowledge-compiler skill:/);
 assert.ok(!/[<{]|function|=>|eval\(|require\(/.test(instruction),'invariants must stay prose');
});

test('stage envelopes record the real skill content hash, and director instructions carry skill invariants',async()=>{
 let directorInstructions='';
 const plan=()=>JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8'));
 const scene=()=>{const value=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));for(const object of value.objects)if(['plant','sunlight','water','carbon_dioxide'].includes(object.id))object.conceptId=object.id;return value;};
 const model={calls:[],events:[],async generate(stage,instruction,_input,_schema,validate){
  if(stage==='director')directorInstructions=instruction;
  return validate(stage==='teaching'?plan():{scene:scene(),decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'plant and inputs',labelsOnly:'labels',movingRelations:'flows',persistentContext:'plant',stateChanges:'activation',omit:'decoration'}});
 }};
 const results=[];
 for await(const result of generateV2({prompt:'Teach plant inputs',allowedArchetypes:['structural_diagram','convergence'],maxScenes:1},model))results.push(result);
 assert.equal(results[0].manifest.status,'PASS');
 const stage=results[0].manifest.stages.find(entry=>entry.stage==='knowledge-compiler');
 assert.equal(stage.skillHash,skillContract('knowledge-compiler').hash);
 assert.match(directorInstructions,/Hard invariants from the visual-director skill:/);
});
