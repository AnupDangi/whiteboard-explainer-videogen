import type {CompiledObject,CompiledSceneV2} from './types.js';
import {judgeCalibration,type CalibrationPair,type PairwiseJudgment} from './evaluation.js';
import type {CriticContext,CriticImage,VisionJudge} from './vision-judge.js';
export interface Corruption{name:string;expected:string;apply(scene:CompiledSceneV2):void}
/** Controlled degradations from a known-good scene (v4_docs/Tests.md §15). Never pixel-equality based. */
export function knownCorruptions():Corruption[]{
 const object=(scene:CompiledSceneV2,id:string)=>{const found=scene.objects.find(o=>o.id===id);if(!found)throw new Error(`Corruption target missing: ${id}`);return found;};
 return [
  {name:'water_arrow_to_leaf',expected:'water should reach roots, not leaves',apply:s=>{const relation=s.relations.find(r=>r.id==='water_to_roots');if(!relation)throw new Error('Missing water_to_roots');relation.to.anchor='leaf.top';relation.points=[relation.points[0],object(s,'plant').anchors['leaf.top']];}},
  {name:'remove_sunlight',expected:'sunlight is required',apply:s=>{s.objects=s.objects.filter(o=>o.id!=='sunlight');s.relations=s.relations.filter(r=>r.from.objectId!=='sunlight'&&r.to.objectId!=='sunlight');s.actions=s.actions.filter(a=>![...a.objectIds,...a.relationIds].includes('sunlight'));}},
  {name:'swap_co2_label',expected:'carbon dioxide is mislabeled as oxygen',apply:s=>{const co2=object(s,'carbon_dioxide');co2.label='Oxygen (O2)';co2.lines=['Oxygen (O2)'];}},
  {name:'clip_roots',expected:'the plant roots are clipped off the board',apply:s=>{object(s,'plant').y=560;}},
  {name:'delay_reveal',expected:'a critical reveal arrives late',apply:s=>{for(const action of s.actions)if(action.type==='draw')action.startMs=Math.min(action.startMs+2000,s.durationMs-1);}},
  {name:'shrink_hero',expected:'the hero is no longer salient',apply:s=>{const plant=object(s,'plant');plant.w*=.25;plant.h*=.25;}},
  {name:'generic_box',expected:'the plant became a generic rectangle',apply:s=>{const plant=object(s,'plant');delete plant.assetRef;plant.primitiveRef='rectangle';plant.label='Plant';}}, 
  {name:'reverse_relation',expected:'the water relation direction is reversed',apply:s=>{const relation=s.relations.find(r=>r.id==='water_to_roots');if(!relation)throw new Error('Missing water_to_roots');const from={...relation.from};relation.from={...relation.to};relation.to=from;relation.points=[...relation.points].reverse();}},
  {name:'add_decoration',expected:'irrelevant decoration distracts from the mechanism',apply:s=>{const decoration:CompiledObject={id:'decoration_1',label:'Fun fact!',role:'decorative_support',children:[],state:'neutral',allowedStates:['neutral'],importance:'tertiary',collisionPolicy:'forbid',primitiveRef:'rectangle',x:64,y:540,w:300,h:80,anchors:{center:{x:214,y:580},input:{x:64,y:580},output:{x:364,y:580},top:{x:214,y:540},bottom:{x:214,y:620}},fontSize:20,lines:['Fun fact!'],zIndex:5};s.objects.push(decoration);s.actions.push({id:'draw_decoration_1',type:'draw',objectIds:['decoration_1'],relationIds:[],durationMs:1000,leadMs:0,easing:'linear',beatId:s.scene.beats[0].id,startMs:0,anchorMs:0,signedLagMs:0});}},
 ];
}
export interface CriticCalibrationReport{reliable:boolean;misses:string[];inconsistent:string[];accuracy:number;corruptions:string[]}
export interface CriticCalibrationResult{report:CriticCalibrationReport;pairs:CalibrationPair[]}
/** Runs every known corruption in both orders so position bias is measured, not assumed away. */
export async function runCriticCalibration(options:{baseline:CompiledSceneV2;judge:VisionJudge;context:CriticContext;render:(scene:CompiledSceneV2,label:string)=>Promise<CriticImage>}):Promise<CriticCalibrationResult>{
 const pairs:CalibrationPair[]=[];let hits=0;
 for(const corruption of knownCorruptions()){
  const corrupted=structuredClone(options.baseline);corruption.apply(corrupted);
  const [original,bad]=await Promise.all([options.render(options.baseline,`${corruption.name}/original`),options.render(corrupted,`${corruption.name}/corrupted`)]);
  const forward=await options.judge.judge(original,bad,options.context),reverse=await options.judge.judge(bad,original,options.context);
  if(forward.preferred==='A')hits++;if(reverse.preferred==='B')hits++;
  pairs.push({corruption:corruption.name,forward,reverse});
 }
 const base=judgeCalibration(pairs);
 return {report:{...base,accuracy:pairs.length?hits/(pairs.length*2):0,corruptions:pairs.map(p=>p.corruption)},pairs};
}
export type {PairwiseJudgment};
