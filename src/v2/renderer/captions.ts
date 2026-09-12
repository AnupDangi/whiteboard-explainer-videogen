import type {VisualTiming} from '../types.js';
import {escape,COLORS} from './style.js';
export function renderCaptions(timing:VisualTiming,time:number):string{
 const current=timing.words.findIndex(w=>time>=w.startMs&&time<w.endMs);if(current<0)return '';
 const start=Math.floor(current/12)*12,text=timing.words.slice(start,start+12).map(w=>w.word).join(' ');
 return `<text x="640" y="685" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="${COLORS.ink}">${escape(text)}</text>`;
}
