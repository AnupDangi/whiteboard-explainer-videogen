import {log} from './logger.js';
import type {SourceDocument} from './types.js';

/** LD3: structural chunking + zero-dependency BM25 retrieval. Replaces the per-chapter
 *  lexical scorer as the baseline evidence engine; tiny/structureless sources fall back
 *  to whole-text pass-through (the old retrieveForChapter behavior). Pure, deterministic. */

export interface SourceChunk { id:string; page:number; start:number; text:string }
export interface EvidenceSet { text:string; ids:string[]; texts:Record<string,string> }

const STOPWORDS=new Set(['a','an','the','in','on','of','to','for','and','or','is','are','was','were','be','been','being','with','as','at','by','it','its','this','that','these','those','from','into','can','could','would','should','do','does','did','not','no','nor','but','if','then','than','so','such','their','there','when','which','who','whom','how','what','why','where','also','more','most','other','some','any','each','per','via','using','use','used','may','might','must','shall','will','have','has','had','we','you','they','he','she','his','her','our','your']);
const K1=1.2;
const B=0.75;
/** Reciprocal Rank Fusion constant (standard k=60): ranks from BM25 and cosine
 *  similarity fuse into score = Σ 1/(k+rank). Deterministic float math. */
const RRF_K=60;

function words(text:string):string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(' ').filter(w=>w.length>1&&!STOPWORDS.has(w));
}

function pageAt(pages:SourceDocument['pages'],start:number):number {
  if(!pages||!pages.length)return 1;
  let lo=0,hi=pages.length-1,page=pages[0].page;
  while(lo<=hi){
    const mid=(lo+hi)>>1;
    if(pages[mid].start<=start){page=pages[mid].page;lo=mid+1;}
    else hi=mid-1;
  }
  return page;
}

/** Paragraph-boundary chunks targeting ~1.6k chars (single paragraphs are never split,
 *  so a chunk can exceed the target). IDs `p{page}:c{n}` are stable across runs: the
 *  index n is per page, in document order. */
export function chunkSource(source:SourceDocument,{maxChars=1600}:{maxChars?:number}={}):SourceChunk[] {
  const text=source.text;
  const paragraphs:Array<{text:string;start:number}>=[];
  const re=/\n{2,}/g;
  let last=0;let m:RegExpExecArray|null;
  const take=(slice:string,from:number)=>{
    const seg=slice.trim();
    if(!seg)return;
    paragraphs.push({text:seg,start:from+(slice.length-slice.trimStart().length)});
  };
  while((m=re.exec(text))){take(text.slice(last,m.index),last);last=m.index+m[0].length;}
  take(text.slice(last),last);
  const chunks:SourceChunk[]=[];
  const perPage=new Map<number,number>();
  let buf:string[]=[];let bufStart=-1;let bufLen=0;
  const flush=()=>{
    if(!buf.length)return;
    const page=pageAt(source.pages,bufStart);
    const n=(perPage.get(page)||0)+1;
    perPage.set(page,n);
    chunks.push({id:`p${page}:c${n}`,page,start:bufStart,text:buf.join('\n\n')});
    buf=[];bufStart=-1;bufLen=0;
  };
  for(const p of paragraphs){
    if(bufStart<0)bufStart=p.start;
    if(bufLen>0&&bufLen+p.text.length+2>maxChars)flush();
    if(bufStart<0)bufStart=p.start;
    buf.push(p.text);
    bufLen+=(buf.length>1?p.text.length+2:p.text.length);
    if(bufLen>=maxChars)flush();
  }
  flush();
  return chunks;
}

/** Per-chapter evidence: BM25 over the objective + key points, optionally fused with
 *  cosine similarity over precomputed chunk vectors (LD4 hybrid, Reciprocal Rank
 *  Fusion). Evidence is assembled in original document order within a char budget.
 *  Returns chunk ids (LD6 evidenceIds) alongside the text. Falls back to whole text
 *  for tiny/structureless sources, and to BM25-only when no vectors are supplied. */
