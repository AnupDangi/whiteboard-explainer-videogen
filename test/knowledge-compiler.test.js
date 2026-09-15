import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {readFileSync} from 'node:fs';
import {makeWav} from './wav.js';
import {validateKnowledge,compileKnowledge,chapterWindows,mergeGroundedPlans,knowledgeGraphSchema} from '../dist/src/semantic/planning/knowledge-compiler.js';
import {conceptGraphFromPlan,contractsFromScene,stableHash} from '../dist/src/semantic/harness/state.js';
import {planTeaching} from '../dist/src/semantic/planning/teaching-planner.js';
import {generateV2} from '../dist/src/semantic/planning/generate.js';
import {selectSourceVisuals} from '../dist/src/semantic/planning/knowledge-compiler.js';
import {createVoiceEngineSpeech} from '../dist/src/semantic/speech.js';

const SOURCE='Plants make food using sunlight, water and carbon dioxide. Leaves capture sunlight for energy. Roots absorb water from the soil. Leaves take in carbon dioxide from the air. Inputs enable plant food production.';
const CONCEPT=(key,canonicalName,aliases,semanticType='entity')=>({key,canonicalName,aliases,semanticType,evidenceRefs:['ev_light']});
const validKnowledge=()=>({
 version:1,
 concepts:[CONCEPT('plant','Plant',['Plants']),CONCEPT('sunlight','Sunlight',['light']),CONCEPT('water','Water',['H2O'],'material'),CONCEPT('carbon_dioxide','Carbon dioxide',['CO2'],'material')],
 prerequisites:[{before:'sunlight',after:'plant',reason:'light energy precedes food production'}],
 mechanisms:[{id:'inputs_mechanism',statement:'Inputs enable plant food production',conceptIds:['plant','sunlight','water','carbon_dioxide'],requiresStateChange:false,evidenceRefs:['ev_light']}],
 claims:[
  {id:'light_claim',statement:'Leaves capture sunlight',critical:true,evidenceRefs:['ev_light']},
  {id:'water_claim',statement:'Roots absorb water',critical:true,evidenceRefs:['ev_water']},
  {id:'carbon_claim',statement:'Leaves take in carbon dioxide',critical:true,evidenceRefs:['ev_carbon']}],
 quantities:[{conceptKey:'water',value:'continuous supply',evidenceRefs:['ev_water']}],
 terminology:[{key:'plant',definition:'A green organism that makes its own food'},{key:'sunlight',definition:'Light energy from the sun'}],
 evidence:[
  {id:'ev_light',sourceId:'src_test',quote:'Leaves capture sunlight'},
  {id:'ev_water',sourceId:'src_test',quote:'Roots absorb water'},
  {id:'ev_carbon',sourceId:'src_test',quote:'Leaves take in carbon dioxide'},
  {id:'ev_mech',sourceId:'src_test',quote:'Inputs enable plant food production'}]
});

test('a valid knowledge graph collapses aliases and returns the truth layer',()=>{
 const graph=validateKnowledge(validKnowledge(),SOURCE);
 assert.equal(graph.concepts.length,4);
 assert.equal(graph.aliases['plants'],'plant');
 assert.equal(graph.aliases['h2_o'],'water');
 assert.equal(graph.aliases['v41_flash'],undefined);
 assert.equal(graph.claims.length,3);assert.equal(graph.claims.every(claim=>claim.evidenceRefs.length>0),true);
 assert.equal(stableHash(graph).length,64);
});

test('skill eval:alias-collapse merges spelling variants into one key',()=>{
 const merged=validKnowledge();
 merged.concepts.push({...CONCEPT('v41_flash','V41 Flash',['v41-flash','v41-flash-total'])});
 const graph=validateKnowledge(merged,SOURCE);
 assert.equal(graph.aliases['v41_flash'],'v41_flash');
 assert.equal(graph.aliases['v41_flash_total'],'v41_flash');
 assert.equal(new Set(Object.values(graph.aliases).filter(target=>target.startsWith('v41'))).size,1);
});

