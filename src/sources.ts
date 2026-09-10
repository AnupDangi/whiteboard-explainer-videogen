import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {load} from 'cheerio';
import ipaddr from 'ipaddr.js';
import type {SourceInput,SourceDocument} from './types.js';
const BINARY_LIMIT=50*1024*1024;
// LD1: book-scale text cap (~5M chars ≈ 1000 pages). The old 200k flat clip silently
// dropped everything past ~page 50 of a large document before the planner ever saw it.
const TEXT_LIMIT=5_000_000;
// LD1: tail-stripping (References/Appendix cut) is a PAPER heuristic. Gate it to short
// docs so a book's appendices and endnotes survive; a mid-book "Appendix" chapter must
// never amputate half the document.
const PAPER_TAIL_MAX_CHARS=150000;
// LD1: full-document extraction needs far more stdout headroom than the 15-page 2MB cap.
const PDF_MAX_BUFFER=16*1024*1024;
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
  try {
    const path=join(dir,'source.pdf');await writeFile(path,bytes);
    // P1: raw mode (no -layout) preserves the paper's reading order across columns —
    // -layout keeps the two-column x-positions and interleaves unrelated lines with
    // runs of spaces. Whitespace repair below re-flows the paragraphs.
    // LD1: NO page limit — the whole document is extracted; pdftotext separates pages
    // with form feeds (\f), which buildPageText turns into page offsets.
    const {stdout}=await promisify(execFile)('pdftotext',['-raw',path,'-'],{timeout:60000,maxBuffer:PDF_MAX_BUFFER,signal});
    return stdout;
  }finally{await rm(dir,{recursive:true,force:true});}
}
/** P1: cut the paper's tail that teaches nothing — References/Appendix/footnote blocks
 *  dominate prompt tokens otherwise (the DeepSeek-V4 run burned ~54k prompt tokens,
 *  largely extraction debris). Cut on the first marker heading; deterministic.
 *  LD1: applied ONLY to paper-like docs (short, marker in the back 40%) by the caller —
 *  a book's References/Appendix headings are legitimate structure, not debris. */
function stripAcademicTail(text:string):string {
  const markers=/\n(?:\d+\.?\s+)?(References|Bibliography|REFERENCES|Acknowledg|Appendix|APPENDIX)\b/;
  const match=text.match(markers);
  return match&&match.index&&text.length<=PAPER_TAIL_MAX_CHARS&&match.index>text.length*0.6?text.slice(0,match.index):text;
}
/** LD1: page-aware text assembly. pdftotext separates pages with form feeds (\f) and
 *  emits one AFTER the final page too. Pages are compacted individually (same whitespace
 *  rules as clip), then joined with blank lines. pages[i] carries the 1-based PDF page
 *  number and the char offset in the returned text where that page's text begins;
 *  blank pages are skipped (they have no text and no meaningful offset). tailCut caps
 *  total length and silently drops any page that would start past it. Pure, deterministic. */
export function buildPageText(raw:string,tailCut=TEXT_LIMIT):{text:string;pages:Array<{page:number;start:number}>} {
  const rawPages=raw.split('\f');
  const compacted=rawPages.map(p=>p.replace(/[ \t]+/g,' ').replace(/[ \t]*\n[ \t]*/g,'\n').replace(/\n{3,}/g,'\n\n').trim());
  const parts:string[]=[];const pages:Array<{page:number;start:number}>=[];let total=0;
  for(let i=0;i<compacted.length;i++){
    const p=compacted[i];
    if(!p)continue;
    const sep=parts.length?'\n\n':'';
    if(total+sep.length+p.length<=tailCut){parts.push(sep+p);pages.push({page:i+1,start:total+sep.length});total+=sep.length+p.length;continue;}
    const room=tailCut-total-sep.length;
    if(room>4){const head=p.slice(0,room-2).replace(/\s+\S*$/,'').trimEnd();if(head){parts.push(sep+head);pages.push({page:i+1,start:total+sep.length});}}
    break;
  }
  return {text:parts.join(''),pages};
}
/** docx/pptx are ZIP+XML: stream the main text part(s) to stdout with `unzip -p` and
 *  strip XML tags deterministically. No new runtime dependencies, no path parsing. */
