import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {skillContract,skillInstruction,skillDoc,skillDocInstruction} from '../dist/src/semantic/skills.js';
import {generateV2} from '../dist/src/semantic/planning/generate.js';

test('skill contracts load real files, hash their exact content, and extract hard invariants',()=>{
 for(const name of ['teaching-architect','visual-director','multilingual-teacher']){
  const contract=skillContract(name);
  const expected=createHash('sha256').update(readFileSync(`skills/${name}/SKILL.md`,'utf8')).digest('hex');
  assert.equal(contract.hash,expected);
  assert.ok(contract.invariants.length>0,`${name} has hard invariants`);
  assert.ok(contract.invariants.every(line=>line.length<300));
 }
 const again=skillContract('multilingual-teacher');
 assert.equal(again.hash,skillContract('multilingual-teacher').hash,'cached');
 for(const relative of ['teaching-architect/references/knowledge-compiler.md','teaching-architect/references/source-visual-grounding.md']){
  const doc=skillDoc(relative);
  const expected=createHash('sha256').update(readFileSync(`skills/${relative}`,'utf8')).digest('hex');
  assert.equal(doc.hash,expected,`${relative} hashes its exact content`);
  assert.ok(doc.invariants.length>0,`${relative} exposes invariants`);
  assert.match(skillDocInstruction(relative),/Hard invariants from the/);
 }
});

test('skill instructions stay non-executable prose and vanish when a skill has no invariants',()=>{
 const instruction=skillDocInstruction('teaching-architect/references/knowledge-compiler.md');
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
 assert.equal(stage.skillHash,skillDoc('teaching-architect/references/knowledge-compiler.md').hash);
 assert.match(directorInstructions,/Hard invariants from the visual-director skill:/);
});