test('skill invariants: alias forks, cycles, orphan claims and fabricated evidence reject',()=>{
 const fork=validKnowledge();fork.concepts.push({...CONCEPT('light_ray','Light ray',['light'])});
 const healed=validateKnowledge(fork,SOURCE);
 assert.equal(healed.aliases['light'],undefined,'ambiguous surface alias drops');
 assert.equal(healed.concepts.find(c=>c.id==='sunlight').aliases.includes('light'),false,'conflicting alias removed');
 assert.equal(healed.concepts.find(c=>c.id==='light_ray').aliases.includes('light'),false);
 const canonicalFork=validKnowledge();canonicalFork.concepts.push({...CONCEPT('water_two','Water',[])});
 assert.throws(()=>validateKnowledge(canonicalFork,SOURCE),/Canonical identity conflict/);
 const cycle=validKnowledge();cycle.prerequisites=[{before:'plant',after:'sunlight',reason:'x'},{before:'sunlight',after:'plant',reason:'y'}];
 assert.throws(()=>validateKnowledge(cycle,SOURCE),/cycle/);
 const orphan=validKnowledge();orphan.claims[0].evidenceRefs=[];
 assert.throws(()=>validateKnowledge(orphan,SOURCE),/no verbatim evidence/);
 const fabricated=validKnowledge();fabricated.evidence[0].quote='Leaves photosynthesize moonlight on Tuesdays';
 assert.throws(()=>validateKnowledge(fabricated,SOURCE),/Fabricated evidence/);
 const unknown=validKnowledge();unknown.mechanisms[0].evidenceRefs=['ev_ghost'];
 assert.throws(()=>validateKnowledge(unknown,SOURCE),/Unknown evidence/);
 const badEdge=validKnowledge();badEdge.prerequisites=[{before:'plant',after:'chloroplast',reason:'x'}];
 assert.throws(()=>validateKnowledge(badEdge,SOURCE),/Invalid prerequisite edge/);
});

test('schema forbids geometry, ids, code and unknown fields in the knowledge contract',()=>{
 const raw=validKnowledge();
 raw.concepts[0].x=12;
 assert.throws(()=>validateKnowledge(raw,SOURCE),/additional property/);
 const code=(validKnowledge());
 code.mechanisms[0].script='eval(1)';
 assert.throws(()=>validateKnowledge(code,SOURCE),/additional property/);
 const shape=knowledgeGraphSchema;
 assert.equal(shape.properties.concepts.items.type,'object');
});

const fixturePlan=()=>{
 const plan=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.teaching.json','utf8'));
 plan.evidenceRefs=[
  {id:'ev_light',sourceId:'src_test',quote:'Leaves capture sunlight'},
  {id:'ev_water',sourceId:'src_test',quote:'Roots absorb water'},
  {id:'ev_carbon',sourceId:'src_test',quote:'Leaves take in carbon dioxide'},
  {id:'ev_mech',sourceId:'src_test',quote:'Inputs enable plant food production'}];
 for(const requirement of [...plan.requiredClaims,...plan.requiredMechanisms])requirement.evidenceRefs=['ev_light'];
 for(const scene of plan.scenes)for(const beat of scene.beats)beat.evidenceRefs=['ev_light'];
 return plan;
};

test('grounded planning rejects concepts, evidence and requirements outside the inventory',async()=>{
 const graph=conceptGraphFromPlan(fixturePlan());
 const model={calls:[],events:[],async generate(stage,_instructions,_input,_schema,validate){return validate(fixturePlan());}};
 await assert.rejects(()=>planTeaching({prompt:'Teach plant inputs',sourceText:SOURCE,sourceId:'src_test',allowedArchetypes:['structural_diagram','convergence']},model,{conceptGraph:{...graph,concepts:graph.concepts.filter(c=>c.id!=='carbon_dioxide')}}),/Concept outside knowledge inventory: carbon_dioxide/);
 const plan=await planTeaching({prompt:'Teach plant inputs',sourceText:SOURCE,sourceId:'src_test',allowedArchetypes:['structural_diagram','convergence']},model,{conceptGraph:graph});
 assert.equal(plan.version,2);assert.equal(model.calls.length,0);
});

