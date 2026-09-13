import type {SourceDocument,DocumentMap,MapSection} from '../shared/types.js';
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

/** Same class of heuristic prompt-builder uses, hardened against live-run junk
 *  (DeepSeek-V3 map picked up table rows and TOC lines as sections). Rules:
 *  numbered lines ("1. Introduction", "2 Architecture") always qualify; unnumbered
 *  lines must look like real headings — title-case multi-word, ALL-CAPS multi-word,
 *  or a known section word — never parentheticals ("(Pass@1)"), math glyphs
 *  ("Accuracy / Percentile (%)"), stray digits ("Architecture 6"), or lone acronyms
 *  ("MMLU-Pro"). */
const KNOWN_SECTIONS=/^(abstract|introduction|conclusion|summary|overview|background|related work|discussion|evaluation|results|methods?|limitations?|acknowledg\w*|references?|appendix|contributions?|preliminar\w*|experiments?|conclusion)$/i;
function looksLikeHeading(line:string):boolean {
  const t=line.trim();
  if(t.length<3||t.length>HEADING_MAX_CHARS)return false;
  if(/[.,;:!?]$/.test(t))return false;
  if(/^(figure|table|fig\.|algorithm|equation|appendix|references|acknowledg)/i.test(t)&&t.length>30)return false;
  // Live-run junk: dot-leader fragments ('. For'), axis glyphs ('Time ➔'), math markers.
  if(!/^[A-Za-z0-9]/.test(t))return false;
  if(/[^\p{L}\p{N}\s\-.,:'’()]/u.test(t))return false;
  const numbered=t.match(/^(\d+(\.\d+)*\.?\s+)/);
  const body=(numbered?t.slice(numbered[0].length):t).trim();
  if(!body)return false;
  if(!/[a-zA-Z]/.test(body))return false;
  const letters=(body.match(/[a-zA-Z]/g)||[]).length;
  if(letters/body.length<0.5)return false;
  if(numbered){
    // TOC lines ("2 Architecture 6") keep their leading number but carry a trailing
    // page number — a body with digits after the numbering is not a heading.
    if(/\d/.test(body))return false;
    return true;
  }
  if(/\d/.test(body))return false;
  const words=body.split(/\s+/).filter(Boolean);
  if(KNOWN_SECTIONS.test(body))return true;
  if(words.length===1){
    // A single capitalized word qualifies only when it is ALL-CAPS without hyphens
    // ("ARCHITECTURE") or Title-case in the known list — acronyms like "MMLU-Pro" die.
    if(body===body.toUpperCase()&&body.length>=5&&!/-/.test(body))return true;
    if(KNOWN_SECTIONS.test(body))return true;
    return false;
  }
  // Multi-word: title-case ("Post-Training Objectives") or ALL-CAPS ("SYSTEM OVERVIEW").
  const titleCase=body.split(/\s+/).every(w=>/^[A-Z][a-zA-Z-]*$/.test(w)||KNOWN_SECTIONS.test(w)||w.length<=2);
  const allCaps=body===body.toUpperCase()&&/[A-Z]/.test(body);
  // A run of ≥4 all-title-case words is a table-header row of column names, not a
  // section heading ("Training Costs Pre-Training Context Extension Post-Training").
  if(titleCase&&words.length>=4&&!allCaps)return false;
  return titleCase||allCaps;
}

interface HeadingHit { start:number; page:number; title:string; numbered:boolean }

/** Junk-section filters (live-run root cause: table headers, figure labels and legend
 *  rows pass the title-case test and pollute the map — the outline then routes chapters
 *  to them, the evidence set fills with fragments, and grounding fails deterministically).
 *  (a) an unnumbered heading whose body is tiny (<800 chars) is a figure label, not a
 *  section — drop it and let its text absorb into the previous section;
 *  (b) repeated tokens ("RMSNorm RMSNorm", "Architecture MoE MoE Dense Dense") are
 *  chart/legend rows, never headings. */
function junkHeading(hit:HeadingHit,sectionChars:number):boolean {
  if(hit.numbered)return false;
  if(sectionChars<800)return true;
  const tokens=hit.title.toLowerCase().split(/\s+/).filter(Boolean);
  const counts=new Map<string,number>();
  for(const t of tokens)counts.set(t,(counts.get(t)||0)+1);
  return [...counts.values()].some(c=>c>=2);
}

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
        if(!last||last.title!==title||offset-last.start>200)hits.push({start:offset,page:span.page,title,numbered:/^\d/.test(title)});
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
  const windows=()=>{
    if(!source.pages?.length){
      return {kind:'unknown' as const,sections:[{id:'s1',title:source.label.slice(0,80),page:1,start:0,end:source.text.length,charCount:source.text.length,summary:summarize(source.text)}]};
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
    return {kind:(totalPages>PAPER_MAX_PAGES?'book':'unknown') as DocumentMap['kind'],sections};
  };
  const hits=scanHeadings(source);
  if(hits.length<3){
    // Fallback: fixed page windows so a structureless long document still gets bounded,
    // tiling sections the outline can route over.
    return windows();
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
  // Junk filter pass: compute provisional spans, drop figure-label/legend headings
  // (tiny unnumbered bodies, repeated tokens), then rebuild so the dropped heading's
  // text absorbs into the surviving neighbours. One pass is enough — surviving
  // sections only GROW when a neighbour is removed.
  const provisional=starts.map((h,i)=>{
    const end=i+1<starts.length?starts[i+1].start:source.text.length;
    return {hit:h,end,charCount:Math.max(0,end-h.start)};
  });
  const junk=new Set(provisional.filter(p=>junkHeading(p.hit,p.charCount)).map(p=>p.hit));
  if(junk.size)starts=starts.filter(h=>!junk.has(h));
  if(starts.length<3){
    // Everything filtered out → the document is effectively structureless after all.
    return windows();
  }
  const mapped:MapSection[]=starts.map((h,i)=>{
    const end=i+1<starts.length?starts[i+1].start:source.text.length;
    const raw=source.text.slice(h.start,end);
    // The heading line is the title, not body — summarize only what follows it.
    const body=raw.slice(raw.indexOf('\n')+1);
    return {id:`s${i+1}`,title:h.title.slice(0,80),page:h.page,start:h.start,end,charCount:Math.max(0,end-h.start),summary:summarize(body)};
  });
  // A heading at the very end of the document yields an empty body — drop it unless it
  // is the only section.
  const sections=mapped.filter(s=>s.charCount>0);
  return {kind:kindFor(starts.length),sections:sections.length?sections:mapped};
}

/** LD5: the text the outline call sees for large sources — bounded section list with
 *  ids the model must route chapters to via sourceSections. Replaces clipped raw text.
 *  Cost RCA: this payload was 89% of a 1-min run's model cost (9.4k input tokens at
 *  flash pricing), so summaries are capped hard — enough to route, not to re-teach. */
export function renderMapForOutline(map:DocumentMap):string {
  return [
    'DOCUMENT MAP — the full source is large, so plan from this section map.',
    'Every chapter MUST set sourceSections to the section ids (from this list) it teaches from.',
    ...map.sections.map(s=>`${s.id} | p${s.page} | ${s.title} — ${s.summary.slice(0,180)}`),
  ].join('\n');
}

// Map heuristic version: bump whenever the heading/junk heuristics change so cached
// maps rebuild instead of serving a stale structure.
const MAP_CACHE_VERSION='v3';
export function mapCachePath(root:string,sha256:string):string {return join(root,`map-${MAP_CACHE_VERSION}-${sha256}.json`);}
export async function readCachedMap(root:string,sha256:string):Promise<DocumentMap|null> {
  try {
    const parsed=JSON.parse(await readFile(mapCachePath(root,sha256),'utf8'));
    return parsed&&Array.isArray(parsed.sections)&&parsed.sections.length?parsed as DocumentMap:null;
  }catch{return null;}
}
export async function writeCachedMap(root:string,sha256:string,map:DocumentMap):Promise<void> {
  await writeFile(mapCachePath(root,sha256),JSON.stringify(map));
}
