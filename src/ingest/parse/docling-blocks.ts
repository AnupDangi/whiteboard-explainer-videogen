import {stableId} from '../../types/contracts.js';
import type {SourceBlock,SourceBlockType,SourceIdentity,SourceLocation} from '../../types/contracts.js';
import {blockText} from '../source-ir.js';
import type {SourceFigure} from '../../types/engine.js';
import type {ParsedDocument,ParsedCrop,ParsedItem} from './engine-client.js';

/** Map a Docling sidecar result into the existing SourceBlock contracts. Pure and
 *  deterministic: the same parsed items always produce the same block ids. This is the
 *  only place that understands Docling labels; the rest of the pipeline sees SourceIR. */

interface ParsedBlocksResult {
  blocks:SourceBlock[];
  figures:SourceFigure[];
  text:string;
  pages:Array<{page:number;start:number}>;
  warnings:string[];
}

const HEADING_LABELS=new Set(['title','section_header','heading']);
const PARAGRAPH_LABELS=new Set(['text','paragraph','reference','page_header','page_footer']);
const TABLE_LABELS=new Set(['table','document_index']);

function levelFor(item:ParsedItem):number{return item.type==='title'?1:2;}

export function mapParsedDocument(identity:SourceIdentity,parsed:ParsedDocument):ParsedBlocksResult{
  const blocks:SourceBlock[]=[];const warnings:string[]=[];
  const pictureCrops=parsed.crops.filter((crop):crop is ParsedCrop&{file:string}=>crop.kind==='picture'&&typeof crop.file==='string');
  const tableCrops=parsed.crops.filter((crop):crop is ParsedCrop&{file:string}=>crop.kind==='table'&&typeof crop.file==='string');
  let ordinal=0;let cursor=0;let pictureIndex=0;let tableIndex=0;
  const pictureByRef=new Map(parsed.crops.filter(crop=>crop.kind==='picture'&&crop.selfRef).map(crop=>[crop.selfRef as string,crop]));
  const tableByRef=new Map(parsed.crops.filter(crop=>crop.kind==='table'&&crop.selfRef).map(crop=>[crop.selfRef as string,crop]));
  let pendingList:string[]=[];let pendingListPage:number|undefined;

  const flushList=()=>{
    if(!pendingList.length)return;
    const id=stableId('blk',identity.sha256,++ordinal,'list',pendingList.join('\u0001'));
    blocks.push({id,sourceId:identity.id,type:'list',ordered:false,items:[...pendingList],location:{...(pendingListPage!==undefined?{page:pendingListPage}:{}),start:cursor}});
    pendingList=[];
    pendingListPage=undefined;
  };
  const make=(type:SourceBlockType,item:ParsedItem,fields:Record<string,unknown>)=>{
    const textish=String(fields.text??fields.caption??fields.imageRef??'');
    const location:SourceLocation={...(item.page!==undefined&&item.page!==null?{page:item.page}:{}),start:cursor,end:cursor+textish.length};
    const id=stableId('blk',identity.sha256,++ordinal,type,textish);
    blocks.push({id,sourceId:identity.id,type,location,...fields} as SourceBlock);
    cursor+=textish.length+1;
  };

  for(const item of parsed.items){
    if(item.type==='list_item'){
      const value=(item.text||'').trim();
      if(value){pendingList.push(value);if(pendingListPage===undefined)pendingListPage=item.page??undefined;}
      continue;
    }
    flushList();
    if(HEADING_LABELS.has(item.type)){
      const value=(item.text||'').trim();
      if(value)make('heading',item,{text:value,level:levelFor(item)});
    }else if(item.type==='formula'){
      const latex=(item.latex||item.text||'').trim();
      if(latex)make('equation',item,{text:latex,...(latex.includes('\\')||latex.includes('^')||latex.includes('_')?{latex}:{})});
    }else if(TABLE_LABELS.has(item.type)){
      const columns=item.columns??[];const rows=item.rows??[];
      if(columns.length){
        const crop=tableByRef.get(item.selfRef||'')??tableCrops[tableIndex++];
        const caption=item.captions?.[0];
        make('table',item,{columns,rows,...(caption?{caption}:{}),...(crop?{imageRef:crop.assetRef??crop.file}:{})});
      }else if(item.text?.trim()){
        make('paragraph',item,{text:item.text.trim()});
      }
    }else if(item.type==='picture'){
      const crop=pictureByRef.get(item.selfRef||'')??pictureCrops[pictureIndex++];
      const caption=item.captions?.find(value=>value&&value.trim());
      make('figure',item,{nearbyText:[],...(caption?{caption:caption.trim()}:{}),...(crop?{imageRef:crop.assetRef??crop.file}:{})});
    }else if(item.type==='caption'){
      const value=(item.text||'').trim();
      if(value)make('caption',item,{text:value});
    }else if(item.type==='code'){
      const value=(item.text||'').trim();
      if(value)make('code',item,{text:value});
    }else if(PARAGRAPH_LABELS.has(item.type)){
      const value=(item.text||'').trim();
      if(value)make('paragraph',item,{text:value});
    }else if(item.text?.trim()){
      make('paragraph',item,{text:item.text.trim()});
    }
  }
  flushList();

  const figures:SourceFigure[]=blocks
    .filter((block):block is Extract<SourceBlock,{type:'figure'}>&{location:{page?:number}}=>block.type==='figure'&&typeof block.location.page==='number')
    .map(block=>({page:block.location.page as number,kind:'figure',caption:block.caption??'',dataHint:'',keyNumbers:[]}));

  if(parsed.pictures>pictureCrops.length)warnings.push(`Docling reported ${parsed.pictures} pictures but only ${pictureCrops.length} crops were written`);
  // Assemble text + page offsets in block order, mirroring buildPageText's contract so
  // downstream document-map/retrieval page mapping keeps working.
  const pages:Array<{page:number;start:number}>=[];
  const seenPages=new Set<number>();
  let text='';
  for(const block of blocks){
    const body=blockText(block).trim();
    if(!body)continue;
    const sep=text?'\n\n':'';
    const start=text.length+sep.length;
    const page=block.location.page;
    if(typeof page==='number'&&!seenPages.has(page)){seenPages.add(page);pages.push({page,start});}
    text+=sep+body;
  }
  return {blocks,figures,text,pages,warnings};
}

