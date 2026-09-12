import type {CompiledObject} from '../types.js';
import {COLORS,escape} from './style.js';
export function renderStep(o:CompiledObject,index:number,draw:number,emphasis=0):string{
 const cy=o.y+o.fontSize*.7;let remaining=Math.ceil(o.lines.join(' ').length*draw);
 const lines=o.lines.map((line,i)=>{const text=line.slice(0,remaining);remaining=Math.max(0,remaining-line.length);return `<text x="${o.x}" y="${o.y+o.fontSize+i*(o.fontSize+5)}" font-family="Arial, sans-serif" font-size="${o.fontSize}" fill="${COLORS.ink}">${escape(text)}</text>`;}).join('');
 return `<rect x="${o.x-8}" y="${o.y-4}" width="${o.w}" height="${o.h}" fill="${COLORS.green}" opacity="${emphasis*.12}"/><circle cx="${o.x-48}" cy="${cy}" r="21" fill="#e7eddf" stroke="${COLORS.green}" stroke-width="2"/><text x="${o.x-48}" y="${cy+7}" text-anchor="middle" font-family="Arial, sans-serif" font-size="21" fill="${COLORS.green}">${index+1}</text>${lines}`;
}
