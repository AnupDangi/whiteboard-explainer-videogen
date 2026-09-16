import type {AssetDefinition} from './types.js';
import {length} from './geometry.js';
import {THEMES} from '../renderer/palette.js';
const ASSET_COLOR_ROLES=Object.keys(THEMES['chalk-ink-v2']);
const FILL_MODES=['none','wash','solid'];
/** Registry code owns assets. External/generated SVG is deliberately unsupported. */
export function validateAsset(a:AssetDefinition):AssetDefinition {
 if(!/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/.test(a.id))throw new Error('Invalid asset ID');
 if(!a.styleFamily||!a.license||!a.source||!a.tags.length)throw new Error('Asset metadata required');
 const [x,y,w,h]=a.viewBox;if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0||w>10000||h>10000)throw new Error('Invalid viewBox');
 const inside=(p:{x:number;y:number})=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=x&&p.x<=x+w&&p.y>=y&&p.y<=y+h;
 if(!a.parts.length||a.parts.length>100||new Set(a.parts.map(p=>p.id)).size!==a.parts.length)throw new Error('Invalid asset parts');
 let total=0;for(const p of a.parts){total+=p.points.length;if(p.points.length<2||p.points.length>1000||!p.points.every(inside)||length(p.points)<=0||!Number.isFinite(p.order)||p.durationWeight<=0||!Number.isFinite(p.durationWeight))throw new Error(`Invalid asset part: ${p.id}`);
  /** Colour is addressed by a legacy token or a theme role, never both and
   *  never neither: the renderer has to be able to resolve every part. */
  if(Boolean(p.stroke)===Boolean(p.strokeRole))throw new Error(`Asset part ${p.id} must declare exactly one of stroke or strokeRole`);
  if(p.strokeRole&&!ASSET_COLOR_ROLES.includes(p.strokeRole))throw new Error(`Unknown stroke role: ${p.strokeRole}`);
  if(p.fillRole&&!ASSET_COLOR_ROLES.includes(p.fillRole))throw new Error(`Unknown fill role: ${p.fillRole}`);
  if(p.fillMode&&!FILL_MODES.includes(p.fillMode))throw new Error(`Unknown fill mode: ${p.fillMode}`);
  if(p.fillOpacity!==undefined&&(!Number.isFinite(p.fillOpacity)||p.fillOpacity<0||p.fillOpacity>1))throw new Error(`Invalid fill opacity on ${p.id}`);
 }
 if(total>10000)throw new Error('Asset complexity exceeded');
 if(!Object.keys(a.anchors).length||!Object.values(a.anchors).every(inside))throw new Error('Invalid semantic anchors');
 for(const [alias,target] of Object.entries(a.anchorAliases??{}))if(!/^[a-z][a-z0-9_.-]*$/.test(alias)||!Object.hasOwn(a.anchors,target))throw new Error('Invalid semantic anchor alias');
 for(const state of Object.values(a.states))for(const id of state.partIds)if(!a.parts.some(p=>p.id===id))throw new Error('Unknown state part');
 return a;
}
