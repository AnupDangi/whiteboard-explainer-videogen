import {createHash} from 'node:crypto';
import type {AssetDefinition,AssetPart} from '../types.js';
import type {VisualArchetype,Point} from '../../types.js';
import {validateAsset} from '../validator.js';
import {sanitizeSvg} from '../normalize/sanitize.js';
import {parsePath} from '../normalize/path.js';
import {flattenSegments,primitiveToSubPath,type SubPath} from '../normalize/geometry.js';
import {parseTransform,multiply,applyMatrix,IDENTITY,type Matrix} from '../normalize/transform.js';
import {paintToRole} from '../normalize/colors.js';

export const NORMALIZER_VERSION='normalize-v1';
const GEOMETRY_TAGS=new Set(['path','rect','circle','ellipse','line','polyline','polygon']);

export type ConversionType='stroke_native'|'filled_native'|'filled_to_outline'|'mixed';
export interface ConversionMetadata{conversionType:ConversionType;confidence:number;warnings:string[]}
export interface AssetProvenance{provider:string;collection:string;sourceAssetId:string;licenseId:string;licenseUrl?:string;sourceUrl?:string;fetchedAt:string;sourceHash:string;normalizerVersion:string}
export interface ConvertInput {
 id:string;svg:string;
 aliases?:string[];tags?:string[];semanticTypes?:string[];archetypes?:VisualArchetype[];
 styleFamily?:string;license?:string;source?:string;
 provenance?:Partial<AssetProvenance>;
 curveSegments?:number;
}
export interface ConvertResult{asset:AssetDefinition;conversion:ConversionMetadata;provenance:AssetProvenance;warnings:string[]}

