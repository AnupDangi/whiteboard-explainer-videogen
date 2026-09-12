import {renderSVG} from '../src/v2/renderer/render-svg.js';
import type {CompiledSceneV2} from '../src/v2/types.js';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const seek=el<HTMLInputElement>('seek'),play=el<HTMLButtonElement>('play'),cursor=el<HTMLInputElement>('cursor');let scene:CompiledSceneV2|undefined,playing=false,base=0,started=0;
const clock=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
function draw(){if(!scene)return;const t=Number(seek.value);el('board').innerHTML=renderSVG(scene,t,{cursor:cursor.checked});el('time').textContent=clock(t)+' / '+clock(scene.durationMs);}
function stop(){playing=false;play.textContent='Play';}
function frame(now:number){if(!playing||!scene)return;seek.value=String(Math.min(scene.durationMs,base+now-started));draw();if(Number(seek.value)>=scene.durationMs)stop();else requestAnimationFrame(frame);}
play.onclick=()=>{if(!scene)return;if(playing){stop();return;}base=Number(seek.value)>=scene.durationMs?0:Number(seek.value);started=performance.now();playing=true;play.textContent='Pause';requestAnimationFrame(frame);};
seek.oninput=()=>{stop();draw();};cursor.onchange=draw;
async function load(response:Response){const data=await response.json();if(!response.ok)throw new Error(data.error??'Scene compilation failed');scene=data;stop();seek.max=String(scene!.durationMs);seek.value='0';el('status').textContent=`${scene!.scene.title} · ${scene!.timing.kind} timing · ${scene!.scene.beats.length} beats`;el('details').textContent=JSON.stringify({archetype:scene!.scene.archetype,objects:scene!.objects.length,relations:scene!.relations.map(r=>`${r.from.objectId} → ${r.to.objectId}.${r.to.anchor}`),diagnostics:scene!.diagnostics},null,2);draw();}
el<HTMLInputElement>('file').onchange=async event=>{const f=(event.target as HTMLInputElement).files?.[0];if(!f)return;try{if(f.size>1_000_000)throw new Error('Scene file exceeds 1 MB');await load(await fetch('/api/v2/compile',{method:'POST',headers:{'content-type':'application/json'},body:await f.text()}));}catch(e){el('status').textContent=e instanceof Error?e.message:String(e);}};
el('download').onclick=()=>{if(!scene)return;const url=URL.createObjectURL(new Blob([JSON.stringify(scene,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=scene.scene.id+'.compiled.json';a.click();URL.revokeObjectURL(url);};
fetch('/api/v2/golden').then(load).catch(e=>{el('status').textContent=e.message;});
