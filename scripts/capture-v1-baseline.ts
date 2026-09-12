/** Immutable offline renderer baseline. No provider performance is inferred. */
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fixtures} from '../src/fixtures.js';
import {compileScene,validatePlan} from '../src/engine.js';
import {progressionFrames,staticIntervalMs,connectorThroughNode} from '../src/progression.js';
import type {Plan} from '../src/types.js';
const out=process.argv[2]??'output/v4-baseline';
await mkdir(out); // Deliberately refuse to overwrite an existing capture.
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const versions:Record<string,string>={};
for(const dir of ['src','skills'])for(const file of (await readdir(dir)).sort()){
  if(!/\.(ts|md)$/.test(file))continue;
  versions[join(dir,file)]=hash(await readFile(join(dir,file)));
}
const make=(id:string,title:string,narration:string,labels:string[]):Plan=>({version:1,title,scenes:[{id,title,narration,layout:'flow',nodes:labels.map((label,i)=>({id:`n${i}`,label,wordIndex:i*7})),edges:labels.slice(1).map((_,i)=>({from:`n${i}`,to:`n${i+1}`}))}]});
const plans:Record<string,Plan>={
  photosynthesis:fixtures.photosynthesis,
  attention:fixtures.attention,
  'dna-replication':{version:1,title:'DNA replication',scenes:fixtures.templates.scenes.filter(s=>s.id==='fork')},
  'plate-tectonics':{version:1,title:'Plate tectonics',scenes:fixtures.templates.scenes.filter(s=>s.id==='plates')},
  'deepseek-mla':make('compression','MLA compression','Standard attention stores large key and value representations. Multi head latent attention compresses these into a smaller latent vector. The latent representation can reconstruct the key and value information needed for attention.',['Large key/value cache','Compressed latent','Reconstructed keys/values']),
  'http-lifecycle':make('request','HTTP request lifecycle','A client sends an HTTP request to a server. The server parses the method and path and dispatches a handler. The handler reads application data and returns an HTTP response with a status and body.',['Client request','Server handler','HTTP response']),
};
const sharp=(await import('sharp')).default;
const results=[];
for(const [id,raw] of Object.entries(plans)){
  const dir=join(out,id);await mkdir(dir);
  const plan=validatePlan(raw),start=performance.now();const scenes=plan.scenes.map(s=>compileScene(s));const compileMs=performance.now()-start;
  await writeFile(join(dir,'scene.json'),JSON.stringify(plan,null,2));
  await writeFile(join(dir,'compiled.json'),JSON.stringify(scenes,null,2));
  const tiles=[];
  for(const [i,scene] of scenes.entries())for(const [j,frame] of progressionFrames(scene).entries()){
    const svg=`scene-${i}-frame-${j}.svg`;await writeFile(join(dir,svg),frame.svg);
    tiles.push({input:await sharp(Buffer.from(frame.svg)).resize(320,180).png().toBuffer(),left:j*320,top:i*180});
  }
  await sharp({create:{width:1600,height:180*scenes.length,channels:4,background:'#ffffff'}}).composite(tiles).png().toFile(join(dir,'contact-sheet.png'));
  const exportResult=JSON.parse(execFileSync(process.execPath,['dist/scripts/export.js','--input',join(dir,'scene.json'),'--out',join(dir,'baseline.mp4'),'--fps','4','--width','640'],{encoding:'utf8'}));
  const row={id,provenance:['deepseek-mla','http-lifecycle'].includes(id)?'manually-authored-baseline':'existing-fixture',timingKind:'estimated',providerCalls:0,costUsd:0,firstPlayableMs:null,compileMs,export:exportResult,scenes:scenes.map(s=>({id:s.id,durationMs:s.durationMs,staticIntervalMs:staticIntervalMs(s),connectorHits:connectorThroughNode(s),timing:s.timing}))};
  await writeFile(join(dir,'timing-manifest.json'),JSON.stringify(row,null,2));results.push(row);
}
const manifest={version:1,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),mode:'offline renderer baseline; silent estimated timing; no LLM/TTS measurements',modelConfig:{used:false,routerSourceHash:versions['src/model-router.ts']},schemaVersion:1,sourceHashes:versions,results};
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({out,cases:results.length,sceneCount:results.reduce((n,r)=>n+r.scenes.length,0),staticViolations:results.flatMap(r=>r.scenes).filter(s=>s.staticIntervalMs>3500).length}));
