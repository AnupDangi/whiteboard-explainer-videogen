import type {CompiledSceneV2,CompiledVisualAction,ObjectState} from '../types.js';
import {clamp} from './style.js';
export function progress(a:CompiledVisualAction,time:number):number{const p=clamp((time-a.startMs)/a.durationMs);return a.easing==='ease_in_out'?p*p*(3-2*p):p;}
export function objectState(scene:CompiledSceneV2,id:string,time:number):{visible:boolean;draw:number;opacity:number;emphasis:number;state:ObjectState;activeDraw?:CompiledVisualAction}{
 const object=scene.objects.find(o=>o.id===id)!;let visible=scene.scene.continuity.keepFromPrevious.includes(id),draw=visible?1:0,opacity=1,emphasis=(object.state==='highlighted'||object.state==='activated')?1:0,state=object.state;let activeDraw:CompiledVisualAction|undefined;
 for(const a of scene.actions.filter(a=>a.objectIds.includes(id)&&a.startMs<=time)){
  const p=progress(a,time);
  if(a.type==='draw'||a.type==='reveal'){visible=true;draw=a.type==='draw'?p:1;if(a.type==='draw'&&p<1)activeDraw=a;}
  if(a.type==='fade')opacity=1-p;
  if(a.type==='highlight'){emphasis=p;state='highlighted';}
  if(a.type==='pulse')emphasis=p<1?Math.sin(p*Math.PI):0;
  if(a.type==='fill'){state='activated';emphasis=p;}
  if(a.toState&&p>=1)state=a.toState;
 }
 if(state==='hidden')visible=false;
 return {visible,draw,opacity,emphasis,state,activeDraw};
}
