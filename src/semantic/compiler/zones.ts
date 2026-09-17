import type {LayoutZone,Rect,VisualArchetype} from '../types.js';
export const BOARD={width:1280,height:720,safe:{x:64,y:130,w:1152,h:498},caption:{x:64,y:648,w:1152,h:48}};
export const ZONE_CENTERS:Record<LayoutZone,{x:number;y:number}>={center:{x:640,y:357},upper_left:{x:260,y:235},upper_right:{x:1020,y:235},lower_left:{x:260,y:475},lower_right:{x:1020,y:475},left:{x:260,y:355},right:{x:1020,y:355},top:{x:640,y:180},bottom:{x:640,y:580}};
export function zoneRect(zone:LayoutZone,w:number,h:number):Rect{const c=ZONE_CENTERS[zone];return {x:c.x-w/2,y:c.y-h/2,w,h};}

/** A rect inside a zone for the `nest`-th object to claim it. `nest` 0 is
 *  exactly `zoneRect`, so every scene that never exhausted the primary zones is
 *  byte-identical. Past that, the object shrinks toward a deterministic corner
 *  instead of landing on the same rect as the first claimant — the round-robin
 *  `SUPPORT_ZONES[support++ % 8]` guaranteed an illegal overlap for the ninth
 *  unplaced object, and no repair pass could move the hero or a child to fix it. */
export function nestedZoneRect(zone:LayoutZone,w:number,h:number,nest:number):Rect{
 const base=zoneRect(zone,w,h);
 if(nest<=0)return base;
 const scale=Math.max(.4,1-nest*.15),sw=Math.max(24,w*scale),sh=Math.max(20,h*scale);
 const cx=[-1,1,-1,1][nest%4],cy=[-1,-1,1,1][nest%4];
 return {x:base.x+(base.w-sw)/2+cx*((base.w-sw)/2),y:base.y+(base.h-sh)/2+cy*((base.h-sh)/2),w:sw,h:sh};
}
/** The archetypes the compiler can actually lay out. `ARCHETYPES` in types.ts
 *  is the declared vocabulary (what the model may name); this is the executable
 *  subset. `simple_explanation` and `chart` are declared there but rejected by
 *  the compiler, so they must never be selectable — failing here is a preflight,
 *  not a 30-second discover-after-the-model-call. `structural_diagram` and
 *  `convergence` are supported through an explicit zone strategy. */
export const SUPPORTED_ARCHETYPES=['flow','cycle','structural_diagram','convergence','transformation','comparison','cross_section','spatial_process','numbered_steps','equation_walkthrough','matrix_operation','hierarchy','timeline','trajectory','branch','cause_effect','state_machine'] as const;
export function supportedArchetype(a:VisualArchetype):boolean{return (SUPPORTED_ARCHETYPES as readonly string[]).includes(a);}