const sceneJson=()=>{
 const value=JSON.parse(readFileSync('examples/semantic/photosynthesis-plant.scene.json','utf8'));
 for(const object of value.objects)if(['plant','sunlight','water','carbon_dioxide'].includes(object.id))object.conceptId=object.id;
 return value;
};
const architectPayload=(input,planJson)=>({contracts:contractsFromScene(input.scene,planJson,input.learnerState).map((contract,index)=>({beatKey:input.scene.beats[index].id,objective:contract.objective,motivation:contract.motivation,prerequisites:contract.prerequisites,learnerDelta:contract.learnerDelta,strategy:contract.strategy,mechanismIds:contract.mechanismIds,evidenceRefs:contract.evidenceRefs,...(contract.misconception?{misconception:contract.misconception}:{}),...(contract.checkpoint?{checkpoint:{prompt:contract.checkpoint.prompt,expectedUnderstanding:contract.checkpoint.expectedUnderstanding,kind:contract.checkpoint.kind}}:{})}))});
const groundedModel=(knowledgeJson,planJson)=>({
 calls:[],events:[],
 async generate(stage,_instructions,input,_schema,validate){
  this.calls.push({stage});
  if(stage==='knowledge')return validate(knowledgeJson);
  if(stage==='teaching')return validate(planJson);
  if(stage==='architect')return validate(architectPayload(input,planJson));
  const s=sceneJson();s.id=input.semanticScene.id;
  return validate({scene:s,decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'plant and inputs',labelsOnly:'labels',movingRelations:'flows',persistentContext:'plant',stateChanges:'activation',omit:'decoration'}});
 }
});

test('generateV2 runs the real knowledge stage before teaching on grounded sources',async()=>{
 const results=[];
 for await(const result of generateV2({prompt:'Teach plant inputs',sourceText:SOURCE,sourceId:'src_test',allowedArchetypes:['structural_diagram','convergence'],maxScenes:1},groundedModel(validKnowledge(),fixturePlan())))results.push(result);
 assert.equal(results.length,1);assert.equal(results[0].manifest.status,'PASS');
 assert.deepEqual([...new Set(results[0].manifest.stages.map(stage=>stage.stage))].slice(0,3),['ingest','knowledge-compiler','teaching-architect']);
 assert.ok(results[0].manifest.stages.find(stage=>stage.stage==='knowledge-compiler'));
 assert.equal(results[0].conceptGraph.claims.length,3);
 assert.equal(results[0].conceptGraph.aliases['plants'],'plant');
});

test('grounded narration flows through the bundled voice engine',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'knowledge-ve-')),audioPath=join(dir,'scene.wav');
 await writeFile(audioPath,makeWav(60));
 const speech=createVoiceEngineSpeech({run:async()=>({audioPath,provider:'supertonic',language:'en',voice:'F3',generationMs:10,audioDurationMs:2000,rtf:0.005})});
 let narrated;
 for await(const result of generateV2({prompt:'Teach plant inputs',sourceText:SOURCE,sourceId:'src_test',allowedArchetypes:['structural_diagram','convergence'],maxScenes:1},groundedModel(validKnowledge(),fixturePlan()),{speech}))narrated=result;
 assert.equal(narrated.speech.audio.toString('ascii',0,4),'RIFF');
 assert.equal(narrated.speech.provider,'supertonic');
 assert.equal(narrated.compiled.timing.kind,'engine');
 assert.equal(narrated.compiled.timing.timingSource,'semantic-segment');
 assert.equal(narrated.compiled.timing.durationMs,2000*narrated.teachingContracts.length);
});

const filler=(marker,chars=580)=>`${'lorem ipsum dolor sit amet '.repeat(22).slice(0,chars-30).trim()} ${marker}`;

test('chapter windows split long documents deterministically on paragraph bounds',()=>{
 const text=[filler('a'),filler('b'),filler('c'),filler('d')].join('\n\n');
 const windows=chapterWindows(text,700);
 assert.equal(windows.length,4);
 assert.deepEqual(windows.map(w=>w.id),['chapter:1','chapter:2','chapter:3','chapter:4']);
 assert.deepEqual(windows.flatMap(w=>w.text.match(/[a-d](?=\s|$)/g)),['a','b','c','d']);
 assert.deepEqual(chapterWindows('short',700).length,1);
 assert.deepEqual(windows.flatMap(w=>w.text.match(/[a-d](?=\s|$)/g)).sort(),['a','b','c','d']);
});

