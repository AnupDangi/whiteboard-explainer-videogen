import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {log} from '../../core/logger.js';

/** Local Docling sidecar bridge (parse-engine/). Node owns no Python; the engine is a
 *  separate process, exactly like voice-engine. Every failure is fail-soft: callers get
 *  `null` and the legacy `sources.ts` extractor continues, so a missing/broken engine
 *  can never break ingestion. Raw parsed output is data only — nothing is executed. */

const root=fileURLToPath(new URL('../../../',import.meta.url)); // dist/src/parse/ -> repo root

interface ParsedBBox {page?:number|null;l:number;t:number;r:number;b:number;coord?:string}
export interface ParsedItem {
  type:string;
  page?:number|null;
  bbox?:ParsedBBox|null;
  selfRef?:string|null;
  text?:string;
  latex?:string;
  captions?:string[];
  columns?:string[];
  rows?:string[][];
}
export interface ParsedCrop {
  kind:'picture'|'table';
  file?:string;
  sha256?:string;
  page?:number|null;
  selfRef?:string|null;
  bbox?:ParsedBBox|null;
  width?:number;
  height?:number;
  error?:string;
  /** Content-addressed copy written under assetsDir (I2). */
  assetPath?:string;
  assetRef?:string;
}
export interface ParsedDocument {
  dir:string;
  items:ParsedItem[];
  crops:ParsedCrop[];
  pages:number;
  tables:number;
  pictures:number;
  formulas:number;
  device:string;
  warnings:string[];
}

function pythonBin():string{return process.env.DOCLING_PYTHON||join(root,'parse-engine','.venv','bin','python');}
function convertScript():string{return join(root,'parse-engine','convert.py');}

/** True when the sidecar can run. `INGESTION_ENGINE=legacy` forces the old path. */
export function parseEngineEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
  if((env.INGESTION_ENGINE||'').toLowerCase()==='legacy')return false;
  return existsSync(pythonBin())&&existsSync(convertScript());
}

interface ParseEngineOptions {bytes:Buffer;name?:string;signal?:AbortSignal;timeoutMs?:number;assetsDir?:string}

/** Default content-addressed crop store. Overridable with INGESTION_ASSETS_DIR. */
function defaultAssetsDir(env:NodeJS.ProcessEnv=process.env):string{
  return env.INGESTION_ASSETS_DIR||join(root,'.data','assets');
}

/** Run Docling over one document. Returns null (logged) on any failure. */
export async function parseWithEngine(options:ParseEngineOptions):Promise<ParsedDocument|null>{
  const {bytes,name='source.pdf',signal}=options;
  if(!parseEngineEnabled())return null;
  // Docling is an optional accelerator, never a reason for a lesson to hang.
  // Legacy extraction takes over after this bounded deadline.
  const timeoutMs=options.timeoutMs??Number(process.env.DOCLING_TIMEOUT_MS||90000);
  const ext=(name.match(/\.(pdf|docx|pptx|png|jpg|jpeg|tiff)$/i)?.[1]||'pdf').toLowerCase();
  const dir=await mkdtemp(join(tmpdir(),'explain-parse-'));
  try{
    const input=join(dir,`source.${ext}`);
    const out=join(dir,'out');
    await writeFile(input,bytes);
    const args=[convertScript(),'--input',input,'--out',out];
    if(process.env.DOCLING_DEVICE)args.push('--device',process.env.DOCLING_DEVICE);
    if(process.env.DOCLING_OCR)args.push('--ocr',process.env.DOCLING_OCR);
    if(process.env.DOCLING_FORMULAS)args.push('--formulas',process.env.DOCLING_FORMULAS);
    if(process.env.DOCLING_MAX_PAGES)args.push('--max-pages',process.env.DOCLING_MAX_PAGES);
    const result=await run(pythonBin(),args,timeoutMs,signal);
    const parsed=JSON.parse(result.stdout.trim().split('\n').at(-1)||'{}') as {ok?:boolean;error?:string;meta?:string};
    if(!parsed.ok){
      log('parse.engine-failed',{error:parsed.error,bytes:bytes.length},'warn');
      return null;
    }
    const metaPath=parsed.meta||join(out,'meta.json');
    const meta=JSON.parse(await readFile(metaPath,'utf8')) as {
      items?:ParsedItem[];cropsIndex?:ParsedCrop[];pages?:number;tables?:number;pictures?:number;formulas?:number;device?:string;warnings?:string[];
    };
    // Persist crops content-addressed BEFORE the temp dir is removed, so figure blocks
    // reference a stable asset instead of a vanished temp path.
    const assetsDir=options.assetsDir??defaultAssetsDir();
    const crops: ParsedCrop[]=[];
    for(const crop of meta.cropsIndex||[]){
      if(!crop.file){crops.push(crop);continue;}
      try{
        const bytes=await readFile(join(out,crop.file));
        const sha=crop.sha256||createHash('sha256').update(bytes).digest('hex');
        const ext=extname(crop.file)||'.png';
        await mkdir(assetsDir,{recursive:true});
        const assetPath=join(assetsDir,`${sha}${ext}`);
        if(!existsSync(assetPath))await writeFile(assetPath,bytes);
        crops.push({...crop,sha256:sha,assetPath,assetRef:`assets/${sha}${ext}`});
      }catch(error){
        crops.push({...crop,error:`persist failed: ${error instanceof Error?error.message:String(error)}`});
      }
    }
    return {
      dir:out,
      items:meta.items||[],
      crops,
      pages:meta.pages||0,
      tables:meta.tables||0,
      pictures:meta.pictures||0,
      formulas:meta.formulas||0,
      device:meta.device||'cpu',
      warnings:meta.warnings||[],
    };
  }catch(error){
    log('parse.engine-error',{error:error instanceof Error?error.message:String(error),bytes:bytes.length},'warn');
    return null;
  }finally{
    await rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}

function run(bin:string,args:string[],timeoutMs:number,signal?:AbortSignal):Promise<{stdout:string;stderr:string}>{
  return new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(`parse-engine timed out after ${timeoutMs}ms`));},timeoutMs);
    const onAbort=()=>{child.kill('SIGKILL');reject(new Error('parse-engine aborted'));};
    signal?.addEventListener('abort',onAbort,{once:true});
    child.stdout.on('data',chunk=>{stdout+=String(chunk);});
    child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    child.on('error',error=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);reject(error);});
    child.on('close',code=>{
      clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
      if(code===0)resolve({stdout,stderr});
      else reject(new Error(`parse-engine exited ${code}: ${stderr.trim().slice(-300)}`));
    });
  });
}
