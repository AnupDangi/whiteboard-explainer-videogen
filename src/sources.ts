import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {load} from 'cheerio';
import ipaddr from 'ipaddr.js';
import type {SourceInput,SourceDocument} from './types.js';
const BINARY_LIMIT=50*1024*1024;
const TEXT_LIMIT=200000;
const PAGE_LIMIT=15;
export function publicAddress(address:string):boolean { try { const ip=ipaddr.process(address);return ip.range()==='unicast'; }catch{return false;} }
function arxivHtmlFallback(url:string):string|null {
  const match=url.match(/^https:\/\/arxiv\.org\/pdf\/([0-9.]+)(?:v\d+)?(?:\.pdf)?$/i);
  return match?`https://arxiv.org/html/${match[1]}`:null;
}
export async function fetchSource(url:string,signal?:AbortSignal,redirects=0):Promise<{bytes:Buffer;type:string}> {
  const target=new URL(url);
  if(target.protocol!=='https:'||target.username||target.password||(target.port&&target.port!=='443'))throw new Error('Use a public HTTPS URL without credentials or a custom port');
  const addresses=await lookup(target.hostname.replace(/^\[|\]$/g,''),{all:true});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('Private or reserved network addresses are not allowed');
  return new Promise((resolve,reject)=>{
    const req=request(target,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000),lookup:((_h:string,_o:{all?:boolean},cb:Function)=>_o.all?cb(null,[addresses[0]]):cb(null,addresses[0].address,addresses[0].family)) as any,headers:{'User-Agent':'ExplainCanvasLab/0.3','Accept':'text/html,text/plain,application/pdf'}},res=>{
      if([301,302,303,307,308].includes(res.statusCode!)){res.resume();if(redirects>=3||!res.headers.location)return reject(new Error('Too many source redirects'));return fetchSource(new URL(res.headers.location,target).href,signal,redirects+1).then(resolve,reject);}
      if(res.statusCode!==200){res.resume();return reject(new Error(`Source HTTP ${res.statusCode}`));}
      const chunks:Buffer[]=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>BINARY_LIMIT)req.destroy(new Error('Source exceeds 50 MB'));else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({bytes:Buffer.concat(chunks),type:String(res.headers['content-type']||'')}));
    });req.on('error',reject);req.end();
  });
}
export async function extractPdf(bytes:Buffer,signal?:AbortSignal):Promise<string>{
  if(bytes.length>BINARY_LIMIT||bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('Invalid PDF or file exceeds 50 MB');
  const dir=await mkdtemp(join(tmpdir(),'explain-pdf-'));
  try {const path=join(dir,'source.pdf');await writeFile(path,bytes);const {stdout}=await promisify(execFile)('pdftotext',['-layout','-f','1','-l',String(PAGE_LIMIT),path,'-'],{timeout:30000,maxBuffer:2*1024*1024,signal});return stdout;}finally{await rm(dir,{recursive:true,force:true});}
}
function clip(text:string):string {
  // Collapse horizontal whitespace and excess blank lines, but keep paragraph breaks (\n\n) —
  // the planner's per-chapter chunking splits on them, so flattening to one line would defeat it.
  const compact=text.replace(/[ \t]+/g,' ').replace(/[ \t]*\n[ \t]*/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if(compact.length<=TEXT_LIMIT)return compact;
  return compact.slice(0,TEXT_LIMIT-2).replace(/\s+\S*$/,'')+' …';
}
async function ingestUrl(url:string,signal?:AbortSignal):Promise<{text:string;label:string}>{
  try {
    const result=await fetchSource(url,signal);
    if(result.type.includes('pdf')||result.bytes.subarray(0,5).toString()==='%PDF-')return {text:await extractPdf(result.bytes,signal),label:url};
    if(result.type.includes('html')){const $=load(result.bytes.toString('utf8'));$('script,style,nav,footer,header,aside,noscript').remove();return {text:($('main').length?$('main'):$('article').length?$('article'):$('body')).text(),label:url};}
    if(result.type.startsWith('text/plain'))return {text:result.bytes.toString('utf8'),label:url};
    throw new Error('Link must return HTML, text or PDF');
  } catch(error) {
    const html=arxivHtmlFallback(url);
    if(!html)throw error;
    const fallback=await fetchSource(html,signal);
    const $=load(fallback.bytes.toString('utf8'));$('script,style,nav,footer,header,aside,noscript').remove();
    return {text:($('article').length?$('article'):$('main').length?$('main'):$('body')).text(),label:html};
  }
}
export async function ingestSource(input:SourceInput,signal?:AbortSignal):Promise<SourceDocument>{
  if(!input||!['prompt','text','url','pdf'].includes(input.kind))throw new Error('Choose prompt, text, URL or PDF');
  let text='',label=input.name||input.kind;
  if(input.kind==='url'){
    if(!input.url)throw new Error('A public HTTPS URL is required');
    const ingested=await ingestUrl(input.url,signal);text=ingested.text;label=ingested.label;
  }else if(input.kind==='pdf')text=await extractPdf(Buffer.from(input.base64||'','base64'),signal);
  else text=input.text||'';
  text=clip(text);
  if(text.length<20)throw new Error('Source needs at least 20 readable characters. Scanned PDFs need OCR; inaccessible pages need pasted text.');
  return {kind:input.kind,label,text,sha256:createHash('sha256').update(text).digest('hex')};
}
