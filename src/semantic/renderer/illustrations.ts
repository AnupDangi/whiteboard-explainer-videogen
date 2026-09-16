import type {CompiledObject,ObjectState} from '../types.js';
import {resolveAsset} from '../assets/registry.js';
import type {AssetDefinition} from '../assets/types.js';
import {length,path,pointAt} from '../assets/geometry.js';
import {COLORS,clamp} from './style.js';
import {resolveAssetColor,themePalette,type ThemePalette} from './palette.js';
export function renderIllustration(o:CompiledObject,draw:number,emphasis:number,state:ObjectState='neutral',palette:ThemePalette=themePalette(),catalog?:Record<string,AssetDefinition>):{svg:string;cursor?:{x:number;y:number;angle:number}}{
 const asset=resolveAsset(o.assetRef!,catalog),[vx,vy,vw,vh]=asset.viewBox,parts=[...asset.parts].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
  // State variants: before/after reuse highlighted/activated part sets; before shows the
  // "before" variant dimmed, after shows the "after" variant fully (Task 6.5).
  const stateKey=state==='before'||state==='after'?state:state==='activated'?'activated':'highlighted';
  const explicit=asset.states[state==='neutral'?'highlighted':stateKey]?.partIds;const selected=new Set(explicit?.length?explicit:parts.map(p=>p.id));
  const weights=parts.map(p=>length(p.points)*p.durationWeight),total=weights.reduce((a,b)=>a+b,0);let used=0,svg='',cursor;
  const dim=state==='before'?.55:1;
  for(const [i,p] of parts.entries()){
   const fraction=clamp((draw*total-used)/weights[i]);used+=weights[i];if(fraction<=0)continue;
   const points=p.points.map(v=>({x:o.x+(v.x-vx)/vw*o.w,y:o.y+(v.y-vy)/vh*o.h})),d=path(points,p.closed),l=length(points)+(p.closed?Math.hypot(points[0].x-points.at(-1)!.x,points[0].y-points.at(-1)!.y):0);
   const localEmphasis=selected.has(p.id)?emphasis:0;
   /** A role-resolved colour yields the same hex as the equivalent token, so
    *  curated assets keep their exact markup. Fill stays the translucent wash
    *  unless the part asks for none or solid. */
   const stroke=resolveAssetColor(p.stroke,p.strokeRole,palette);
   const fill=resolveAssetColor(p.fill,p.fillRole,palette);
   const fillReady=Boolean(fill)&&(!p.fillAfter||fraction>=1);
   const wash=(.13+localEmphasis*.12)*dim;
   const fillOpacity=!fillReady?0:(p.fillMode==='none'?0:p.fillMode==='solid'?(p.fillOpacity??1):(p.fillOpacity??wash));
   svg+=`<path d="${d}" fill="${fill??'none'}" fill-opacity="${fillOpacity}" stroke="${stroke??COLORS.ink}" stroke-opacity="${dim.toFixed(3)}" stroke-width="${(o.role==='hero'?3.2:2.8)+localEmphasis*.7}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${l.toFixed(3)}" stroke-dashoffset="${(l*(1-fraction)).toFixed(3)}"/>`;
   if(fraction>0&&fraction<1)cursor=pointAt(points,l*fraction);
  }
  return {svg,cursor};
}
