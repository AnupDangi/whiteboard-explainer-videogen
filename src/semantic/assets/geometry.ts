import type {Point} from '../types.js';
import type {AssetPart} from './types.js';
export const point=(x:number,y:number):Point=>({x,y});
export function curve(a:Point,b:Point,c:Point,d:Point,steps=24):Point[]{return Array.from({length:steps+1},(_,i)=>{const t=i/steps,u=1-t;return {x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y};});}
export function ellipse(cx:number,cy:number,rx:number,ry:number,steps=48):Point[]{return Array.from({length:steps+1},(_,i)=>({x:cx+Math.cos(i/steps*Math.PI*2)*rx,y:cy+Math.sin(i/steps*Math.PI*2)*ry}));}
export function part(id:string,points:Point[],order:number,stroke:AssetPart['stroke']='ink',fill?:AssetPart['fill'],semanticRole=id):AssetPart{return {id,points,order,stroke,fill,closed:Boolean(fill),durationWeight:1,fillAfter:true,semanticRole};}
export function length(points:Point[]):number{return points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);}
export function pointAt(points:Point[],distance:number):Point & {angle:number}{let left=Math.max(0,distance);for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],l=Math.hypot(b.x-a.x,b.y-a.y);if(left<=l||i===points.length-1){const t=l?Math.min(1,left/l):0;return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI};}left-=l;}return {...points[0],angle:0};}
export function path(points:Point[],closed=false):string{return points.map((p,i)=>`${i?'L':'M'}${Number(p.x.toFixed(3))} ${Number(p.y.toFixed(3))}`).join(' ')+(closed?' Z':'');}
