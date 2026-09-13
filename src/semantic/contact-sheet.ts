import type {CompiledSceneV2} from './types.js';
import {renderSVG} from './renderer/render-svg.js';
import type {CriticImage} from './vision-judge.js';

/** Event-aligned contact sheet for the vision critic (v4_docs/Tasks.md §12.2):
 *  initial, after each beat's last action, and final. Rendered through the exact
 *  pure browser renderer; rasterization is the caller's optional concern. */
export function contactSheetTimes(scene:CompiledSceneV2):number[] {
  const times=[0];
  for(const beat of scene.scene.beats){
    const ends=scene.actions.filter(a=>a.beatId===beat.id).map(a=>a.startMs+a.durationMs);
    times.push(ends.length?Math.max(...ends):times[times.length-1]);
  }
  times.push(scene.durationMs);
  return times.map((t,i)=>Math.max(t,times[i-1]??0));
}

export interface SheetRenderer {png:(scene:CompiledSceneV2,label:string)=>Promise<CriticImage>}

/** Default renderer: pure SVG frames tiled into one labeled sheet image. */
export function createSheetRenderer():SheetRenderer & {lastSvg:(scene:CompiledSceneV2)=>string}{
  const last={svg:''};
  return {lastSvg:(scene)=>last.svg,async png(scene,label){
    const times=contactSheetTimes(scene),COLS=2,CELL_W=320,CELL_H=180;
    const frames=times.map(time=>renderSVG(scene,time,{cursor:true,captions:false}))
      .map(svg=>svg.slice(svg.indexOf('>')+1,svg.lastIndexOf('</svg>')));
    const sheet=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">${frames.map((inner,i)=>{
      const stamp=(label?label+' · ':'')+`t=${Math.round(times[i])}ms`;
      return `<g transform="translate(${i%COLS*CELL_W},${Math.floor(i/COLS)*CELL_H}) scale(0.25)">${inner}</g><text x="${i%COLS*CELL_W+6}" y="${Math.floor(i/COLS)*CELL_H+14}" font-size="10" font-family="Arial" fill="#333">${stamp}</text>`;
    }).join('')}</svg>`;
    last.svg=sheet;
    return {label,pngBase64:Buffer.from(sheet).toString('base64')};
  }};
}
