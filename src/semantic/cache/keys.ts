import {createHash} from 'node:crypto';

/** Cache versions and keys (`Architecture_plan.md` §14, §42-43, §50-51).
 *  Any artifact whose inputs changed must bump the matching version so a stale
 *  entry can never be reused. Keys are plain strings; the store hashes them.
 *
 *  Tiers:
 *    source  = SourceDocument + chunks + index + BaseConceptGraph + EvidenceIndex
 *    lesson  = FocusedConceptGraph + LessonGraph + LessonBible + SceneContracts
 *    scene   = evidence + SceneIntent + narration + audio + CompiledScene
 *    render  = scene frames/segments + final export
 */
export const CACHE_VERSIONS={
  parser:'parser-v1',
  chunker:'chunker-v1',
  retrieval:'retrieval-v1',
  graphCompiler:'graph-compiler-v1',
  knowledge:'knowledge-v1',
  teacherPlanner:'teacher-planner-v1',
  sceneWorker:'scene-worker-v1',
  render:'render-v1',
} as const;

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');

export function sourceCacheKey(sourceHash:string, versions:Partial<typeof CACHE_VERSIONS>=CACHE_VERSIONS):string{
  const v={...CACHE_VERSIONS,...versions};
  return digest(['source',sourceHash,v.parser,v.chunker,v.retrieval,v.graphCompiler,v.knowledge].join('\u0000'));
}

export function lessonCacheKey(input:{baseGraphHash:string;userPromptHash:string;targetDurationSec:number;audienceHash:string;language:string}, versions:Partial<typeof CACHE_VERSIONS>=CACHE_VERSIONS):string{
  const v={...CACHE_VERSIONS,...versions};
  return digest(['lesson',input.baseGraphHash,input.userPromptHash,String(input.targetDurationSec),input.audienceHash,input.language,v.teacherPlanner].join('\u0000'));
}

export function sceneCacheKey(input:{lessonGraphHash:string;sceneContractHash:string}, versions:Partial<typeof CACHE_VERSIONS>=CACHE_VERSIONS):string{
  const v={...CACHE_VERSIONS,...versions};
  return digest(['scene',input.lessonGraphHash,input.sceneContractHash,v.sceneWorker,v.retrieval].join('\u0000'));
}

export function renderCacheKey(input:{compiledSceneHash:string;profile:string}, versions:Partial<typeof CACHE_VERSIONS>=CACHE_VERSIONS):string{
  const v={...CACHE_VERSIONS,...versions};
  return digest(['render',input.compiledSceneHash,input.profile,v.render].join('\u0000'));
}
