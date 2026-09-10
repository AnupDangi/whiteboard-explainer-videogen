import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {log} from './logger.js';
import type {SourceFigure} from './types.js';
import {getOutputBudget,getLatencyBudget} from './budgets.js';

/** P2 figures/tables pipeline. Detection is deterministic (poppler XML reports every
 *  embedded image with its page + rect). Description is ONE bounded vision-model pass
 *  per figure (harness §9: visual models for planning input, never pixels) with a
 *  strict schema — the renderer never sees anything but validated data. */

export interface FigureCandidate { page:number;left:number;top:number;width:number;height:number }

const run=promisify(execFile);

/** Deterministic candidate detection from pdftohtml -xml's <image> tags. */
export async function detectFigures(bytes:Buffer):Promise<FigureCandidate[]> {
  if(bytes.subarray(0,5).toString()!=='%PDF-')return [];
  const dir=await mkdtemp(join(tmpdir(),'explain-fig-'));
  try {
    const path=join(dir,'source.pdf');await writeFile(path,bytes);
    const {stdout}=await run('pdftohtml',['-xml','-stdout','-q',path],{timeout:30000,maxBuffer:16*1024*1024});
    const candidates:FigureCandidate[]=[];
    // stdout = [head]<page number="1">p1 … — split section i (0-based after head) is page i.
    const sections=stdout.split(/<page number="\d+"[^>]*>/);
    for(let i=1;i<sections.length;i++){
      for(const m of sections[i].matchAll(/<image top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)"[^>]*src="[^"]*"[^>]*\/?>/g)){
        const width=Number(m[3]),height=Number(m[4]);
        // Decorative logos/rules are tiny; keep substantial graphics only.
        if(width>=80&&height>=60)candidates.push({page:i,left:Number(m[2]),top:Number(m[1]),width,height});
      }
    }
    // Area sort: real figures/tables are the big rectangles; page decorations and logos
    // are small. Whole-document scan (figures often live past the text PAGE_LIMIT).
    return candidates.sort((a,b)=>(b.width*b.height)-(a.width*a.height)).slice(0,4);
  }catch{return [];}
  finally{await rm(dir,{recursive:true,force:true});}
}
/** Renders one page crop (pdftohtml XML coords are 150dpi pixels; render the page at
 *  the same 150dpi so coordinates transfer 1:1). */
export async function cropFigure(bytes:Buffer,c:FigureCandidate):Promise<Buffer|null> {
  const dir=await mkdtemp(join(tmpdir(),'explain-crop-'));
  try {
    const path=join(dir,'source.pdf');await writeFile(path,bytes);
    await run('pdftoppm',['-png','-r','150','-f',String(c.page),'-l',String(c.page),path,join(dir,'page')],{timeout:30000,maxBuffer:16*1024*1024});
    const {readdir}=await import('node:fs/promises');
    const files=(await readdir(dir)).filter(f=>f.startsWith('page-')&&f.endsWith('.png'));
    const png=await readFile(join(dir,files[0]));
    const sharp=(await import('sharp')).default;
    const meta=await sharp(png).metadata();
    const safe=(v:number,max:number)=>Math.max(0,Math.min(max,Math.round(v)));
    return await sharp(png).extract({
      left:safe(c.left,meta.width||c.width),
      top:safe(c.top,meta.height||c.height),
      width:Math.max(8,safe(c.width,meta.width||c.width)),
      height:Math.max(8,safe(c.height,meta.height||c.height)),
    }).png().toBuffer();
  }catch{return null;}
  finally{await rm(dir,{recursive:true,force:true});}
}

const figureSchema={type:'object',additionalProperties:false,properties:{caption:{type:'string',maxLength:280},kind:{type:'string',enum:['figure','table']},dataHint:{type:'string',maxLength:280},keyNumbers:{type:'array',items:{type:'string',maxLength:24},maxItems:4}},required:['caption','kind','dataHint','keyNumbers']};

/** O3: truncated model JSON (e.g. cut off mid-string by the token budget) fails
 *  plain JSON.parse. Conservative repair: close the unterminated string, drop any
 *  trailing partial key/value fragments, then close arrays/objects in stack order.
 *  Accept only if the repaired payload then parses cleanly. */
