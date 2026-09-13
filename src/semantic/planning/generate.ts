import {planTeaching,type TeachingInput} from './teaching-planner.js';
import {selectVisualModel} from './visual-model.js';
import {directVisual} from './visual-director.js';
import {finalizeNarration} from './narration.js';
import {compileScene} from '../compiler/compile-scene.js';
import type {JsonModel} from './model-adapter.js';
import type {CompiledSceneV2,VisualTiming} from '../types.js';
export interface StageMetrics {teachingMs:number;visualModelMs:number;directorMs:number;narrationFinalizeMs:number;ttsMs:number;compileMs:number;sceneReadyMs:number}
export async function* generateV2(input:TeachingInput,model:JsonModel,options:{speech?:(text:string)=>Promise<{timing:VisualTiming;audio:Buffer;format?:'wav'|'mp3'}>;signal?:AbortSignal}={}){
 const start=performance.now(),teachingStart=performance.now(),plan=await planTeaching(input,model),teachingMs=performance.now()-teachingStart;let previous:CompiledSceneV2|undefined;
 for(const semantic of plan.scenes){options.signal?.throwIfAborted();let at=performance.now();const mentalModel=selectVisualModel(semantic,plan.conceptRegistry,{keepFromPrevious:[],prepareForNext:previous?.scene.objects.map(o=>o.conceptId).filter((id):id is string=>Boolean(id))??[]},input.allowedArchetypes),visualModelMs=performance.now()-at;
  at=performance.now();const directed=await directVisual(semantic,plan.conceptRegistry,mentalModel,model,previous),directorMs=performance.now()-at;
  at=performance.now();const narration=finalizeNarration(semantic,directed.scene),narrationFinalizeMs=performance.now()-at;
  options.signal?.throwIfAborted();at=performance.now();const speech=options.speech?await options.speech(narration.text):undefined,ttsMs=performance.now()-at;
  options.signal?.throwIfAborted();at=performance.now();const compiled=compileScene(directed.scene,speech?.timing,previous),compileMs=performance.now()-at;previous=compiled;
  yield {plan,semantic,mentalModel,directed,narration,compiled,speech,metrics:{teachingMs,visualModelMs,directorMs,narrationFinalizeMs,ttsMs,compileMs,sceneReadyMs:performance.now()-start} satisfies StageMetrics};
 }
}