const ATTR=/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const TAG=/<\s*(\/?)\s*([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

function attributes(raw:string):Record<string,string>{
 const out:Record<string,string>={};
 for(const match of raw.matchAll(ATTR))out[match[1].toLowerCase()]=(match[2]??match[3]??'').trim();
 return out;
}

/** Convert sanitized SVG into an AssetDefinition.
 *
 *  Deterministic and clock-free: provenance timestamps are supplied by the
 *  caller, never read here, so the same input always produces the same asset.
 *  Geometry is flattened to polylines — the only shape the renderer consumes —
 *  and every transform is applied eagerly rather than left in the markup. */
export function convertSvgToAsset(input:ConvertInput):ConvertResult{
 const warnings:string[]=[];
 const {svg}=sanitizeSvg(input.svg);
 const curveSegments=input.curveSegments??8;
 if(!Number.isInteger(curveSegments)||curveSegments<2||curveSegments>64)throw new Error('curveSegments must be 2-64');

 const parts:AssetPart[]=[];let strokeParts=0,fillParts=0;
 const stack:Matrix[]=[IDENTITY];
 let rootViewBox:[number,number,number,number]|undefined;

 for(const match of svg.matchAll(TAG)){
  const closing=match[1]==='/',tag=match[2].toLowerCase(),selfClosing=match[4]==='/';
  const attrs=attributes(match[3]);
  if(closing){if(tag==='g'){if(stack.length>1)stack.pop();}continue;}
  const parent=stack[stack.length-1];
  const local=attrs.transform?multiply(parent,parseTransform(attrs.transform)):parent;
  if(tag==='g'){if(!selfClosing)stack.push(local);continue;}
  if(tag==='svg'){
   const raw=attrs.viewbox;
   if(raw){const n=[...raw.matchAll(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g)].map(m=>Number(m[0]));if(n.length!==4||![...n].every(Number.isFinite)||n[2]<=0||n[3]<=0)throw new Error('Invalid viewBox');rootViewBox=[n[0],n[1],n[2],n[3]];}
   else{const w=Number(attrs.width),h=Number(attrs.height);if(Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0)rootViewBox=[0,0,w,h];}
   continue;
  }
  if(!GEOMETRY_TAGS.has(tag))continue;

  const subpaths:SubPath[]=tag==='path'
   ? flattenSegments(parsePath(attrs.d??''),curveSegments)
   : [primitiveToSubPath(tag,attrs,Math.max(curveSegments,16))].filter((s):s is SubPath=>Boolean(s));
  if(!subpaths.length){warnings.push(`skipped <${tag}>: no usable geometry`);continue;}

  const stroke=paintToRole(attrs.stroke,'stroke');
  const fill=paintToRole(attrs.fill===undefined?attrs.style?.match(/fill\s*:\s*([^;]+)/)?.[1]:attrs.fill,'fill');
  if(stroke.warning)warnings.push(stroke.warning);
  if(fill.warning)warnings.push(fill.warning);
  if(stroke.role)strokeParts++;
  if(fill.role)fillParts++;
  const hasFill=Boolean(fill.role),hasStroke=Boolean(stroke.role);

  for(const [index,sub] of subpaths.entries()){
   const points:Point[]=sub.points.map(point=>applyMatrix(local,point));
   parts.push({
    id:`p${parts.length}`,
    points,
    closed:sub.closed,
    ...(hasStroke?{strokeRole:stroke.role}:{strokeRole:'outline'}),
    ...(hasFill?{fillRole:fill.role}:{}),
    fillMode:hasFill?(attrs['fill-opacity']!==undefined?Number(attrs['fill-opacity'])<0.6?'wash':'solid':'wash'):'none',
    order:parts.length,
    durationWeight:1,
    fillAfter:false,
    semanticRole:index===0?'body':'part',
   });
  }
 }
 if(!parts.length)throw new Error('Converter: no drawable geometry found');

 const viewBox=rootViewBox??boundingViewBox(parts);
 const anchors=bboxAnchors(viewBox);
 const conversionType:ConversionType=strokeParts&&fillParts?'mixed':fillParts?'filled_native':'stroke_native';
 const conversion:ConversionMetadata={conversionType,confidence:conversionType==='mixed'?0.6:0.85,warnings:[...warnings]};

 const sourceHash=createHash('sha256').update(svg).digest('hex');
 const provenance:AssetProvenance={provider:input.provenance?.provider??'local',collection:input.provenance?.collection??'local',sourceAssetId:input.provenance?.sourceAssetId??input.id,licenseId:input.provenance?.licenseId??input.license??'unknown',...(input.provenance?.licenseUrl?{licenseUrl:input.provenance.licenseUrl}:{}),...(input.provenance?.sourceUrl?{sourceUrl:input.provenance.sourceUrl}:{}),fetchedAt:input.provenance?.fetchedAt??'1970-01-01T00:00:00.000Z',sourceHash,normalizerVersion:NORMALIZER_VERSION};

 const asset:AssetDefinition={
  id:input.id,
  type:'icon',
  semanticTypes:input.semanticTypes??['entity'],
  aliases:input.aliases??[],
  tags:input.tags?.length?input.tags:[input.id],
  archetypes:input.archetypes??[],
  viewBox,
  parts,
  anchors,
  states:{highlighted:{partIds:parts.map(p=>p.id)},activated:{partIds:parts.map(p=>p.id)}},
  styleFamily:input.styleFamily??'chalk-ink-v2',
  source:input.source??provenance.sourceUrl??'generated',
  license:input.license??provenance.licenseId,
 };
 return {asset:validateAsset(asset),conversion,provenance,warnings};
}

function boundingViewBox(parts:AssetPart[]):[number,number,number,number]{
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const part of parts)for(const point of part.points){
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new Error('Converter: non-finite geometry');
  minX=Math.min(minX,point.x);minY=Math.min(minY,point.y);maxX=Math.max(maxX,point.x);maxY=Math.max(maxY,point.y);
 }
 if(!(maxX>minX)||!(maxY>minY))throw new Error('Converter: degenerate geometry');
 return [minX,minY,maxX-minX,maxY-minY];
}
/** Geometric anchors only: external assets are not semantic. The renderer's
 *  five standard ports resolve to the bounding box. */
function bboxAnchors([x,y,w,h]:[number,number,number,number]):Record<string,Point>{
 return {center:{x:x+w/2,y:y+h/2},input:{x,y:y+h/2},output:{x:x+w,y:y+h/2},top:{x:x+w/2,y},bottom:{x:x+w/2,y:y+h}};
}