export interface FigureDescription {caption:string;kind?:string;dataHint?:string;keyNumbers?:string[]}

const shaFromAssetRef=(ref?:string):string|undefined=>ref?.match(/assets\/([a-f0-9]{8,})\./)?.[1];

/** Attach selective VLM descriptions to figure blocks and rebuild the SourceFigure
 *  inventory from the enriched blocks. Pure: same blocks + descriptions -> same output. */
export function applyFigureDescriptions(blocks:SourceBlock[],descriptions:Map<string,FigureDescription>):{blocks:SourceBlock[];figures:SourceFigure[]}{
  const enriched=blocks.map(block=>{
    if(block.type!=='figure')return block;
    const sha=shaFromAssetRef(block.imageRef);
    const description=sha?descriptions.get(sha):undefined;
    if(!description)return block;
    return {...block,description:description.caption,...(block.caption?{}:{caption:description.caption})};
  });
  const figures:SourceFigure[]=[];
  for(const block of enriched){
    if(block.type!=='figure')continue;
    const page=block.location.page;
    if(typeof page!=='number')continue;
    const sha=shaFromAssetRef(block.imageRef);
    const description=sha?descriptions.get(sha):undefined;
    figures.push({page,kind:'figure',caption:description?.caption??block.caption??'',dataHint:description?.dataHint??'',keyNumbers:description?.keyNumbers??[]});
  }
  return {blocks:enriched,figures};
}
