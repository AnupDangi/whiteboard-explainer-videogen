import type {CompiledObject,Rect} from '../types.js';
/** Conservative board text metrics. Refuse overflow instead of clipping critical text. */
export function wrapLabel(text:string,width:number,fontSize=22):string[]{
 const capacity=Math.floor(width/(fontSize*.62)),lines:string[]=[];let line='';
 for(const word of text.split(/\s+/)){if(word.length>capacity)throw new Error(`Label token exceeds available width: ${word}`);if((line?line.length+1:0)+word.length>capacity){lines.push(line);line=word;}else line+=(line?' ':'')+word;}
 if(line)lines.push(line);if(lines.length>3)throw new Error('Label needs more than three lines');return lines;
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
