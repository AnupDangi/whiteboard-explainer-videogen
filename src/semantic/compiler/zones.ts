import type {LayoutZone,Rect,VisualArchetype} from '../types.js';
export const BOARD={width:1280,height:720,safe:{x:64,y:130,w:1152,h:498},caption:{x:64,y:648,w:1152,h:48}};
export const ZONE_CENTERS:Record<LayoutZone,{x:number;y:number}>={center:{x:640,y:357},upper_left:{x:260,y:235},upper_right:{x:1020,y:235},lower_left:{x:260,y:475},lower_right:{x:1020,y:475},left:{x:260,y:355},right:{x:1020,y:355},top:{x:640,y:180},bottom:{x:640,y:580}};
export function zoneRect(zone:LayoutZone,w:number,h:number):Rect{const c=ZONE_CENTERS[zone];return {x:c.x-w/2,y:c.y-h/2,w,h};}
export function supportedArchetype(a:VisualArchetype):boolean{return ['flow','cycle','structural_diagram','convergence','transformation','comparison','cross_section','spatial_process','numbered_steps','equation_walkthrough','matrix_operation','hierarchy','timeline','trajectory'].includes(a);}
