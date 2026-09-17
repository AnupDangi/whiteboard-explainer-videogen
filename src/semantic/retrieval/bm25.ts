import type {SemanticChunk} from '../source/chunker.js';

/** Zero-dependency BM25 plus deterministic RRF fusion with optional vectors.
 *  Pure: no network, no provider, no clock. Vectors are supplied by the caller
 *  so this layer never performs I/O (`Architecture_plan.md` §8, §68). */
const STOPWORDS=new Set(['a','an','the','in','on','of','to','for','and','or','is','are','was','were','be','been','being','with','as','at','by','it','its','this','that','these','those','from','into','can','could','would','should','do','does','did','not','no','nor','but','if','then','than','so','such','their','there','when','which','who','whom','how','what','why','where','also','more','most','other','some','any','each','per','via','using','use','used','may','might','must','shall','will','have','has','had','we','you','they','he','she','his','her','our','your']);
const K1=1.2,B=0.75,RRF_K=60;

export function words(text:string):string[]{
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(' ').filter(w=>w.length>1&&!STOPWORDS.has(w));
}

export interface Bm25Index { chunks:SemanticChunk[]; termCounts:Map<string,number>[]; df:Map<string,number>; N:number; avgLen:number }

export function buildBm25Index(chunks:SemanticChunk[]):Bm25Index{
  const df=new Map<string,number>();
  const termCounts=chunks.map(chunk=>{
    const counts=new Map<string,number>();
    for(const word of words(chunk.text))counts.set(word,(counts.get(word)||0)+1);
    for(const term of counts.keys())df.set(term,(df.get(term)||0)+1);
    return counts;
  });
  const N=chunks.length;
  const avgLen=N?chunks.reduce((sum,chunk)=>sum+chunk.text.length,0)/N:1;
  return {chunks,termCounts,df,N,avgLen};
}

export function bm25Scores(index:Bm25Index,terms:string[]):number[]{
  const idf=(term:string)=>Math.log(1+(index.N-(index.df.get(term)||0)+0.5)/((index.df.get(term)||0)+0.5));
  return index.chunks.map((chunk,i)=>{
    const counts=index.termCounts[i];let score=0;
    for(const term of terms){
      const tf=counts.get(term);if(!tf)continue;
      score+=idf(term)*(tf*(K1+1))/(tf+K1*(1-B+B*chunk.text.length/index.avgLen));
    }
    return score;
  });
}

export function cosine(a:number[],b:number[]):number{
  if(!a||!b||a.length!==b.length||!a.length)return 0;
  let dot=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}
  if(!na||!nb)return 0;
  return dot/Math.sqrt(na*nb);
}

/** 0-based rank among positive scores; ties broken by index for determinism. */
function orderedRank(scores:number[],i:number):number{
  let rank=0;
  for(let j=0;j<scores.length;j++){if(j===i)continue;if(scores[j]>scores[i]||(scores[j]===scores[i]&&j<i))rank++;}
  return rank;
}

export interface RankedChunk {chunk:SemanticChunk; score:number; bm25:number; vector:number}

/** Rank chunks for a query. When per-chunk vectors and a query vector are
 *  supplied, BM25 and cosine ranks fuse via RRF; otherwise BM25 only. */
export function rankChunks(index:Bm25Index,terms:string[],vectors?:number[][],queryVector?:number[]):RankedChunk[]{
  const bm=bm25Scores(index,terms);
  const useVectors=Boolean(vectors&&queryVector);
  const vec=useVectors?index.chunks.map((_chunk,i)=>cosine(vectors![i]??[],queryVector!)):[];
  const scored=index.chunks.map((chunk,i)=>{
    let score=bm[i];
    if(useVectors){
      score=0;
      const bmRank=bm[i]>0?orderedRank(bm,i):-1;
      const vecRank=vec[i]>0?orderedRank(vec,i):-1;
      if(bmRank>=0)score+=1/(RRF_K+bmRank+1);
      if(vecRank>=0)score+=1/(RRF_K+vecRank+1);
    }
    return {chunk,score,bm25:bm[i],vector:vec[i]??0};
  });
  return scored.filter(entry=>entry.score>0).sort((a,b)=>b.score-a.score||a.chunk.start-b.chunk.start);
}