test('mergeGroundedPlans dedupes identical meaning and renames colliding ids deterministically',()=>{
 const graph=conceptGraphFromPlan(fixturePlan());
 const base=fixturePlan();
 const first={...base,scenes:[{...base.scenes[0]}]};
 const revisited=structuredClone(base);
 revisited.requiredClaims=revisited.requiredClaims.map(claim=>({...claim,statement:`${claim.statement} (revisited)`}));
 revisited.requiredMechanisms=revisited.requiredMechanisms.map(mechanism=>({...mechanism,statement:`${mechanism.statement} (revisited)`}));
 revisited.scenes[0].continuity.keepFromPrevious=['plant'];
 const merged=mergeGroundedPlans(graph,[{window:{id:'chapter:1',index:1,text:SOURCE},plan:first},{window:{id:'chapter:2',index:2,text:SOURCE},plan:revisited}]);
 assert.deepEqual(merged.scenes.map(scene=>scene.id),['photosynthesis_plant','photosynthesis_plant_ch2']);
 assert.deepEqual([...new Set(merged.requiredClaims.map(claim=>claim.id))].sort(),['carbon_claim','carbon_claim_ch2','light_claim','light_claim_ch2','water_claim','water_claim_ch2'].sort());
 assert.equal(merged.scenes[1].beats.some(beat=>beat.requirementIds.includes('light_claim_ch2')),true);
 assert.deepEqual([...new Set(merged.evidenceRefs.map(item=>item.id))].length,merged.evidenceRefs.length);
 assert.equal(merged.scenes[1].continuity.keepFromPrevious[0],'plant');
});

const pad=(text,paragraphs=26)=>{const filler='photosynthesis biology '.repeat(26).slice(0,520).trim();return Array.from({length:paragraphs},()=>`${filler} ${text}`).join('\n\n');};

test('long grounded documents plan one global graph with bounded chapter windows',async()=>{
 const source=pad('Leaves capture sunlight. Roots absorb water. Leaves take in carbon dioxide. Inputs enable plant food production.');
 const model={calls:[],events:[],async generate(stage,_instructions,input,_schema,validate){
  this.calls.push({stage});
  if(stage==='knowledge')return validate(validKnowledge());
  if(stage==='teaching'){
   const callIndex=this.calls.filter(call=>call.stage==='teaching').length;
   const plan=fixturePlan();
   if(callIndex===2){plan.scenes[0].continuity.keepFromPrevious=['plant'];for(const scene of plan.scenes)for(const beat of scene.beats)beat.narrationDraft=`${beat.narrationDraft} Chapter two revisits these inputs from the soil and canopy perspective with fresh worked detail.`;}
   this._chapterPlan=plan;
   return validate(plan);
  }
  if(stage==='architect')return validate(architectPayload(input,this._chapterPlan));
  const s=sceneJson();s.id=input.semanticScene.id;
  input.semanticScene.beats.forEach((beat,index)=>{s.beats[index].narration=beat.narrationDraft;});
  if(input.semanticScene.continuity.keepFromPrevious.includes('plant'))for(const beat of s.beats)for(const action of beat.actions)if(action.type==='draw'&&action.objectIds.includes('plant')){action.type='highlight';action.id=`${action.id}_preserved`;}
  return validate({scene:s,decisions:{centralTeachingObject:'plant',firstFocus:'plant',illustratedConcepts:'plant and inputs',labelsOnly:'labels',movingRelations:'flows',persistentContext:'plant',stateChanges:'activation',omit:'decoration'}});
 }};
 const results=[];
 for await(const result of generateV2({prompt:'Teach the full report',sourceText:source,sourceId:'src_test',allowedArchetypes:['structural_diagram','convergence'],maxScenes:2},model))results.push(result);
 assert.equal(results.length,2);assert.ok(results.every(result=>result.manifest.status==='PASS'));
 const teachingCalls=model.calls.filter(call=>call.stage==='teaching');
 assert.equal(teachingCalls.length,2);
 const plan=results[0].plan;
 assert.equal(plan.scenes.length,2);
 assert.equal(new Set(plan.scenes.map(scene=>scene.id)).size,plan.scenes.length);
 assert.equal(new Set(plan.requiredClaims.map(claim=>claim.id)).size,plan.requiredClaims.length);
 assert.equal(plan.requiredClaims.length,3);
 assert.equal(plan.scenes[1].continuity.keepFromPrevious[0],'plant');
});

