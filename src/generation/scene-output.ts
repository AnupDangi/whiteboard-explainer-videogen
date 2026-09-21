import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {renderSVG} from './engine.js';
import type {CompiledScene} from '../types/engine.js';

interface SceneArtifactMeta { title?:string; manifestVersion?:string; timingMode?:string; captionMode?:'off'|'sidecar'|'burn-in' }
interface SceneArtifactResult { dir:string; files:string[] }

/** Harness §§45/57/64 (contact sheets, observability, snapshot tests): every committed
 *  scene persisted scene-by-scene at export time — final-frame SVG per scene plus a
 *  manifest. Bytes deterministic: same compiled scenes always produce identical files,
 *  since renderSVG(scene, timeMs) is pure. */
export async function writeSceneArtifacts(scenes:CompiledScene[],meta:SceneArtifactMeta,outDir:string):Promise<SceneArtifactResult> {
  await mkdir(outDir,{recursive:true});
  const files:string[]=[];
  for(let i=0;i<scenes.length;i++){
    const scene=scenes[i];
    const safeId=scene.id.replace(/[^a-zA-Z0-9_-]/g,'_');
    const name=`scene-${String(i+1).padStart(2,'0')}-${safeId}.svg`;
    // Legacy callers that do not specify a caption mode retain the old artifact
    // bytes; canonical jobs always pass an explicit mode (defaulting to off).
    await writeFile(join(outDir,name),renderSVG(scene,scene.durationMs,{captions:meta.captionMode===undefined||meta.captionMode==='burn-in'}));
    files.push(name);
  }
  const manifest={title:meta.title??'',manifestVersion:meta.manifestVersion??'',timingMode:meta.timingMode??'',captionMode:meta.captionMode??'off',sceneCount:scenes.length,
    scenes:scenes.map((s,i)=>({index:i+1,id:s.id,title:s.title,durationMs:s.durationMs,nodes:s.nodes.length,edges:s.edges.length,timingKind:s.timing.kind,audio:typeof s.audioUrl==='string'?s.audioUrl:null}))};
  await writeFile(join(outDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  files.push('manifest.json');
  return {dir:outDir,files};
}
