import type {CompiledObject,Rect} from '../types.js';
/** Conservative board text metrics. Refuse overflow instead of clipping critical text. */
/** Break a token that cannot fit a line on its own. A proper noun such as
 *  "DeepSeek-V4.1-Flash" is a single token with no spaces, so the old wrap threw
 *  `Label token exceeds available width`, fitLabel fell back to truncation, and a
 *  primary object then failed the scene outright. Breaking at hyphens, dots,
 *  slashes and underscores keeps the whole name on the board. Tokens that already
 *  fit are returned untouched, so existing wrapping is unchanged. */
function splitLongToken(word:string,capacity:number):string[]{
 if(word.length<=capacity)return [word];
 const pieces:string[]=[];let rest=word;
 while(rest.length>capacity){
  const zone=rest.slice(0,capacity),brk=Math.max(zone.lastIndexOf('-'),zone.lastIndexOf('.'),zone.lastIndexOf('_'),zone.lastIndexOf('/'),zone.lastIndexOf('\u00b7'));
  const cut=brk>0?brk+1:capacity;
  pieces.push(rest.slice(0,cut));rest=rest.slice(cut);
 }
 if(rest)pieces.push(rest);
 return pieces;
}
export function wrapLabel(text:string,width:number,fontSize=22):string[]{
 const capacity=Math.floor(width/(fontSize*.62)),lines:string[]=[];let line='';
 for(const word of text.split(/\s+/).flatMap(part=>splitLongToken(part,capacity))){if((line?line.length+1:0)+word.length>capacity){lines.push(line);line=word;}else line+=(line?' ':'')+word;}
 if(line)lines.push(line);if(lines.length>3)throw new Error('Label needs more than three lines');return lines;
}

/** Wave 3 fitting fallback: shrink to the 18px lint floor, then truncate to
 *  three lines with an ellipsis instead of failing the whole scene. Never goes
 *  below 18px — `lintCompiledScene` hard-fails smaller text, so a smaller fit
 *  would only trade a compile error for an export error. Callers record a
 *  `representation fallback` diagnostic when fitted or truncated. */
export function fitLabel(text:string,width:number,fontSize=22):{lines:string[];fontSize:number;fitted:boolean;truncated:boolean}{
 for(const size of [fontSize,18]){
  if(size>fontSize)continue;
  try{
   const lines=wrapLabel(text,width,size);
   return {lines,fontSize:size,fitted:size!==fontSize,truncated:false};
  }catch{/* try a smaller size */}
 }
 const capacity=Math.max(4,Math.floor(width/(18*.62))),lines:string[]=[];let line='';
 for(const word of text.split(/\s+/)){
  const token=word.length>capacity?`${word.slice(0,Math.max(1,capacity-1))}…`:word;
  if((line?line.length+1:0)+token.length>capacity){lines.push(line);line=token;}else line+=(line?' ':'')+token;
  if(lines.length===3)break;
 }
 if(line&&lines.length<3)lines.push(line);
 const clipped=lines.slice(0,3);
 if(clipped.length===3&&!clipped[2].endsWith('…'))clipped[2]=`${clipped[2].slice(0,Math.max(0,capacity-1))}…`;
 return {lines:clipped,fontSize:18,fitted:true,truncated:true};
}

export function labelBounds(o:CompiledObject):Rect {
 const only=o.primitiveRef==='label'||o.primitiveRef==='equation';
 const w=Math.max(...o.lines.map(l=>l.length))*o.fontSize*.62;
 const baseline=only?o.y+o.fontSize:o.y+o.h+26;
 return {x:o.x+o.w/2-w/2,y:baseline-o.fontSize,w,h:o.lines.length*(o.fontSize+5)};
}
export function visualBounds(o:CompiledObject):Rect {
 const l=labelBounds(o),x=Math.min(o.x,l.x),y=Math.min(o.y,l.y);
 return {x,y,w:Math.max(o.x+o.w,l.x+l.w)-x,h:Math.max(o.y+o.h,l.y+l.h)-y};
}
