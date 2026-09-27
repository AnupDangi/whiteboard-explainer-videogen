import {EXPERIMENT} from './contracts.js';

export interface Box {x:number;y:number;w:number;h:number}
export const clamp=(value:number,min=0,max=1):number=>Math.max(min,Math.min(max,value));
export const escapeXml=(value:string):string=>value.replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]!));
export const progress=(timeMs:number,startMs:number,endMs:number):number=>clamp((timeMs-startMs)/Math.max(1,endMs-startMs));

export function svgDocument(body:string):string{
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${EXPERIMENT.width}" height="${EXPERIMENT.height}" viewBox="0 0 ${EXPERIMENT.width} ${EXPERIMENT.height}"><rect width="100%" height="100%" fill="#FDFDFB"/>${body}</svg>`;
}
