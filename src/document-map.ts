import type {SourceDocument,DocumentMap,MapSection} from './types.js';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** LD2: hierarchical document map. Heading detection over page-tagged text → ordered
 *  section list with true page numbers, tiling char spans and extractive summaries.
 *  Zero model calls, fully deterministic; cached by source sha256 under `.data/`.
 *  The outline call (LD5) reads this map instead of raw text. */

const MAX_SECTIONS=48;
const MAX_WINDOW_SECTIONS=16;
const HEADING_MAX_CHARS=72;
const SUMMARY_CHARS=400;
const PAPER_MAX_PAGES=40;

/** Same class of heuristic prompt-builder uses: short standalone line, optionally
 *  numbered ("3.2 Methods"), no trailing sentence punctuation, mostly letters. */
function looksLikeHeading(line:string):boolean {
  const t=line.trim();
  if(t.length<3||t.length>HEADING_MAX_CHARS)return false;
  if(/[.,;:!?]$/.test(t))return false;
  if(/^(figure|table|fig\.|algorithm|equation|appendix|references|acknowledg)/i.test(t)&&t.length>30)return false;
  if(!/^(\d+(\.\d+)*\.?\s+)?[A-Z0-9(]/.test(t))return false;
  if(!/[a-zA-Z]/.test(t))return false;
  const letters=(t.match(/[a-zA-Z]/g)||[]).length;
  return letters/t.length>=0.5;
}

interface HeadingHit { start:number; page:number; title:string }

function scanHeadings(source:SourceDocument):HeadingHit[] {
  const pageSpans=source.pages;
  const spans=pageSpans&&pageSpans.length
    ?pageSpans.map((p,i)=>({page:p.page,start:p.start,end:i+1<pageSpans.length?pageSpans[i+1].start:source.text.length}))
    :[{page:1,start:0,end:source.text.length}];
  const hits:HeadingHit[]=[];
  for(const span of spans){
    const pageText=source.text.slice(span.start,span.end);
    const lines=pageText.split('\n');
    let offset=span.start;
    for(const line of lines){
      if(looksLikeHeading(line)){
        const title=line.trim();
        const last=hits[hits.length-1];
        // Consecutive duplicate heading lines (TOC entry + body header) collapse to one.
        if(!last||last.title!==title||offset-last.start>200)hits.push({start:offset,page:span.page,title});
      }
      offset+=line.length+1;
    }
  }
  return hits;
}

/** Extractive summary: first sentence + up to two number-bearing sentences. No model. */
function summarize(body:string):string {
  const flat=body.replace(/\s+/g,' ').trim();
  if(!flat)return '';
  const sentences=flat.split(/(?<=[.?!])\s+/);
  const parts:string[]=[];
  const push=(s:string)=>{s=s.trim();if(!s)return;const capped=s.length>200?s.slice(0,200).replace(/\s+\S*$/,''):s;if(!parts.some(p=>p===capped))parts.push(capped);};
  if(sentences[0])push(sentences[0]);
  for(const s of sentences){if(parts.length>=3)break;if(/\d/.test(s))push(s);}
  let summary=parts.join(' ');
  if(summary.length>SUMMARY_CHARS)summary=summary.slice(0,SUMMARY_CHARS-2).replace(/\s+\S*$/,'')+' …';
  return summary;
}

export function buildDocumentMap(source:SourceDocument):DocumentMap {
  const totalPages=source.pages?.length||1;
  const kindFor=(headingCount:number)=>headingCount>=3?(totalPages<=PAPER_MAX_PAGES?'paper':'book'):'unknown';
  const hits=scanHeadings(source);
  if(hits.length<3){
    // Fallback: fixed page windows so a structureless long document still gets bounded,
    // tiling sections the outline can route over.
    if(!source.pages?.length){
      return {kind:'unknown',sections:[{id:'s1',title:source.label.slice(0,80),page:1,start:0,end:source.text.length,charCount:source.text.length,summary:summarize(source.text)}]};
    }
    const windowCount=Math.min(MAX_WINDOW_SECTIONS,Math.max(2,Math.ceil(totalPages/12)));
    const groupSize=Math.ceil(totalPages/windowCount);
    const sections:MapSection[]=[];
    for(let i=0;i<totalPages;i+=groupSize){
      const from=source.pages[i];
      const toEnd=Math.min(i+groupSize,totalPages);
      const end=toEnd<totalPages?source.pages[toEnd].start:source.text.length;
      if(end<=from.start)continue;
      sections.push({id:`s${sections.length+1}`,title:`Pages ${from.page}–${source.pages[toEnd-1].page}`,page:from.page,start:from.start,end,charCount:end-from.start,summary:summarize(source.text.slice(from.start,end))});
    }
    return {kind:totalPages>PAPER_MAX_PAGES?'book':'unknown',sections};
  }
  // Cap: evenly-spaced selection keeps first/last headings and tiles the whole text —
  // unselected headings' content stays inside their section's span.
  let starts=hits;
  if(starts.length>MAX_SECTIONS){
    const stride=starts.length/MAX_SECTIONS;
    const picked=[starts[0]];
    for(let i=1;i<MAX_SECTIONS-1;i++){
      const candidate=starts[Math.min(starts.length-1,Math.round(i*stride))];
      if(candidate.start>picked[picked.length-1].start)picked.push(candidate);
    }
    if(starts[starts.length-1].start>picked[picked.length-1].start)picked.push(starts[starts.length-1]);
    starts=picked;
  }
  const mapped:MapSection[]=starts.map((h,i)=>{
    const end=i+1<starts.length?starts[i+1].start:source.text.length;
    return {id:`s${i+1}`,title:h.title.slice(0,80),page:h.page,start:h.start,end,charCount:Math.max(0,end-h.start),summary:summarize(source.text.slice(h.start,end))};
  });
  // A heading at the very end of the document yields an empty body — drop it unless it
  // is the only section.
  const sections=mapped.filter(s=>s.charCount>0);
  return {kind:kindFor(starts.length),sections:sections.length?sections:mapped};
}

export function mapCachePath(root:string,sha256:string):string {return join(root,`map-${sha256}.json`);}
export async function readCachedMap(root:string,sha256:string):Promise<DocumentMap|null> {
  try {
    const parsed=JSON.parse(await readFile(mapCachePath(root,sha256),'utf8'));
    return parsed&&Array.isArray(parsed.sections)&&parsed.sections.length?parsed as DocumentMap:null;
  }catch{return null;}
}
export async function writeCachedMap(root:string,sha256:string,map:DocumentMap):Promise<void> {
  await writeFile(mapCachePath(root,sha256),JSON.stringify(map));
}
