/** Model router: central per-task model selection. The pipeline has distinct tasks
 *  (outline, content, director, vision/critic), each with different cost/quality/latency
 *  tradeoffs — routing them independently is the main cost lever. Precedence:
 *    1. MODEL_ROUTER env: JSON object { "outline": "vendor/model", "content": ... }
 *    2. per-task env var (OPENROUTER_OUTLINE_MODEL, OPENROUTER_CONTENT_MODEL, ...)
 *    3. the job's base model (OPENROUTER_MODEL / catalog default)
 *  Nothing here performs network I/O — swap the env/JSON to reroute. `router:report`
 *  aggregates the call ledger into cost/success per task+model to decide changes. */

export type ModelTask='outline'|'content'|'director'|'critic'|'vision'|'embed'|'knowledge'|'graphMap'|'graphReduce'|'teacherPlanner'|'sceneWorker'|'rescue';

/** Current three-model shortlist. Every model supports the structured output
 * contract used by the planner; the first two are the normal fast path and the
 * third is the low-cost long-document fallback. */
export const MODEL_SHORTLIST=[
  'google/gemini-3-flash-preview',
  'qwen/qwen3.5-27b',
  'deepseek/deepseek-v3.2',
] as const;
export const DEFAULT_FAST_MODEL=MODEL_SHORTLIST[0];

export interface ModelRouterConfig {
  outline:string;
  content:string;
  director:string;
  critic:string;
  vision:string;
  embed:string;
}

/** Label → task, so the report can group ledger rows without knowing planner internals. */
export function taskOfLabel(label:string):ModelTask {
  const normal=label.toLowerCase();
  if(normal.startsWith('outline'))return 'outline';
  if(normal.startsWith('director'))return 'director';
  if(normal.startsWith('content'))return 'content';
  if(normal.startsWith('critic'))return 'critic';
  if(normal.startsWith('figure'))return 'vision';
  if(normal.startsWith('graph-map')||normal.startsWith('graphmap'))return 'graphMap';
  if(normal.startsWith('graph-reduce')||normal.startsWith('graphreduce'))return 'graphReduce';
  if(normal.startsWith('teacher'))return 'teacherPlanner';
  if(normal.startsWith('scene'))return 'sceneWorker';
  if(normal.startsWith('knowledge'))return 'knowledge';
  if(normal.startsWith('rescue'))return 'rescue';
  return 'content';
}

/** Target-state routing for the `semantic-v3` front end (`Architecture_plan.md`
 *  §54). These model IDs come from the architecture document; they are defaults
 *  only, overridable by `MODEL_ROUTER` JSON or the `OPENROUTER_*_MODEL` vars.
 *  A route that does not resolve must fail visibly — never silently fall back to
 *  a fixture. The current shortlist stays the operational fallback chain. */
export const PLAN_MODEL_DEFAULTS={
  vision:'google/gemini-3.8-flash',
  graphMap:'openai/gpt-5.6-luna',
  graphReduce:'openai/gpt-5.6-luna',
  teacherPlanner:'openai/gpt-5.6-luna',
  sceneWorker:'openai/gpt-5.6-luna',
  rescue:'anthropic/claude-sonnet-5',
} as const;
export const PLAN_MODEL_FALLBACKS=['google/gemini-3.8-flash','anthropic/claude-haiku-4.5','qwen/qwen3.5-27b'] as const;

export interface V3ModelRouterConfig {
  graphMap:string;
  graphReduce:string;
  teacherPlanner:string;
  sceneWorker:string;
  vision:string;
  rescue:string;
  fallbacks:string[];
}

/** Resolve the semantic-v3 routes. Precedence: MODEL_ROUTER JSON → per-task env
 *  → the architecture document's default. */
export function loadV3ModelRouter(env:NodeJS.ProcessEnv):V3ModelRouterConfig {
  let json:Partial<Record<ModelTask,string>>={};
  if(env.MODEL_ROUTER){
    try{const parsed=JSON.parse(env.MODEL_ROUTER);if(parsed&&typeof parsed==='object')json=parsed;}catch{/* ignore malformed config, fall through */}
  }
  const pick=(task:ModelTask,envValue:string|undefined)=>json[task]||envValue||PLAN_MODEL_DEFAULTS[task as keyof typeof PLAN_MODEL_DEFAULTS];
  const configured=(env.OPENROUTER_V3_FALLBACKS??'').split(',').map(v=>v.trim()).filter(Boolean);
  return {
    graphMap:pick('graphMap',env.OPENROUTER_GRAPH_MAP_MODEL),
    graphReduce:pick('graphReduce',env.OPENROUTER_GRAPH_REDUCE_MODEL),
    teacherPlanner:pick('teacherPlanner',env.OPENROUTER_TEACHER_PLANNER_MODEL),
    sceneWorker:pick('sceneWorker',env.OPENROUTER_SCENE_WORKER_MODEL),
    vision:pick('vision',env.OPENROUTER_VISION_MODEL),
    rescue:pick('rescue',env.OPENROUTER_RESCUE_MODEL),
    fallbacks:[...new Set(configured.length?configured:[...PLAN_MODEL_FALLBACKS])],
  };
}

export function loadModelRouter(env:NodeJS.ProcessEnv,base:string):ModelRouterConfig {
  let json:Partial<Record<ModelTask,string>>={};
  if(env.MODEL_ROUTER){
    try{const parsed=JSON.parse(env.MODEL_ROUTER);if(parsed&&typeof parsed==='object')json=parsed;}catch{/* ignore malformed config, fall through */}
  }
  const pick=(task:ModelTask,envValue:string|undefined)=>json[task]||envValue||base;
  return {
    outline:pick('outline',env.OPENROUTER_OUTLINE_MODEL),
    content:pick('content',env.OPENROUTER_CONTENT_MODEL),
    director:pick('director',env.OPENROUTER_DIRECTOR_MODEL),
    critic:pick('critic',env.OPENROUTER_CRITIC_MODEL),
    vision:pick('vision',env.OPENROUTER_VISION_MODEL),
    embed:pick('embed',env.EMBEDDINGS_MODEL),
  };
}

/** Parse an operator-supplied ordered fallback list without allowing blank or
 * malformed entries into provider requests. This is intentionally additive:
 * existing per-stage model variables remain the source of truth until an
 * operator opts into fallback routing. */
export function loadModelFallbacks(env:NodeJS.ProcessEnv):string[] {
  const raw=(env.OPENROUTER_MODEL_FALLBACKS??'').trim();
  if(raw==='none'||raw==='-'||raw==='0')return [];
  const configured=raw.split(',').map(v=>v.trim()).filter(Boolean);
  return [...new Set(configured.length?configured:MODEL_SHORTLIST)];
}
