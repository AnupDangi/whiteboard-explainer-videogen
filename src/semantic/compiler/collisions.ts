import type {CompiledObject,Rect} from '../types.js';
import {visualBounds,labelBounds} from './text.js';
export const overlaps=(a:Rect,b:Rect,gap=0)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
/** Clearance every pair of visible bounds must keep. Layouts that stack rows must
 *  clear a row's label block PLUS this, or the collision check rejects the very
 *  geometry the layout just produced. */
export const COLLISION_GAP=8;
export const contains=(a:Rect,b:Rect)=>b.x>=a.x&&b.y>=a.y&&b.x+b.w<=a.x+a.w&&b.y+b.h<=a.y+a.h;
export function illegalOverlap(a:CompiledObject,b:CompiledObject):boolean{
 const child=a.parentId===b.id?a:b.parentId===a.id?b:undefined,parent=child===a?b:a;
 if(child){if(child.collisionPolicy==='contain')return !contains(parent,child);if(child.collisionPolicy==='overlay'||child.collisionPolicy==='allow')return false;if(child.collisionPolicy==='touch'){const contact=Math.min(Math.abs(child.x-parent.x-parent.w),Math.abs(child.x+child.w-parent.x),Math.abs(child.y-parent.y-parent.h),Math.abs(child.y+child.h-parent.y));return overlaps(child,parent)||contact>1;}}
 if(overlaps(labelBounds(a),labelBounds(b),COLLISION_GAP))return true;
 if(a.collisionPolicy==='allow'||b.collisionPolicy==='allow')return false;
 return overlaps(visualBounds(a),visualBounds(b),COLLISION_GAP);
}
export function findCollisions(objects:CompiledObject[]):string[]{const result:string[]=[];for(let i=0;i<objects.length;i++)for(let j=i+1;j<objects.length;j++)if(illegalOverlap(objects[i],objects[j]))result.push(`${objects[i].id}/${objects[j].id}`);return result;}
