/** Model router: central per-task model selection. The pipeline has distinct tasks
 *  (outline, content, director, vision/critic), each with different cost/quality/latency
 *  tradeoffs — routing them independently is the main cost lever. Precedence:
 *    1. MODEL_ROUTER env: JSON object { "outline": "vendor/model", "content": ... }
 *    2. per-task env var (OPENROUTER_OUTLINE_MODEL, OPENROUTER_CONTENT_MODEL, ...)
 *    3. the job's base model (OPENROUTER_MODEL / catalog default)
 *  Nothing here performs network I/O — swap the env/JSON to reroute. `router:report`
 *  aggregates the call ledger into cost/success per task+model to decide changes. */

export type ModelTask='outline'|'content'|'director'|'critic'|'vision'|'embed';

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
  if(label.startsWith('outline'))return 'outline';
  if(label.startsWith('director'))return 'director';
  if(label.startsWith('content'))return 'content';
  if(label.startsWith('critic'))return 'critic';
  if(label.startsWith('figure'))return 'vision';
  return 'content';
}

export function loadModelRouter(env:NodeJS.ProcessEnv,base:string):ModelRouterConfig {
  let json:Partial<ModelRouterConfig>={};
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
  const configured=(env.OPENROUTER_MODEL_FALLBACKS||'').split(',').map(v=>v.trim()).filter(Boolean);
  return [...new Set(configured.length?configured:MODEL_SHORTLIST)];
}
