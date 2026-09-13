import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createJsonModel} from '../src/semantic/planning/model-adapter.js';
import {generateV2} from '../src/semantic/planning/generate.js';
import {renderSVG} from '../src/semantic/renderer/render-svg.js';
import {evaluatePlant} from '../src/semantic/evaluation.js';
import {staticIntervals} from '../src/semantic/compiler/timeline.js';
import {createVoiceEngineSpeech} from '../src/semantic/speech.js';
const out=process.argv[2]??'output/semantic-automatic-plant';await mkdir(out); // Never overwrite model evidence.
const narrate=process.argv.includes('--narration')||process.env.V2_NARRATION==='1';
const model=createJsonModel({maxCostUsd:.15,onOutput:async(stage,attempt,value)=>{await writeFile(join(out,`${stage}-attempt-${attempt}.json`),JSON.stringify(value,null,2));}}),start=performance.now();let ready=0;
try{
 for await(const result of generateV2({prompt:'Explain how plants make food to a middle-school student. For this first scene, teach the three inputs: sunlight arriving at leaves, water arriving at roots, and carbon dioxide entering leaves. Establish a plant as the central system, introduce each input, and restate how they enable food production. Keep the scope to these inputs; detailed chemistry and products belong in later scenes.',maxScenes:1,allowedArchetypes:['structural_diagram','convergence']},model,{...(narrate?{speech:createVoiceEngineSpeech()}: {})})){
  const scene=result.compiled;if(result.speech)await writeFile(join(out,`${scene.scene.id}.wav`),result.speech.audio);await writeFile(join(out,`${scene.scene.id}.json`),JSON.stringify({...result,speech:undefined},null,2));
  const sharp=(await import('sharp')).default,tiles=[];
  const times=[0,...scene.scene.beats.map(b=>Math.max(...scene.actions.filter(a=>a.beatId===b.id).map(a=>a.startMs+a.durationMs))),scene.durationMs];
  for(const [i,time] of times.entries()){const svg=renderSVG(scene,time,{cursor:true});await writeFile(join(out,`frame-${i}.svg`),svg);tiles.push({input:await sharp(Buffer.from(svg)).resize(640,360).png().toBuffer(),left:i%2*640,top:Math.floor(i/2)*360});}
  await sharp({create:{width:1280,height:Math.ceil(times.length/2)*360,channels:4,background:'#faf9f3'}}).composite(tiles).png().toFile(join(out,'contact-sheet.png'));
  await sharp(Buffer.from(renderSVG(scene,scene.durationMs))).png().toFile(join(out,'final.png'));
  const evaluation=evaluatePlant(scene);await writeFile(join(out,'semantic-evaluation.json'),JSON.stringify(evaluation,null,2));if(!evaluation.pass)throw new Error('Automatic plant semantic benchmark failed');
  const gaps=staticIntervals(scene.scene,scene.timing,scene.actions);ready++;
  await writeFile(join(out,'report.json'),JSON.stringify({mode:'live automatic planner; estimated silent timing, no TTS',status:'complete',metrics:result.metrics,firstPlayableMs:performance.now()-start,calls:model.calls,costUsd:model.calls.reduce((s,c)=>s+c.costUsd,0),longestStaticMs:Math.max(0,...gaps.map(g=>g.endMs-g.startMs)),diagnostics:scene.diagnostics,archetype:scene.scene.archetype,objects:scene.objects.map(o=>({id:o.id,conceptId:o.conceptId,asset:o.assetRef})),relations:scene.relations.map(r=>({from:r.from,to:r.to})),humanReview:'pending'},null,2));
 }
 console.log(JSON.stringify({out,ready,costUsd:model.calls.reduce((s,c)=>s+c.costUsd,0)}));
}catch(e){const error=e instanceof Error?e.message:String(e);await writeFile(join(out,'failure.json'),JSON.stringify({status:'failed',error,calls:model.calls,ready,elapsedMs:performance.now()-start},null,2));throw e;}
