import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {log} from './logger.js';
import type {SourceFigure} from './types.js';

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

const figureSchema={type:'object',additionalProperties:false,properties:{caption:{type:'string'},kind:{type:'string',enum:['figure','table']},dataHint:{type:'string'},keyNumbers:{type:'array',items:{type:'string'},maxItems:8}},required:['caption','kind','dataHint','keyNumbers']};

/** One bounded vision call per figure (≤4 per source). Failure keeps the figure
 *  undescribed rather than failing the job — extraction quality, never a blocker. */
export async function describeFigures(bytes:Buffer,candidates:FigureCandidate[],{env,fetcher=fetch,maxFigures=4,cropFn=cropFigure}: {env:NodeJS.ProcessEnv;fetcher?:typeof fetch;maxFigures?:number;cropFn?:(bytes:Buffer,c:FigureCandidate)=>Promise<Buffer|null>}):Promise<SourceFigure[]> {
  const described:SourceFigure[]=[];
  for(const c of candidates.slice(0,maxFigures)){
    const crop=await cropFn(bytes,c);
    if(!crop)continue;
    try {
      const response=await fetcher('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${env.OPENROUTER_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENROUTER_MODEL||'google/gemini-3.8-flash',temperature:0.2,max_tokens:600,response_format:{type:'json_schema',json_schema:{name:'figure',strict:true,schema:figureSchema}},messages:[{role:'system',content:'You describe one figure or table from a research paper so a whiteboard explainer can later redraw it. Return ONLY JSON {caption:string, kind:"figure"|"table", dataHint:string, keyNumbers:string[]}. caption: what it shows in one sentence. dataHint: the axes/rows/series structure a redraw would need. keyNumbers: values worth putting on a whiteboard.'},{role:'user',content:[{type:'text',text:'Describe this figure or table from the source document.'},{type:'image_url',image_url:{url:`data:image/png;base64,${crop.toString('base64')}`}}]}]})});
      if(!response.ok)throw new Error(`figure HTTP ${response.status}`);
      const data=await response.json();
      const parsed=JSON.parse(data.choices[0].message.content) as {caption:string;kind:'figure'|'table';dataHint:string;keyNumbers:string[]};
      described.push({page:c.page,...parsed});
      log('source.figure-described',{page:c.page,kind:parsed.kind,caption:parsed.caption.slice(0,60)});
    }catch(error){
      log('source.figure-describe-failed',{page:c.page,error:error instanceof Error?error.message:String(error)},'warn');
    }
  }
  return described;
}
