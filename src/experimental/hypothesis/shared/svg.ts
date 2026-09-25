import {EXPERIMENT} from './contracts.js';

export interface Box {x:number;y:number;w:number;h:number}
export const clamp=(value:number,min=0,max=1):number=>Math.max(min,Math.min(max,value));
export const escapeXml=(value:string):string=>value.replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]!));
export const progress=(timeMs:number,startMs:number,endMs:number):number=>clamp((timeMs-startMs)/Math.max(1,endMs-startMs));

export function svgDocument(body:string):string{
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${EXPERIMENT.width}" height="${EXPERIMENT.height}" viewBox="0 0 ${EXPERIMENT.width} ${EXPERIMENT.height}"><rect width="100%" height="100%" fill="#FDFDFB"/>${body}</svg>`;
}

export function roundedBox(id:string,box:Box,label:string,fill:string,opacity=1):string{
  return `<g id="${escapeXml(id)}" opacity="${clamp(opacity)}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="24" fill="${fill}" stroke="#1A1A1A" stroke-width="4"/><text x="${box.x+box.w/2}" y="${box.y+box.h/2+12}" text-anchor="middle" font-family="Kalam, sans-serif" font-size="36" font-weight="700" fill="#1A1A1A">${escapeXml(label)}</text></g>`;
}

export function arrow(id:string,from:{x:number;y:number},to:{x:number;y:number},opacity=1,label?:string):string{
  const angle=Math.atan2(to.y-from.y,to.x-from.x),size=16;
  const a={x:to.x-Math.cos(angle-.55)*size,y:to.y-Math.sin(angle-.55)*size};
  const b={x:to.x-Math.cos(angle+.55)*size,y:to.y-Math.sin(angle+.55)*size};
  const text=label?`<text x="${(from.x+to.x)/2}" y="${(from.y+to.y)/2-14}" text-anchor="middle" font-family="Kalam, sans-serif" font-size="28" fill="#1A1A1A">${escapeXml(label)}</text>`:'';
  return `<g id="${escapeXml(id)}" opacity="${clamp(opacity)}"><path d="M ${from.x} ${from.y} L ${to.x} ${to.y}" fill="none" stroke="#1A1A1A" stroke-width="4" stroke-linecap="round"/><path d="M ${a.x} ${a.y} L ${to.x} ${to.y} L ${b.x} ${b.y}" fill="none" stroke="#1A1A1A" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${text}</g>`;
}

export function textLabel(id:string,x:number,y:number,text:string,size=40,opacity=1):string{
  return `<text id="${escapeXml(id)}" x="${x}" y="${y}" font-family="Kalam, sans-serif" font-size="${size}" font-weight="700" fill="#1A1A1A" opacity="${clamp(opacity)}">${escapeXml(text)}</text>`;
}
