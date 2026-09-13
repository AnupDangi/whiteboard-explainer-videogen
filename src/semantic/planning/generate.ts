import {planTeaching,type TeachingInput} from './teaching-planner.js';
import {selectVisualModel} from './visual-model.js';
import {directVisual} from './visual-director.js';
import {finalizeNarration} from './narration.js';
import {compileScene} from '../compiler/compile-scene.js';
import {criticRepair} from '../critic-repair.js';
import type {JsonModel} from './model-adapter.js';
import type {CompiledSceneV2,VisualTiming} from '../types.js';
import type {VisionJudge} from '../vision-judge.js';
export interface StageMetrics {teachingMs:number;visualModelMs:number;directorMs:number;narrationFinalizeMs:number;ttsMs:number;compileMs:number;sceneReadyMs:number;criticMs?:number;criticRepairs?:number}
export interface GenerateOptions {speech?:(text:string)=>Promise<{timing:VisualTiming;audio:Buffer;format?:'wav'|'mp3'}>;signal?:AbortSignal;judge?:VisionJudge;criticEnv?:NodeJS.ProcessEnv}
export async function* generateV2(input:TeachingInput,model:JsonModel,options:GenerateOptions={}){
 const start=performance.now(),teachingStart=performance.now(),plan=await planTeaching(input,model),teachingMs=performance.now()-teachingStart;let previous:CompiledSceneV2|undefined;
 const criticEnabled=(options.criticEnv??process.env).V2_CRITIC==='on'&&Boolean(options.judge);
 for(const semantic of plan.scenes){options.signal?.throwIfAborted();let at=performance.now();const mentalModel=selectVisualModel(semantic,plan.conceptRegistry,{keepFromPrevious:[],prepareForNext:previous?.scene.objects.map(o=>o.conceptId).filter((id):id is string=>Boolean(id))??[]},input.allowedArchetypes),visualModelMs=performance.now()-at;
  at=performance.now();const directed=await directVisual(semantic,plan.conceptRegistry,mentalModel,model,previous,input.language),directorMs=performance.now()-at;
  at=performance.now();const narration=finalizeNarration(semantic,directed.scene),narrationFinalizeMs=performance.now()-at;
  options.signal?.throwIfAborted();at=performance.now();const speech=options.speech?await options.speech(narration.text):undefined,ttsMs=performance.now()-at;
  options.signal?.throwIfAborted();at=performance.now();let compiled=compileScene(directed.scene,speech?.timing,previous),compileMs=performance.now()-at;
  let criticMs:number|undefined,criticRepairs:number|undefined;
  if(criticEnabled){at=performance.now();const outcome=await criticRepair(compiled,{judge:options.judge!,model,registry:plan.conceptRegistry,semantic,mentalModel,previous});compiled=outcome.scene;criticMs=performance.now()-at;criticRepairs=outcome.repaired?1:0;}
  previous=compiled;
  yield {plan,semantic,mentalModel,directed,narration,compiled,speech,metrics:{teachingMs,visualModelMs,directorMs,narrationFinalizeMs,ttsMs,compileMs,sceneReadyMs:performance.now()-start,criticMs,criticRepairs} satisfies StageMetrics};
 }
}
