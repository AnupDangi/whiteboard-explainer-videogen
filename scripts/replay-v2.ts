/** Revalidates unedited saved live model outputs after a deterministic implementation fix. */
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {generateV2} from '../src/v2/planning/generate.js';
import {writeV2Artifacts} from '../src/v2/artifacts.js';
import {evaluatePlant} from '../src/v2/evaluation.js';
import type {JsonModel} from '../src/v2/planning/model-adapter.js';
const source=process.argv[2],out=process.argv[3];if(!source||!out)throw new Error('Usage: replay-v2.js <saved-live-run> <new-output-directory>');
const files=await readdir(source),raw:Record<string,string>={};for(const stage of ['teaching','director']){const file=files.filter(f=>f.startsWith(stage+'-attempt-')&&f.endsWith('.json')).sort().at(-1);if(!file)throw new Error(`No saved ${stage} output`);raw[stage]=await readFile(join(source,file),'utf8');}
const model:JsonModel={calls:[],async generate(stage,_instructions,_input,_schema,validate){return validate(JSON.parse(raw[stage]));}};await mkdir(out);
for await(const r of generateV2({prompt:'Replay the recorded automatic plant input lesson',maxScenes:1,allowedArchetypes:['structural_diagram','convergence']},model)){
 const evaluation=evaluatePlant(r.compiled),manifest=await writeV2Artifacts(r.compiled,join(out,r.compiled.scene.id),{video:true});const report={mode:'recorded live-output replay; no new provider calls; estimated silent timing',source,sourceHashes:Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,createHash('sha256').update(v).digest('hex')])),providerCalls:0,newCostUsd:0,firstPlayableMs:null,evaluation,manifest};await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));if(!evaluation.pass)throw new Error('Replay failed automatic plant semantic checks');console.log(JSON.stringify({out,pass:evaluation.pass}));
}
