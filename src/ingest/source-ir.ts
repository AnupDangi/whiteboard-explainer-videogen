import type {SourceDocument} from '../types/engine.js';
import type {SourceBlock,SourceBlockType,SourceIR,SourceIdentity} from '../types/contracts.js';
import {stableId} from '../types/contracts.js';

export type {SourceBlockType};

const HEADING=/^(#{1,6})\s+(.+)$/;
const FENCE=/^\s*(```|~~~)\s*([a-zA-Z0-9+#-]*)\s*$/;
const FIGURE=/^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const TABLE_SEP=/^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const EQUATION_LINE=/^\s*(\$\$|\\\[|\\\()/;
const LIST=/^\s*((?:[-+*])|(?:\d+[.)]))\s+(.+)$/;
const CAPTION=/^\s*(?:figure|fig\.|table|diagram)\s+\d+[.:]\s*(.+)$/i;
const CITATION=/^\s*(?:\[\d+\]|\(\w[^)]*\d{4}\))\s+(.+)$/;

function isTableRow(line:string):boolean{return line.trim().includes('|')&&line.trim().split('|').filter(part=>part.trim()).length>=2;}
function looksLikeHeading(line:string):boolean{
  const value=line.trim();if(value.length<3||value.length>80||/[.!?,;:]$/.test(value))return false;
  const words=value.split(/\s+/);if(words.length>12)return false;
  const letters=value.replace(/[^A-Za-z]/g,'');if(letters.length<3)return false;
  return letters===letters.toUpperCase()||(words.length<=8&&words.filter(word=>/^[A-Z]/.test(word)).length>=Math.ceil(words.length*.6));
}
function pageAt(pages:SourceDocument['pages'],offset:number):number|undefined{
  if(!pages?.length)return undefined;let low=0,high=pages.length-1,page=pages[0].page;
  while(low<=high){const mid=(low+high)>>1;if(pages[mid].start<=offset){page=pages[mid].page;low=mid+1;}else high=mid-1;}return page;
}
function block<T extends SourceBlockType>(identity:SourceIdentity,type:T,ordinal:number,location:{page?:number;sectionId?:string;start?:number;end?:number},fields:Record<string,unknown>):SourceBlock{
  return {id:stableId('blk',identity.sha256,ordinal,type,String(fields.text??fields.caption??fields.key??'')),sourceId:identity.id,type,location,...fields} as SourceBlock;
}

/** Deterministic typed parsing. Source content is parsed as data; it is never executed. */
function parseSourceBlocks(identity:SourceIdentity,text:string,pages?:SourceDocument['pages']):SourceBlock[]{
  const lines=text.split('\n'),blocks:SourceBlock[]=[];let offset=0,paragraph:string[]=[],paragraphStart=0,ordinal=0;
  const make=(type:SourceBlockType,start:number,fields:Record<string,unknown>)=>block(identity,type,++ordinal,{...(pageAt(pages,start)!==undefined?{page:pageAt(pages,start)}:{}),start,end:offset},fields);
  const flushParagraph=()=>{if(!paragraph.length)return;const body=paragraph.join('\n').trim();if(body)blocks.push(make('paragraph',paragraphStart,{text:body}));paragraph=[];paragraphStart=offset;};
  for(let i=0;i<lines.length;i++){
    const line=lines[i],lineStart=offset;offset+=line.length+1;
    const fence=line.match(FENCE);
    if(fence){flushParagraph();const language=fence[2]||undefined,code:string[]=[];i++;for(;i<lines.length&&!FENCE.test(lines[i]);i++){code.push(lines[i]);offset+=lines[i].length+1;}blocks.push(make('code',lineStart,{text:code.join('\n'),...(language?{language}:{})}));continue;}
    const heading=line.match(HEADING);
    if(heading){flushParagraph();blocks.push(make('heading',lineStart,{text:heading[2].trim(),level:heading[1].length}));continue;}
    const figure=line.match(FIGURE);
    if(figure){flushParagraph();blocks.push(make('figure',lineStart,{...(figure[1]?{caption:figure[1]}:{}),imageRef:figure[2],nearbyText:[]}));continue;}
    const caption=line.match(CAPTION);
    if(caption){flushParagraph();blocks.push(make('caption',lineStart,{text:caption[1].trim()}));continue;}
    const citation=line.match(CITATION);
    if(citation){flushParagraph();blocks.push(make('citation',lineStart,{text:line.trim(),target:citation[1].trim()}));continue;}
    const list=line.match(LIST);
    if(list){flushParagraph();const ordered=/\d/.test(list[1]),items=[list[2].trim()];while(i+1<lines.length){const next=lines[i+1].match(LIST);if(!next||/\d/.test(next[1])!==ordered)break;i++;offset+=lines[i].length+1;items.push(next[2].trim());}blocks.push(make('list',lineStart,{ordered,items}));continue;}
    if(EQUATION_LINE.test(line)){flushParagraph();const math=[line];if(!/\$\$.*\$\$/.test(line)){while(i+1<lines.length&&!/(\$\$|\\\)|\\\])/.test(lines[i+1])){i++;offset+=lines[i].length+1;math.push(lines[i]);}if(i+1<lines.length){i++;offset+=lines[i].length+1;math.push(lines[i]);}}blocks.push(make('equation',lineStart,{text:math.join('\n')}));continue;}
    if(isTableRow(line)&&i+1<lines.length&&TABLE_SEP.test(lines[i+1])){flushParagraph();const cells=(row:string)=>row.split('|').map(cell=>cell.trim()).filter(Boolean);const columns=cells(line),rows:string[][]=[];i++;offset+=lines[i].length+1;while(i+1<lines.length&&isTableRow(lines[i+1])){i++;offset+=lines[i].length+1;rows.push(cells(lines[i]));}blocks.push(make('table',lineStart,{columns,rows}));continue;}
    if(!line.trim()){flushParagraph();continue;}
    if(!paragraph.length&&looksLikeHeading(line)){flushParagraph();blocks.push(make('heading',lineStart,{text:line.trim(),level:2}));continue;}
    if(!paragraph.length)paragraphStart=lineStart;paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

export function blockText(value:SourceBlock):string{
  switch(value.type){
    case 'heading':case 'paragraph':case 'code':case 'equation':case 'caption':case 'diagram':case 'citation':return value.text;
    case 'list':return value.items.join('\n');
    case 'table':return [value.caption??'',value.columns.join(' | '),...value.rows.map(row=>row.join(' | '))].filter(Boolean).join('\n');
    case 'figure':return [value.caption??'',...(value.nearbyText??[]),value.description??''].filter(Boolean).join('\n');
    case 'metadata':return `${value.key}: ${value.value}`;
  }
}

export function createSourceIR(identity:SourceIdentity,text:string,pages?:SourceDocument['pages'],metadata:Record<string,string>={}):SourceIR{
  const blocks=parseSourceBlocks(identity,text,pages);
  return {version:1,identity,status:text.trim()?'ready':'empty',blocks,metadata,warnings:[]};
}