async function extractOfficeXml(bytes:Buffer,pattern:string):Promise<string> {
  if(bytes.length>BINARY_LIMIT)throw new Error('Invalid document or file exceeds 50 MB');
  const dir=await mkdtemp(join(tmpdir(),'explain-doc-'));
  try {
    const path=join(dir,'source.bin');await writeFile(path,bytes);
    const {stdout}=await promisify(execFile)('unzip',['-p',path,pattern],{timeout:20000,maxBuffer:4*1024*1024});
    if(!stdout.trim())throw new Error('Document is missing its main text part');
    const joined=load(stdout)('w\\:t, a\\:t').text().replace(/\s+/g,' ').trim();
    if(joined.length<20)throw new Error('Document has too little extractable text');
    return joined;
  }finally{await rm(dir,{recursive:true,force:true});}
}
function clip(text:string):string {
  // Collapse horizontal whitespace and excess blank lines, but keep paragraph breaks (\n\n) —
  // the planner's per-chapter chunking splits on them, so flattening to one line would defeat it.
  const compact=text.replace(/[ \t]+/g,' ').replace(/[ \t]*\n[ \t]*/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if(compact.length<=TEXT_LIMIT)return compact;
  return compact.slice(0,TEXT_LIMIT-2).replace(/\s+\S*$/,'')+' …';
}
async function ingestUrl(url:string,signal?:AbortSignal):Promise<{text?:string;pdf?:string;label:string}>{
  try {
    const result=await fetchSource(url,signal);
    if(result.type.includes('pdf')||result.bytes.subarray(0,5).toString()==='%PDF-')return {pdf:await extractPdf(result.bytes,signal),label:url};
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
  // P1: Lamina accepts PDF, Word, PowerPoint, Markdown, plain text and JSON — match that
  // surface. docx/pptx extract deterministically via unzip+XML tag-stripping.
  if(!input||!['prompt','text','url','pdf','docx','pptx','markdown','json'].includes(input.kind))throw new Error('Choose prompt, text, URL, PDF, docx, pptx, markdown or json');
  let text='',label=input.name||input.kind;
  let pages:Array<{page:number;start:number}>|undefined;
  if(input.kind==='url'){
    if(!input.url)throw new Error('A public HTTPS URL is required');
    const ingested=await ingestUrl(input.url,signal);
    if(ingested.pdf){const paged=buildPageText(stripAcademicTail(ingested.pdf));text=paged.text;pages=paged.pages;}
    else text=ingested.text??'';
    label=ingested.label;
  }else if(input.kind==='pdf'){
    const raw=await extractPdf(Buffer.from(input.base64||'','base64'),signal);
    const paged=buildPageText(stripAcademicTail(raw));
    text=paged.text;pages=paged.pages;
  }
  else if(input.kind==='docx')text=await extractOfficeXml(Buffer.from(input.base64||'','base64'),'word/document.xml');
  else if(input.kind==='pptx')text=await extractOfficeXml(Buffer.from(input.base64||'','base64'),'ppt/slides/slide*.xml');
  else if(input.kind==='json'){
    try{const parsed=JSON.parse(input.text||'');text=typeof parsed==='string'?parsed:JSON.stringify(parsed,null,1);}catch{throw new Error('Invalid JSON source');}
  }
  else text=input.text||'';
  if(pages===undefined)text=clip(text);
  if(text.length<20)throw new Error('Source needs at least 20 readable characters. Scanned PDFs need OCR; inaccessible pages need pasted text.');
  return {kind:input.kind,label,text,sha256:createHash('sha256').update(text).digest('hex'),...(pages&&pages.length?{pages}:{})};
}