test('source-visual-grounding selects figures whose captions name required concepts',()=>{
  const graph={...conceptGraphFromPlan(fixturePlan()),sourceVisuals:[
  {id:'source-visual:1',sourceId:'src',caption:'A plant with visible leaves and roots',provenance:'source-image'},
  {id:'source-visual:2',sourceId:'src',caption:'A diagram of unrelated machinery',provenance:'source-image'},
  {id:'source-visual:3',sourceId:'src',caption:'',provenance:'source-table'}]};
 const semantic={id:'scene',requiredConceptIds:['plant','sunlight','water','carbon_dioxide']};
 const selection=selectSourceVisuals(semantic,graph);
 assert.deepEqual(selection.selected.map(entry=>entry.id),['source-visual:1']);
 assert.deepEqual(selection.rejected.map(entry=>entry.id),['source-visual:2','source-visual:3']);
 assert.match(selection.rejected[1].reason,/no caption/);
 const none=selectSourceVisuals(semantic,{...graph,sourceVisuals:[]});
 assert.deepEqual(none.selected,[]);assert.deepEqual(none.rejected,[]);
});

test('source capping stops at a paragraph or sentence boundary, never mid-sentence',async()=>{
 const {capAtBoundary}=await import('../dist/src/semantic/planning/knowledge-compiler.js');
 const text='First paragraph sentence. Still first paragraph.\n\nSecond paragraph sentence. Second continues here.\n\nThird paragraph.';
 const paragraph=capAtBoundary(text,60);
 assert.ok(paragraph.endsWith('Still first paragraph.'),paragraph);
 assert.ok(!paragraph.includes('Second paragraph'));
 const sentence=capAtBoundary('One sentence here. Another sentence that will be cut in the middle of words',40);
 assert.equal(sentence,'One sentence here.');
 const hard=capAtBoundary('a'.repeat(50),10);
 assert.equal(hard.length,10);
 assert.equal(capAtBoundary('short text',100),'short text');
});

test('route exhaustion surfaces the earlier validation error, not the later timeout',async()=>{
 const {createJsonModel}=await import('../dist/src/semantic/planning/model-adapter.js');
 const asked=[];
 const fetcher=async(url,init)=>{
  if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:['test/a','test/b','test/c'].map(id=>({id,pricing:{prompt:'0',completion:'0'}}))}));
  const model=JSON.parse(init.body).model;asked.push(model);
  if(model==='test/a')return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({bad:true})}}],usage:{prompt_tokens:10,completion_tokens:10,cost:.00001}}));
  throw new Error('The operation was aborted due to timeout');
 };
 const model=createJsonModel({env:{OPENROUTER_API_KEY:'test',OPENROUTER_MODEL:'test/a',OPENROUTER_MODEL_FALLBACKS:'test/b,test/c'},maxCostUsd:1,fetcher});
 const schema={type:'object',additionalProperties:false,required:['ok'],properties:{ok:{type:'boolean'}}};
 await assert.rejects(()=>model.generate('knowledge','x',{},schema,v=>v),/validation exhausted: .*additional property|validation exhausted:/);
 assert.deepEqual(asked,['test/a','test/b','test/c']);
});

test('evidence matching tolerates whitespace and unicode punctuation but not paraphrase',async()=>{
 const {evidenceSupported}=await import('../dist/src/semantic/planning/knowledge-compiler.js');
 const source='The plant captures sunlight. Roots absorb\nwater from the soil.';
 assert.equal(evidenceSupported(source,'Roots absorb  water from the soil.'),true);
 assert.equal(evidenceSupported(source,'Roots absorb water from the soil.'),true);
 assert.equal(evidenceSupported('He said \u201Chello\u201D today.','He said "hello" today.'),true);
 assert.equal(evidenceSupported('Water\u00A0flows up.','Water flows up.'),true);
 assert.equal(evidenceSupported('The plant uses light.','Plants convert light energy into sugar.'),false);
});

