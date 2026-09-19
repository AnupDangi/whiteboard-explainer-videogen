import type {SourceDocument} from '../../shared/types.js';
import {blockText,estimateTokens} from '../../shared/ingestion/blocks.js';
import type {BlockType} from '../../shared/ingestion/blocks.js';

/** Semantic chunking (`Architecture_plan.md` §7-8). Chunks respect heading,
 *  paragraph, figure, table, equation and code boundaries; related blocks pack
 *  to a ~700-1500 token target. A single indivisible block (a big table or code
 *  listing) is kept whole rather than split. Pure and deterministic. */
export interface SemanticChunk {
  id:string;
  sectionPath:string[];
  page?:number;
  start:number;
  text:string;
  blockTypes:BlockType[];
  tokens:number;
}

export interface ChunkOptions {targetTokens?:number;maxTokens?:number}

export const CHUNK_DEFAULTS={targetTokens:1000,maxTokens:1500} as const;

export function chunkSourceDocument(doc:SourceDocument,options:ChunkOptions={}):SemanticChunk[]{
  const target=options.targetTokens??CHUNK_DEFAULTS.targetTokens;
  const max=options.maxTokens??CHUNK_DEFAULTS.maxTokens;
  const blocks=doc.blocks??[];
  if(!blocks.length)return doc.text.trim()?[{id:'s0:c1',sectionPath:[],start:0,text:doc.text,tokens:estimateTokens(doc.text),blockTypes:['text']}]:[];

  const chunks:SemanticChunk[]=[];
  const sectionPath:string[]=[];
  let section=0,inSection=0;
  let buffer:{text:string;page?:number;start:number;types:BlockType[]}=empty();
  let offset=0;

  function empty(){return {text:'',page:undefined as number|undefined,start:-1,types:[] as BlockType[]};}
  function flush(){
    if(!buffer.text.trim()){buffer=empty();return;}
    inSection++;
    chunks.push({id:`s${section}:c${inSection}`,sectionPath:[...sectionPath],...(buffer.page!==undefined?{page:buffer.page}:{}),start:buffer.start,text:buffer.text.trim(),blockTypes:[...new Set(buffer.types)],tokens:estimateTokens(buffer.text)});
    buffer=empty();
  }
  function add(text:string,page:number|undefined,type:BlockType,start:number){
    if(buffer.start<0)buffer.start=start;
    if(buffer.page===undefined)buffer.page=page;
    buffer.text+=(buffer.text?'\n\n':'')+text;
    buffer.types.push(type);
  }

  for(const block of blocks){
    const start=offset;
    const text=blockText(block);
    offset+=text.length+2;
    if(!text.trim())continue;
    if(block.type==='heading'){
      flush();
      const level=block.level??1;
      sectionPath.length=Math.max(0,level-1);
      sectionPath[level-1]=block.text;
      sectionPath.splice(level);
      section++;
      inSection=0;
      continue;
    }
    const tokens=estimateTokens(text);
    const indivisible=block.type==='code'||block.type==='table'||block.type==='equation'||block.type==='figure';
    if(indivisible){
      if(buffer.text.trim()&&estimateTokens(buffer.text)+tokens>max)flush();
      add(text,block.page,block.type,start);
      if(estimateTokens(buffer.text)>=target)flush();
      continue;
    }
    if(buffer.text.trim()&&estimateTokens(buffer.text)+tokens>max)flush();
    add(text,block.page,block.type,start);
    if(estimateTokens(buffer.text)>=target)flush();
  }
  flush();
  return chunks;
}