export function retrieveChapterEvidence(source:SourceDocument,objective:string,keyPoints:string[],budget=8000,opts:{maxChars?:number;vectors?:number[][];queryVector?:number[];sectionSpans?:Array<{start:number;end:number}>}={}):EvidenceSet {
  const allChunks=chunkSource(source,opts);
  const index=Object.fromEntries(allChunks.map(c=>[c.id,c.text]));
  if(allChunks.length<=3)return {text:source.text,ids:allChunks.map(c=>c.id),texts:index};
  // LD5: when the outline routed this chapter to sections, only chunks FULLY inside
  // those spans compete — a chunk straddling a section boundary serves neither section
  // and is dropped from both. Empty routing outcome falls back to whole-document (logged).
  let chunks=allChunks;
  if(opts.sectionSpans&&opts.sectionSpans.length){
    const scoped=allChunks.filter(c=>opts.sectionSpans!.some(sp=>c.start>=sp.start&&c.start+c.text.length<=sp.end));
    if(scoped.length){chunks=scoped;}
    else log('source.section-scope-empty',{spans:opts.sectionSpans.length});
  }
  const vectorById=opts.vectors?new Map(allChunks.map((c,i)=>[c.id,opts.vectors![i]])):null;
  const terms=new Set([...words(objective),...keyPoints.flatMap(k=>words(k))]);
  if(!terms.size&&!(vectorById&&opts.queryVector))return sequentialFallback(chunks,budget);
  const df=new Map<string,number>();
  const chunkTerms=chunks.map(c=>{
    const counts=new Map<string,number>();
    for(const w of words(c.text))counts.set(w,(counts.get(w)||0)+1);
    for(const t of counts.keys())df.set(t,(df.get(t)||0)+1);
    return counts;
  });
  const N=chunks.length;
  const avgLen=N?chunks.reduce((s,c)=>s+c.text.length,0)/N:1;
  const idf=(t:string)=>Math.log(1+(N-(df.get(t)||0)+0.5)/((df.get(t)||0)+0.5));
  const bm25=chunks.map((c,i)=>{
    const counts=chunkTerms[i];
    let score=0;
    for(const t of terms){
      const tf=counts.get(t);
      if(!tf)continue;
      score+=idf(t)*(tf*(K1+1))/(tf+K1*(1-B+B*c.text.length/avgLen));
    }
    return score;
  });
  // Hybrid path: cosine ranks (vector-per-chunk-id, aligned to the FULL chunk list)
  // fuse with BM25 via RRF; missing vectors just mean that rank contributes nothing.
  const useHybrid=!!(vectorById&&opts.queryVector);
  const cosScores=useHybrid?chunks.map(c=>cosine(vectorById!.get(c.id)||[],opts.queryVector!)):[];
  const finalScore=chunks.map((_,i)=>{
    if(!useHybrid)return bm25[i];
    const bmRank=bm25[i]>0?orderedRank(bm25,i):-1;
    const cosRank=cosScores[i]>0?orderedRank(cosScores,i):-1;
    let s=0;
    if(bmRank>=0)s+=1/(RRF_K+bmRank+1);
    if(cosRank>=0)s+=1/(RRF_K+cosRank+1);
    return s;
  });
  const positive=chunks.map((c,i)=>({chunk:c,score:finalScore[i]})).filter(s=>s.score>0).sort((a,b)=>b.score-a.score);
  if(!positive.length)return sequentialFallback(chunks,budget);
  // Always take the best chunk whole (budget is soft for rank 1), then fill greedily.
  const keep:SourceChunk[]=[positive[0].chunk];
  let total=positive[0].chunk.text.length;
  for(const s of positive.slice(1)){
    if(total+s.chunk.text.length>budget)continue;
    keep.push(s.chunk);
    total+=s.chunk.text.length;
  }
  return assemble(keep,budget,index);
}

function cosine(a:number[],b:number[]):number {
  if(!a||!b||a.length!==b.length||!a.length)return 0;
  let dot=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}
  if(!na||!nb)return 0;
  return dot/Math.sqrt(na*nb);
}

/** 0-based rank of element i among positive scores (ties broken by index → deterministic). */
function orderedRank(scores:number[],i:number):number {
  let rank=0;
  for(let j=0;j<scores.length;j++){
    if(j===i)continue;
    if(scores[j]>scores[i]||(scores[j]===scores[i]&&j<i))rank++;
  }
  return rank;
}

function sequentialFallback(chunks:SourceChunk[],budget:number):EvidenceSet {
  const index=Object.fromEntries(chunks.map(c=>[c.id,c.text]));
  return assemble([...chunks].sort((a,b)=>a.start-b.start),budget,index);
}

/** Join chunks in document order up to the budget; every included chunk stays whole. */
function assemble(kept:SourceChunk[],budget:number,index:Record<string,string>):EvidenceSet {
  const ordered=[...kept].sort((a,b)=>a.start-b.start);
  if(!ordered.length)return {text:'',ids:[],texts:{}};
  const parts:string[]=[];const ids:string[]=[];const texts:Record<string,string>={};
  let total=0;
  for(const c of ordered){
    const sep=parts.length?'\n\n':'';
    if(parts.length&&total+sep.length+c.text.length>budget)break;
    parts.push(sep+c.text);
    ids.push(c.id);
    texts[c.id]=c.text;
    total+=sep.length+c.text.length;
  }
  return {text:parts.join(''),ids,texts};
}