test('mergeConceptGraphs unions window graphs, renaming colliding evidence ids and deduping meaning',async()=>{
 const {mergeConceptGraphs}=await import('../dist/src/semantic/planning/knowledge-compiler.js');
 const base=validKnowledge();
 const first=validateKnowledge(base,SOURCE);
 const second=structuredClone(first);
 second.evidence=second.evidence.map(item=>({...item,quote:`${item.quote} Additionally, roots reach deeper.`}));
 second.concepts=second.concepts.map(concept=>({...concept,id:`${concept.id}_w2`,canonicalName:`${concept.canonicalName} Two`}));
 const merged=mergeConceptGraphs([first,second]);
 assert.ok(merged.concepts.length>first.concepts.length,'window concepts union');
 const evidenceIds=[...new Set(merged.evidence.map(item=>item.id))];
 assert.equal(evidenceIds.length,merged.evidence.length,'evidence ids stay unique across windows');
 assert.ok(merged.evidence.some(item=>item.id.endsWith('_w2')),'colliding evidence ids rename with the window suffix');
 assert.ok(merged.claims.length>=first.claims.length);
 assert.ok(merged.quantities.length>0);
});

test('compileKnowledge validates evidence against the full scope, not the prompt window',async()=>{
 const farQuote='A distant section states that CSA2 reuses global KV cache across layers.';
 const payload=structuredClone(validKnowledge());
 payload.evidence=[...payload.evidence,{id:'ev_far',sourceId:'src',quote:farQuote}];
 const model={generate:async(_task,_instructions,_options,_schema,validate)=>validate(structuredClone(payload))};
 const compiled=await compileKnowledge({prompt:'topic',sourceText:'Leaves capture sunlight.',evidenceScope:`${SOURCE}\n${farQuote}`,sourceId:'src'},model);
 assert.ok(compiled.evidence.some(item=>item.quote===farQuote),'quote from outside the prompt window still validates');
 await assert.rejects(()=>compileKnowledge({prompt:'topic',sourceText:'Leaves capture sunlight.',evidenceScope:'Leaves capture sunlight.',sourceId:'src'},model),/Fabricated evidence/);
});

test('snapQuoteToSource replaces a paraphrase with the exact source sentence and rejects unrelated text',async()=>{
 const {snapQuoteToSource}=await import('../dist/src/semantic/planning/knowledge-compiler.js');
 const source='Compressed Sparse Attention 2 (CSA2), which applies cross-layer reuse to global KV and Top-K indices to substantially reduce decoding cost. The benchmark uses FP4 KV caching.';
 const snapped=snapQuoteToSource(source,'CSA2 combines cross-layer KV cache reuse in Compressed Sparse Attention 2 (CSA2)');
 assert.ok(snapped&&source.includes(snapped),'snapped quote is copied verbatim from the source');
 assert.equal(snapQuoteToSource(source,'Bananas ripen faster in humid weather.'),null);
});

test('validateKnowledge snaps paraphrased evidence and keeps unrelated evidence failing',async()=>{
 const source='Plants make food using sunlight, water and carbon dioxide. Leaves capture sunlight for energy. Roots absorb water from the soil.';
 const payload=validKnowledge();
 payload.evidence=[{id:'ev_paraphrase',sourceId:'src',quote:'Plants make their food using water, sunlight and carbon dioxide.'}];
 payload.claims=payload.claims.map(claim=>({...claim,evidenceRefs:['ev_paraphrase']}));
 payload.concepts=payload.concepts.map(concept=>({...concept,evidenceRefs:['ev_paraphrase']}));
 payload.quantities=[];
 payload.mechanisms=payload.mechanisms.map(mechanism=>({...mechanism,evidenceRefs:['ev_paraphrase']}));
 const healed=validateKnowledge(structuredClone(payload),source);
 assert.ok(source.includes(healed.evidence[0].quote),'paraphrase replaced by a real source sentence');
 const broken=structuredClone(payload);broken.evidence=[{id:'ev_bad',sourceId:'src',quote:'Quantum tunnelling explains gravity.'}];
 broken.claims=broken.claims.map(claim=>({...claim,evidenceRefs:['ev_bad']}));
 broken.concepts=broken.concepts.map(concept=>({...concept,evidenceRefs:['ev_bad']}));
 broken.mechanisms=broken.mechanisms.map(mechanism=>({...mechanism,evidenceRefs:['ev_bad']}));
 assert.throws(()=>validateKnowledge(broken,source),/Fabricated evidence: ev_bad/);
});
