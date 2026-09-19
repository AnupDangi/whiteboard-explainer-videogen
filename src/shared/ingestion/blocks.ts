import type {SourceBlock,SourceDocument} from '../types.js';

/** Typed source blocks (`Architecture_plan.md` §5). The point is to stop
 *  flattening a source into one string: a figure is not prose, a table is not a
 *  paragraph, an equation is not a sentence. Blocks are deterministic and carry
 *  enough structure for semantic chunking. Images are references only — this
 *  module never reads or generates them. */

export type BlockType='heading'|'text'|'figure'|'table'|'equation'|'code';

/** Approximate token count for chunk sizing. Deterministic, dependency-free:
 *  ~4 characters per token is accurate enough for a 700-1500 token target and
 *  never depends on a provider tokenizer. */
export function estimateTokens(text:string):number{return Math.ceil(text.replace(/\s+/g,' ').trim().length/4);}

let blockCounter=0;
function block<T extends BlockType>(type:T,fields:Record<string,unknown>={}):SourceBlock{
  blockCounter++;
  return {id:`b${blockCounter}`,type,...fields} as unknown as SourceBlock;
}
/** Reset for deterministic ids within a parse (tests and repeated parses). */
export function resetBlockIds(){blockCounter=0;}

const HEADING=/^(#{1,6})\s+(.+)$/;
const FENCE=/^\s*(```|~~~)\s*([a-zA-Z0-9+#-]*)\s*$/;
const FIGURE=/^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const TABLE_SEP=/^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const EQUATION_LINE=/^\s*(\$\$|\\\[|\\\()/;

function isTableRow(line:string):boolean{
  const trimmed=line.trim();
  return trimmed.includes('|')&&trimmed.split('|').filter(part=>part.trim().length).length>=2;
}

/** Conservative PDF/heading heuristic: a short line with no terminal
 *  punctuation that is either ALL CAPS or Title Case, preceded by a blank
 *  line, reads as a heading. Deliberately under-eager — a false heading breaks
 *  section routing, a missed one only costs structure. */
function looksLikeHeading(line:string):boolean{
  const trimmed=line.trim();
  if(trimmed.length<3||trimmed.length>80)return false;
  if(/[.!?,;:]$/.test(trimmed))return false;
  const words=trimmed.split(/\s+/);
  if(words.length>12)return false;
  const letters=trimmed.replace(/[^A-Za-z]/g,'');
  if(letters.length<3)return false;
  if(letters===letters.toUpperCase())return true;
  const titleCase=words.filter(w=>/^[A-Z]/.test(w)).length>=Math.ceil(words.length*0.6);
  return titleCase&&words.length<=8;
}

/** Parse plain text (or text extracted from any source) into typed blocks.
 *  `pages` maps char offsets to page numbers so a block can carry its page. */
export function parseBlocks(text:string,pages?:SourceDocument['pages']):SourceBlock[]{
  resetBlockIds();
  const pageAt=(offset:number):number|undefined=>{
    if(!pages||!pages.length)return undefined;
    let lo=0,hi=pages.length-1,page=pages[0].page;
    while(lo<=hi){const mid=(lo+hi)>>1;if(pages[mid].start<=offset){page=pages[mid].page;lo=mid+1;}else hi=mid-1;}
    return page;
  };
  const lines=text.split('\n');
  const blocks:SourceBlock[]=[];
  let offset=0,paragraph:string[]=[],paragraphStart=0;
  const flushText=()=>{
    if(!paragraph.length)return;
    const body=paragraph.join('\n').trim();
    if(body)blocks.push(block('text',{text:body,...(pageAt(paragraphStart)!==undefined?{page:pageAt(paragraphStart)}:{})}));
    paragraph=[];paragraphStart=offset;
  };
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const lineStart=offset;
    offset+=line.length+1;
    const fence=line.match(FENCE);
    if(fence){
      flushText();
      const marker=fence[1],language=fence[2]||undefined;const code:string[]=[];i++;
      for(;i<lines.length&&!lines[i].match(FENCE);i++){code.push(lines[i]);offset+=lines[i].length+1;}
      blocks.push(block('code',{text:code.join('\n'),...(language?{language}:{}),...(pageAt(lineStart)!==undefined?{page:pageAt(lineStart)}:{})}));
      continue;
    }
    const heading=line.match(HEADING);
    if(heading){flushText();blocks.push(block('heading',{text:heading[2].trim(),level:heading[1].length,...(pageAt(lineStart)!==undefined?{page:pageAt(lineStart)}:{})}));continue;}
    const figure=line.match(FIGURE);
    if(figure){flushText();blocks.push(block('figure',{caption:figure[1]||undefined,imageRef:figure[2],nearbyText:[],...(pageAt(lineStart)!==undefined?{page:pageAt(lineStart)}:{})}));continue;}
    if(EQUATION_LINE.test(line)){flushText();const math:string[]=[line];// single-line $$...$$ or \[...\]
      if(!/\$\$.*\$\$/.test(line)&&!/\\?[()\]]/.test(line.slice(2))){/* keep collecting until closing */for(i++;i<lines.length&&!/(\$\$|\\\)|\\\])/.test(lines[i]);i++){math.push(lines[i]);offset+=lines[i].length+1;}if(i<lines.length)math.push(lines[i]);}
      blocks.push(block('equation',{text:math.join('\n'),...(pageAt(lineStart)!==undefined?{page:pageAt(lineStart)}:{})}));continue;}
    if(isTableRow(line)&&i+1<lines.length&&TABLE_SEP.test(lines[i+1])){
      flushText();
      const rows:string[][]=[line.split('|').map(cell=>cell.trim()).filter((cell,index,all)=>!(index===0&&cell==='')&&!(index===all.length-1&&cell===''))];
      i+=2;offset+=lines[i-1].length+1;
      for(;i<lines.length&&isTableRow(lines[i]);i++){rows.push(lines[i].split('|').map(cell=>cell.trim()).filter((cell,index,all)=>!(index===0&&cell==='')&&!(index===all.length-1&&cell==='')));offset+=lines[i].length+1;}
      i--;
      blocks.push(block('table',{columns:rows[0]??[],rows:rows.slice(1),...(pageAt(lineStart)!==undefined?{page:pageAt(lineStart)}:{})}));
      continue;
    }
    if(!line.trim()){
      flushText();continue;
    }
    if(!paragraph.length&&looksLikeHeading(line)){flushText();blocks.push(block('heading',{text:line.trim(),level:2,...(pageAt(lineStart)!==undefined?{page:pageAt(lineStart)}:{})}));continue;}
    if(!paragraph.length)paragraphStart=lineStart;
    paragraph.push(line);
  }
  flushText();
  return blocks;
}

export function blockText(block:SourceBlock):string{
  switch(block.type){
    case 'heading':return block.text;
    case 'text':return block.text;
    case 'code':return block.text;
    case 'equation':return block.text;
    case 'table':return [block.caption??'',block.columns.join(' | '),...block.rows.map(row=>row.join(' | '))].filter(Boolean).join('\n');
    case 'figure':return [block.caption??'',...(block.nearbyText??[])].filter(Boolean).join('\n');
  }
}
