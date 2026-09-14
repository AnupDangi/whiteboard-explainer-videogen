import type {CompiledObject,CompiledRelation,Point,VisualRelation,Rect} from '../types.js';
import {visualBounds} from './text.js';
function crosses(a:Point,b:Point,o:Rect):boolean{
 // Slab intersection avoids missing a narrow obstacle between samples.
 let lo=0,hi=1;for(const axis of ['x','y'] as const){const delta=b[axis]-a[axis],min=o[axis]-5,max=o[axis]+(axis==='x'?o.w:o.h)+5;if(Math.abs(delta)<1e-9){if(a[axis]<min||a[axis]>max)return false;}else{const t0=(min-a[axis])/delta,t1=(max-a[axis])/delta;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));if(lo>hi)return false;}}return true;
}
export function routeRelation(r:VisualRelation,objects:CompiledObject[],options:{direct?:boolean}={}):CompiledRelation{
 const from=objects.find(o=>o.id===r.from.objectId)!,to=objects.find(o=>o.id===r.to.objectId)!;
 const a=from.anchors[r.from.anchor],b=to.anchors[r.to.anchor];if(!a||!b)throw new Error(`Invalid semantic anchor: ${r.id}`);
 const obstacles=objects.filter(o=>o.id!==from.id&&o.id!==to.id&&o.parentId!==from.id&&o.parentId!==to.id);
 const candidates=[[a,b],[a,{x:(a.x+b.x)/2,y:a.y},{x:(a.x+b.x)/2,y:b.y},b],[a,{x:a.x,y:140},{x:b.x,y:140},b],[a,{x:a.x,y:600},{x:b.x,y:600},b]];
 if(r.layoutFeedback)candidates.shift();
 const points=options.direct||r.visualForm==='none'||r.visualForm==='containment'?[a,b]:candidates.find(ps=>ps.slice(1).every((p,i)=>obstacles.every(o=>!crosses(ps[i],p,visualBounds(o)))));
 if(!points)throw new Error(`No safe connector route: ${r.id}`);return {...r,points};
}
