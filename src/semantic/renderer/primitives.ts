import {path,length} from '../assets/geometry.js';
import type {CompiledObject} from '../types.js';
import {labelBounds} from '../compiler/text.js';
import {COLORS,escape} from './style.js';
export function renderLabel(o:CompiledObject,emphasis=0,draw=1):string{const labelOnly=o.primitiveRef==='label'||o.primitiveRef==='equation';const y=labelOnly?o.y+o.fontSize:o.y+o.h+26,b=labelBounds(o);let remaining=Math.ceil(o.lines.join(' ').length*draw);
 const wash=emphasis>0?`<rect x="${b.x-6}" y="${b.y-3}" width="${b.w+12}" height="${b.h+6}" rx="4" fill="${COLORS.green}" opacity="${emphasis*.15}"/>`:'';
 return wash+o.lines.map((line,i)=>{const text=line.slice(0,remaining);remaining=Math.max(0,remaining-line.length);return `<text x="${o.x+o.w/2}" y="${y+i*(o.fontSize+5)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${o.fontSize}" fill="${COLORS.ink}">${escape(text)}</text>`;}).join('');}

export function renderEquation(o:CompiledObject,draw=1,emphasis=0):string{
 const text=o.lines.join(' ');if(draw<=0||!text)return '';
 // Multi-line derivation: each line is one transformation step; the active line is
 // emphasized so learners see exactly which step is being spoken about.
 const lineCount=o.lines.length,lineProgress=draw*lineCount,activeIndex=Math.min(lineCount-1,Math.floor(lineProgress));
 const panelOpacity=Math.min(1,draw*1.5),panel=`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="8" fill="#ffffff" stroke="${COLORS.green}" stroke-opacity="${(.35+emphasis*.5).toFixed(3)}" stroke-width="${(1.6+emphasis*1.4).toFixed(2)}" opacity="${panelOpacity.toFixed(3)}"/>`;
 const lineHeight=o.lines.length>1?o.fontSize+8:0,firstBaseline=o.lines.length>1?o.y+o.fontSize+14:o.y+o.h/2+o.fontSize*.35;
 const body=o.lines.map((line,i)=>{
  const isActive=lineCount>1&&i===activeIndex,completed=lineCount>1&&i<activeIndex;
  const visible=i<activeIndex?line:i===activeIndex?line.slice(0,Math.ceil(line.length*(lineProgress-activeIndex))):'';
  if(!visible)return '';
  const opacity=completed?.75:1;
  const wash=isActive?`<rect x="${o.x+8}" y="${firstBaseline+(i*lineHeight)-o.fontSize-4}" width="${o.w-16}" height="${o.fontSize+10}" rx="4" fill="${COLORS.green}" opacity="${(.12+emphasis*.12).toFixed(3)}"/>`:'';
  return wash+`<text x="${o.x+o.w/2}" y="${firstBaseline+i*lineHeight}" text-anchor="middle" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="${o.fontSize}" fill="${COLORS.ink}" opacity="${opacity}">${escape(visible)}</text>`;
 }).join('');
 return panel+body;
}

export function renderPrimitive(o:CompiledObject,draw=1):string{
 let points:{x:number;y:number}[]=[];
 if(o.primitiveRef==='rectangle')points=[{x:o.x,y:o.y},{x:o.x+o.w,y:o.y},{x:o.x+o.w,y:o.y+o.h},{x:o.x,y:o.y+o.h},{x:o.x,y:o.y}];
 if(o.primitiveRef==='circle')points=Array.from({length:97},(_,i)=>({x:o.x+o.w/2+o.w/2*Math.cos(i*Math.PI/48),y:o.y+o.h/2+o.h/2*Math.sin(i*Math.PI/48)}));
 if(!points.length)return '';const total=length(points);
 return `<path d="${path(points)}" fill="none" stroke="${COLORS.ink}" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="${total}" stroke-dashoffset="${total*(1-draw)}"/>`;
}
