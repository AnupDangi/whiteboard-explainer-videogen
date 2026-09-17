import type {LayoutZone,Rect,VisualArchetype} from '../types.js';
import {COLLISION_GAP} from './collisions.js';
export const BOARD={width:1280,height:720,safe:{x:64,y:130,w:1152,h:498},caption:{x:64,y:648,w:1152,h:48}};
export const ZONE_CENTERS:Record<LayoutZone,{x:number;y:number}>={center:{x:640,y:357},upper_left:{x:260,y:235},upper_right:{x:1020,y:235},lower_left:{x:260,y:475},lower_right:{x:1020,y:475},left:{x:260,y:355},right:{x:1020,y:355},top:{x:640,y:180},bottom:{x:640,y:580}};
export function zoneRect(zone:LayoutZone,w:number,h:number):Rect{const c=ZONE_CENTERS[zone];return {x:c.x-w/2,y:c.y-h/2,w,h};}

/** A rect inside a zone for the `nest`-th object to claim it. `nest` 0 is
 *  exactly `zoneRect`, so every scene that never exhausted the primary zones is
 *  byte-identical. Past that, the object shrinks toward a deterministic corner
 *  instead of landing on the same rect as the first claimant — the round-robin
 *  `SUPPORT_ZONES[support++ % 8]` guaranteed an illegal overlap for the ninth
 *  unplaced object, and no repair pass could move the hero or a child to fix it. */
export function zoneRectFor(zone:LayoutZone,w:number,h:number,slot:number,total:number):Rect{
 /** One claimant keeps the whole zone, so a scene that never exhausts the zones
  *  is byte-identical. When a zone IS shared, EVERY claimant is resized into a
  *  grid cell - giving the first the full zone and later ones cells inside it
  *  meant the later ones overlapped the first exactly as the round robin had. */
 if(total<=1)return zoneRect(zone,w,h);
 const columns=Math.ceil(Math.sqrt(total)),rows=Math.ceil(total/columns);
 /** The cells must clear each other by the collision gap, so the grid divides
  *  (zone - gaps), not the zone. Adjacent cells touched and the 8px rule counted
  *  them as overlapping - measured, 17 overlapping pairs for twelve cells. */
 const cellW=Math.max(20,Math.floor((w-COLLISION_GAP*(columns-1))/columns));
 const cellH=Math.max(16,Math.floor((h-COLLISION_GAP*(rows-1))/rows));
 const column=slot%columns,row=Math.floor(slot/columns),base=zoneRect(zone,w,h);
 return {x:base.x+column*(cellW+COLLISION_GAP),y:base.y+row*(cellH+COLLISION_GAP),w:cellW,h:cellH};
}

export function nestedZoneRect(zone:LayoutZone,w:number,h:number,nest:number):Rect{
 const base=zoneRect(zone,w,h);
 if(nest<=0)return base;
 /** Subdivide the zone into a 2x2 grid and give each later claimant its own
  *  cell. The previous version shrank toward a corner, and the corner offsets
  *  cancelled: with `cx=-1`, `(base.w-sw)/2 + (-1)*((base.w-sw)/2)` is 0, so
  *  nest 1 sat on the base origin and overlapped the first claimant exactly as
  *  the round robin had. That was four of the eight remaining layout defects. */
 const column=nest%2,row=Math.floor(nest/2)%2;
 const sw=Math.max(24,Math.round(w/2)),sh=Math.max(20,Math.round(h/2));
 return {x:base.x+column*(base.w-sw),y:base.y+row*(base.h-sh),w:sw,h:sh};
}
/** The archetypes the compiler can actually lay out. `ARCHETYPES` in types.ts
 *  is the declared vocabulary (what the model may name); this is the executable
 *  subset. `simple_explanation` and `chart` are declared there but rejected by
 *  the compiler, so they must never be selectable — failing here is a preflight,
 *  not a 30-second discover-after-the-model-call. `structural_diagram` and
 *  `convergence` are supported through an explicit zone strategy. */
export const SUPPORTED_ARCHETYPES=['flow','cycle','structural_diagram','convergence','transformation','comparison','cross_section','spatial_process','numbered_steps','equation_walkthrough','matrix_operation','hierarchy','timeline','trajectory','branch','cause_effect','state_machine'] as const;
export function supportedArchetype(a:VisualArchetype):boolean{return (SUPPORTED_ARCHETYPES as readonly string[]).includes(a);}
