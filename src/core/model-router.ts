/** Model router: central per-task model selection. The pipeline has distinct tasks
 *  (outline, content, director, vision/critic), each with different cost/quality/latency
 *  tradeoffs. `router:report` aggregates the call ledger into cost/success per task+model
 *  to decide changes. Nothing here performs network I/O. */

type ModelTask='outline'|'content'|'director'|'critic'|'vision'|'embed';

/** Provider-diverse defaults. Explicit environment/model-router settings remain authoritative. */
export const DEFAULT_TEXT_MODEL='qwen/qwen3.8-flash';
export const DEFAULT_VISION_MODEL='deepseek/deepseek-v4-flash-vision-exp';

/** Label → task, so the report can group ledger rows without knowing planner internals. */
export function taskOfLabel(label:string):ModelTask {
  if(label.startsWith('outline'))return 'outline';
  if(label.startsWith('director'))return 'director';
  if(label.startsWith('content'))return 'content';
  if(label.startsWith('critic'))return 'critic';
  if(label.startsWith('figure'))return 'vision';
  return 'content';
}
