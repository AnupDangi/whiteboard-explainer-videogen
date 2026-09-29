/** Local block union (mirrors the retired src/types SourceBlock union; kept here
 *  because that file is frozen legacy — do not re-add types there). */
export interface ContentSourceLocation { page?: number; sectionId?: string; start?: number; end?: number }
interface SourceBlockBase { id: string; sourceId: string; type: SourceBlockType; location: ContentSourceLocation }
interface HeadingBlock extends SourceBlockBase { type: 'heading'; text: string; level: number }
interface ParagraphBlock extends SourceBlockBase { type: 'paragraph'; text: string }
interface ListBlock extends SourceBlockBase { type: 'list'; ordered: boolean; items: string[] }
interface TableBlock extends SourceBlockBase { type: 'table'; caption?: string; columns: string[]; rows: string[][] }
interface EquationBlock extends SourceBlockBase { type: 'equation'; text: string; latex?: string }
interface FigureBlock extends SourceBlockBase { type: 'figure'; imageRef?: string; caption?: string; nearbyText: string[]; description?: string; semanticTags?: string[] }
interface CaptionBlock extends SourceBlockBase { type: 'caption'; text: string; targetBlockId?: string }
interface CodeBlock extends SourceBlockBase { type: 'code'; text: string; language: string }
interface DiagramBlock extends SourceBlockBase { type: 'diagram'; text: string; diagramKind?: string; imageRef?: string }
interface CitationBlock extends SourceBlockBase { type: 'citation'; text: string; target?: string }
interface MetadataBlock extends SourceBlockBase { type: 'metadata'; key: string; value: string }
export type SourceBlockType = 'heading' | 'paragraph' | 'list' | 'table' | 'equation' | 'figure' | 'caption' | 'code' | 'diagram' | 'citation' | 'metadata';
export type SourceBlock = HeadingBlock | ParagraphBlock | ListBlock | TableBlock | EquationBlock | FigureBlock | CaptionBlock | CodeBlock | DiagramBlock | CitationBlock | MetadataBlock;

/** Bridge our SourceBlock[] into RAG-Anything's `insert_content_list` schema. Pure and
 *  deterministic — this is what makes "one parse only" work: Docling parses, we hand the
 *  already-typed content to the deep index without re-parsing the document. */

type RagContentType='text'|'table'|'equation'|'image';

export interface RagContentItem {
  type:RagContentType;
  page_idx:number;
  text?:string;
  table_body?:string;
  table_caption?:string[];
  latex?:string;
  img_path?:string;
  image_caption?:string[];
}

function pageIndex(block:SourceBlock):number{
  const page=block.location.page;
  return typeof page==='number'&&page>0?page-1:0;
}

function tableToMarkdown(columns:string[],rows:string[][]):string{
  const header=`| ${columns.join(' | ')} |`;
  const sep=`| ${columns.map(()=>'---').join(' | ')} |`;
  const body=rows.map(row=>`| ${row.join(' | ')} |`).join('\n');
  return [header,sep,body].filter(Boolean).join('\n');
}

export function blocksToContentList(blocks:SourceBlock[],{assetDir}:{assetDir?:string}={}):RagContentItem[]{
  const items:RagContentItem[]=[];
  for(const block of blocks){
    const page_idx=pageIndex(block);
    switch(block.type){
      case 'heading':
        items.push({type:'text',page_idx,text:`${'#'.repeat(Math.max(1,Math.min(6,block.level||2)))} ${block.text}`});
        break;
      case 'paragraph':
      case 'caption':
      case 'code':
      case 'citation':
        if(block.text.trim())items.push({type:'text',page_idx,text:block.text});
        break;
      case 'list':
        if(block.items.length)items.push({type:'text',page_idx,text:block.items.map(item=>`- ${item}`).join('\n')});
        break;
      case 'table':
        if(block.columns.length){
          items.push({type:'table',page_idx,table_body:tableToMarkdown(block.columns,block.rows),...(block.caption?{table_caption:[block.caption]}:{})});
        }
        break;
      case 'equation':
        items.push({type:'equation',page_idx,latex:block.latex??block.text,text:block.text});
        break;
      case 'figure':{
        const caption=block.caption??block.description;
        const imageRef=block.imageRef;
        if(imageRef){
          const img_path=assetDir?`${assetDir.replace(/\/$/,'')}/${imageRef}`:imageRef;
          items.push({type:'image',page_idx,img_path,...(caption?{image_caption:[caption]}:{})});
        }else if(caption){
          items.push({type:'text',page_idx,text:caption});
        }
        break;
      }
      case 'diagram':
        items.push({type:'text',page_idx,text:block.text});
        break;
      case 'metadata':
        items.push({type:'text',page_idx,text:`${block.key}: ${block.value}`});
        break;
    }
  }
  return items;
}