export function repairFigureJson(raw:string):Record<string,unknown>|null {
  const start=raw.search(/\{/);
  if(start<0)return null;
  let body=raw.slice(start);
  // walk the string tracking string state + stack of open arrays/objects
  const stack:string[]=[];
  let inString=false,escaped=false;
  let lastSafe=0; // last index where we were outside a string at a "safe" boundary
  for(let i=0;i<body.length;i++){
    const ch=body[i];
    if(inString){
      if(escaped)escaped=false;
      else if(ch==='\\')escaped=true;
      else if(ch==='"'){inString=false;lastSafe=i+1;}
      continue;
    }
    if(ch==='"'){inString=true;continue;}
    if(ch==='{'||ch==='[')stack.push(ch);
    else if(ch==='}'||ch===']'){stack.pop();lastSafe=i+1;}
    else if(ch===',')lastSafe=i+1;
  }
  // cut at the last safe boundary so we never keep a partial key/value fragment
  if(lastSafe===0)return null;
  let repaired=body.slice(0,lastSafe).replace(/[,\s]+$/,'');
  // re-walk to see what remains open, then close it
  const open:string[]=[];inString=false;escaped=false;
  for(const ch of repaired){
    if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue;}
    if(ch==='"'){inString=true;continue;}
    if(ch==='{')open.push('{');
    else if(ch==='[')open.push('[');
    else if(ch==='}'||ch===']')open.pop();
  }
  if(inString)repaired+='"';
  while(open.length)repaired+=open.pop()==='['?']':'}';
  const direct=safeParse(repaired);
  if(direct)return direct;
  // still unparseable (e.g. a dangling `"key"` with no value): progressively strip
  // trailing members at a comma boundary and re-close, until something parses.
  for(let cut=repaired.lastIndexOf(',');cut>0;cut=repaired.lastIndexOf(',',cut-1)){
    const attempt=closeUpTo(repaired.slice(0,cut));
    const parsed=attempt?safeParse(attempt):null;
    if(parsed)return parsed;
  }
  return null;
}
/** Close whatever strings/arrays/objects remain open at the cut point. */
function closeUpTo(prefix:string):string {
  let out=prefix,inString=false,escaped=false;
  const open:string[]=[];
  for(const ch of out){
    if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue;}
    if(ch==='"'){inString=true;continue;}
    if(ch==='{')open.push('{');
    else if(ch==='[')open.push('[');
    else if(ch==='}'||ch===']')open.pop();
  }
  if(inString)out+='"';
  out=out.replace(/[,\s]+$/,'');
  const open2:string[]=[];inString=false;escaped=false;
  for(const ch of out){
    if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue;}
    if(ch==='"'){inString=true;continue;}
    if(ch==='{')open2.push('{');
    else if(ch==='[')open2.push('[');
    else if(ch==='}'||ch===']')open2.pop();
  }
  if(inString)out+='"';
  while(open2.length)out+=open2.pop()==='['?']':'}';
  return out;
}
function safeParse(s:string):Record<string,unknown>|null {
  try{const v=JSON.parse(s);return v&&typeof v==='object'&&!Array.isArray(v)?v:null;}catch{return null;}
}

import {semaphore} from './concurrency.js';

/** One bounded vision call per figure (≤4 per source). Failure keeps the figure
 *  undescribed rather than failing the job — extraction quality, never a blocker.
 *  Figures are independent and fail-soft: bounded concurrency 3, order restored. */
export async function describeFigures(bytes:Buffer,candidates:FigureCandidate[],{env,fetcher=fetch,maxFigures=4,cropFn=cropFigure}: {env:NodeJS.ProcessEnv;fetcher?:typeof fetch;maxFigures?:number;cropFn?:(bytes:Buffer,c:FigureCandidate)=>Promise<Buffer|null>}):Promise<SourceFigure[]> {
  const sem=semaphore(3);
  const tasks=candidates.slice(0,maxFigures).map(c=>sem.acquire().then(async()=>{
    try{
      const crop=await cropFn(bytes,c);
      if(!crop)return null;
      let describedFigure:SourceFigure|null=null;
      // O3: one parse retry — truncation is often a one-off token-budget miss, and the
      // repaired payload covers most of the rest. Two attempts total, still bounded.
      for(let attempt=0;attempt<2&&!describedFigure;attempt++){
        try {
          const response=await fetcher('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(getLatencyBudget('figure')),headers:{Authorization:`Bearer ${env.OPENROUTER_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENROUTER_VISION_MODEL||env.OPENROUTER_MODEL||'google/gemini-3.8-flash',temperature:0.2,max_tokens:getOutputBudget('figure'),response_format:{type:'json_schema',json_schema:{name:'figure',strict:true,schema:figureSchema}},messages:[{role:'system',content:'You describe one figure or table from a research paper so a whiteboard explainer can later redraw it. Return ONLY JSON {caption:string, kind:"figure"|"table", dataHint:string, keyNumbers:string[]}. caption: what it shows in one sentence. dataHint: the axes/rows/series structure a redraw would need. keyNumbers: values worth putting on a whiteboard (at most 4).'+(attempt?' Your previous reply was cut off mid-JSON — be strictly concise, one short sentence per field.':'')},{role:'user',content:[{type:'text',text:'Describe this figure or table from the source document.'},{type:'image_url',image_url:{url:`data:image/png;base64,${crop.toString('base64')}`}}]}]})});
          if(!response.ok)throw new Error(`figure HTTP ${response.status}`);
          const data=await response.json();
          const raw=data.choices[0].message.content as string;
          const repaired=repairFigureJson(raw);
          let parsed:null|{caption:string;kind:'figure'|'table';dataHint:string;keyNumbers:string[]}=null;
          try{parsed=JSON.parse(raw);}catch{/* truncated — try repair */}
          if(!parsed)parsed=repaired as null|{caption:string;kind:'figure'|'table';dataHint:string;keyNumbers:string[]};
          if(!parsed||typeof parsed.caption!=='string'||!parsed.caption.trim())throw new Error('figure missing caption');
          describedFigure={page:c.page,caption:parsed.caption.slice(0,280),kind:parsed.kind==='table'?'table':'figure',dataHint:typeof parsed.dataHint==='string'?parsed.dataHint.slice(0,280):'',keyNumbers:Array.isArray(parsed.keyNumbers)?parsed.keyNumbers.filter(k=>typeof k==='string').slice(0,4):[]};
          log('source.figure-described',{page:c.page,kind:describedFigure.kind,repair:parsed===repaired&&repaired!==null?'repaired':'clean',caption:describedFigure.caption.slice(0,60)});
        }catch(error){
          log(attempt===0?'source.figure-describe-retry':'source.figure-describe-failed',{page:c.page,attempt,error:error instanceof Error?error.message:String(error)},'warn');
        }
      }
      return describedFigure;
    }finally{sem.release();}
  }).catch(()=>null));
  const settled=await Promise.allSettled(tasks);
  return settled.flatMap(s=>s.status==='fulfilled'&&s.value?[s.value]:[]);
}
