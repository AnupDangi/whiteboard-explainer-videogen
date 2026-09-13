/** P6 Level-C judge: score each bench case's rendered scenes on the harness §62 rubric
 *  (teaching clarity, visual representation, layout, continuity, motion semantics,
 *  readability, 1-5) with one vision call per case, reading the saved SVGs from
 *  output/evaluations/visual-bench. Live-only (needs OPENROUTER_API_KEY); results are
 *  logged to the ledger and merged into the bench report. */
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {log} from '../src/shared/logger.js';

const env=process.env;
if(!env.OPENROUTER_API_KEY)throw new Error('OPENROUTER_API_KEY required');
const base='output/evaluations/visual-bench';
const cases=(await readdir(base,{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>d.name);
const rubricSchema={type:'object',additionalProperties:false,properties:{teachingClarity:{type:'integer'},visualRepresentation:{type:'integer'},layout:{type:'integer'},continuity:{type:'integer'},motionSemantics:{type:'integer'},readability:{type:'integer'},notes:{type:'string'}},required:['teachingClarity','visualRepresentation','layout','continuity','motionSemantics','readability','notes']};
const scores:Record<string,unknown>={};
for(const id of cases){
  const dir=join(base,id);
  const svgs=(await readdir(dir)).filter(f=>f.endsWith('.svg'));
  if(!svgs.length)continue;
  const pngs=await Promise.all(svgs.slice(0,4).map(async f=>sharp(Buffer.from(await readFile(join(dir,f)))).resize(320,180).png().toBuffer()));
  const strip=await sharp({create:{width:320*pngs.length,height:180,channels:3,background:'#fffef9'}}).composite(pngs.map((input,i)=>({input,left:i*320,top:0}))).png().toBuffer();
  try{
    const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(90000),headers:{Authorization:`Bearer ${env.OPENROUTER_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENROUTER_VISION_MODEL||env.OPENROUTER_MODEL||'google/gemini-3.8-flash',temperature:0.2,max_tokens:500,response_format:{type:'json_schema',json_schema:{name:'rubric',strict:true,schema:rubricSchema}},messages:[{role:'system',content:'You judge whiteboard explainer scenes for teaching quality. Scores are 1-5 (5 best). Left-to-right strip shows how the drawing builds. Be strict: pretty-but-empty frames, box-only diagrams, or unlabeled arrows must score low.'},{role:'user',content:[{type:'text',text:`Case "${id}" scene frames (final states):`},{type:'image_url',image_url:{url:`data:image/png;base64,${strip.toString('base64')}`}}]}]})});
    if(!response.ok)throw new Error(`judge HTTP ${response.status}`);
    const data=await response.json();
    const rubric=JSON.parse(data.choices[0].message.content) as Record<string,unknown>;
    scores[id]=rubric;
    log('eval.judged',{case:id,...rubric});
  }catch(error){log('eval.judge-failed',{case:id,error:error instanceof Error?error.message:String(error)},'warn');}
}
const reportPath=join(base,'judge.json');
await writeFile(reportPath,JSON.stringify({judgedAt:new Date().toISOString(),scores},null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,judged:Object.keys(scores).length}));
