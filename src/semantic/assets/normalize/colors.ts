import type {AssetColorRole} from '../../renderer/palette.js';
import {THEMES} from '../../renderer/palette.js';

const theme=THEMES['chalk-ink-v2'];
/** Theme hexes map back to their own role, so normalising one of our assets is
 *  stable. A handful of universal names are recognised; everything else falls
 *  back by paint kind and is reported, never silently recoloured. */
const NAMED:Record<string,AssetColorRole>={
 '#000':'outline','#000000':'outline','black':'outline',
 '#fff':'white','#ffffff':'white','white':'white',
 [theme.outline.toLowerCase()]:'outline',
 [theme.primary.toLowerCase()]:'primary',
 [theme.primaryShadow.toLowerCase()]:'primaryShadow',
 [theme.secondary.toLowerCase()]:'secondary',
 [theme.accent.toLowerCase()]:'accent',
 [theme.neutral.toLowerCase()]:'neutral',
 [theme.muted.toLowerCase()]:'muted',
};
export interface PaintMapping{role?:AssetColorRole;warning?:string}
/** `undefined` paint keeps the renderer default (stroke outline, no fill). */
export function paintToRole(value:string|undefined,kind:'stroke'|'fill'):PaintMapping{
 if(value===undefined||value==='')return kind==='stroke'?{role:'outline'}:{};
 const normalized=value.trim().toLowerCase();
 if(normalized==='none'||normalized==='transparent')return {};
 const known=NAMED[normalized];
 if(known)return {role:known};
 if(normalized==='currentcolor')return {role:kind==='stroke'?'outline':'primary'};
 const fallback:AssetColorRole=kind==='stroke'?'outline':'primary';
 return {role:fallback,warning:`unmapped ${kind} colour "${value}" became ${fallback}`};
}
