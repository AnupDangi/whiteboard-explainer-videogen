/** Live calibration for the V2 visual critic: known corruptions, both orderings, metered calls. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {compileScene} from '../src/v2/compiler/compile-scene.js';
import {renderSVG} from '../src/v2/renderer/render-svg.js';
import {runCriticCalibration} from '../src/v2/calibration.js';
import {createVisionJudge} from '../src/v2/vision-judge.js';
const out=process.argv[2]??'output/v2-critic-calibration';await mkdir(out,{recursive:true});
const scene=compileScene(JSON.parse(await readFile('examples/v2/photosynthesis-plant.scene.json','utf8')));
const sharp=(await import('sharp')).default;
async function sheet(value:typeof scene,label:string){
 const times=[0,...value.scene.beats.map(b=>Math.max(...value.actions.filter(a=>a.beatId===b.id).map(a=>a.startMs+a.durationMs))),value.durationMs],cols=2,tiles=[];
 for(const [i,time] of times.entries()){const stamp=Buffer.from(`<svg width="640" height="360"><rect x="0" y="332" width="150" height="28" fill="#233832" opacity="0.78"/><text x="8" y="352" font-family="Arial, sans-serif" font-size="17" fill="#ffffff">t=${(time/1000).toFixed(1)}s</text></svg>`);const png=await sharp(Buffer.from(renderSVG(value,time,{cursor:true}))).resize(640,360).composite([{input:stamp,top:0,left:0}]).png().toBuffer();await writeFile(join(out,`${label.replace(/[^a-z0-9]+/gi,'-')}-${i}.png`),png);tiles.push({input:png,left:i%cols*640,top:Math.floor(i/cols)*360});}
 const buffer=await sharp({create:{width:cols*640,height:Math.ceil(times.length/cols)*360,channels:4,background:'#faf9f3'}}).composite(tiles).png().toBuffer();
 return {label,pngBase64:buffer.toString('base64')};
}
const judge=createVisionJudge({env:process.env,maxCostUsd:Number(process.env.V2_CRITIC_BUDGET_USD??.25)});
const context={goal:scene.scene.teachingGoal,requirements:['plant hero','sunlight to leaf','water to roots','carbon dioxide to leaf','no generic boxes','structural model'],narration:scene.scene.beats.map(b=>b.narration).join(' ')};
const result=await runCriticCalibration({baseline:scene,judge,context,render:sheet});
await writeFile(join(out,'report.json'),JSON.stringify({mode:'live VLM critic calibration; both orders',model:process.env.OPENROUTER_VISION_MODEL??'google/gemini-3.8-flash',report:result.report,calls:judge.calls,pairs:result.pairs.map(p=>({corruption:p.corruption,forward:p.forward.preferred,reverse:p.reverse.preferred}))},null,2));
console.log(JSON.stringify({out,costUsd:judge.calls.reduce((s,c)=>s+c.costUsd,0),report:result.report},null,2));
if(!result.report.reliable)process.exitCode=1;
