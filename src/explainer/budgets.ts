/** LD7: budget manager. The blended per-call constants become five separate functions so
 *  each budget scales with its own input and NOTHING else: source size never raises an
 *  output budget; duration never raises a retrieval budget; model context is a hard
 *  clamp, not a strategy. All values match the live-proven defaults at the 1-min tier. */

export type BudgetTask='outline'|'content'|'director'|'critic'|'figure'|'embed'|'catalog'|'model';

/** Output tokens are constrained by the requested artifact (chapters/scenes), never by
 *  how big the source is. Outline output grows with chapter count (capped); per-chapter
 *  content/director output is constant because every chapter is a bounded one-minute slice. */
export function getOutputBudget(task:BudgetTask,chapters=1):number {
  switch(task){
    case 'outline':return Math.min(9000,2600+chapters*400);
    case 'content':return 9000;
    case 'director':return 5000;
    case 'critic':return 800;
    case 'figure':return 600;
    default:return 2000;
  }
}

/** Evidence budget per chapter scales ONLY with document size — a bigger source earns
 *  slightly more retrieval room, but never unboundedly (prompt cost/attention sanity). */
export function getRetrievalBudget(docChars:number):number {
  if(docChars>1_000_000)return 16000;
  if(docChars>200_000)return 12000;
  return 8000;
}

/** Input context cap per call. The outline sees the most (clipped raw text or the LD5
 *  map, which is far smaller); content calls see the evidence set + figure digest. */
export function getInputBudget(task:BudgetTask,docChars:number):number {
  if(task==='outline')return Math.min(120000,docChars);
  if(task==='content')return 16000;
  return 4000;
}

/** Hard cost envelope (unchanged semantics from the live-proven reservation math). */
export function getCostBudget(maxCostUsd:number):number {
  if(!Number.isFinite(maxCostUsd)||maxCostUsd<=0||maxCostUsd>10)throw new Error('Planner budget must be above $0 and at most $10');
  return maxCostUsd;
}

/** Per-stage timeout ceilings (ms). One table instead of magic numbers per call site. */
export function getLatencyBudget(task:BudgetTask):number {
  switch(task){
    case 'catalog':return 20000;
    case 'critic':return 60000;
    case 'figure':return 60000;
    case 'embed':return 120000;
    default:return 150000; // model calls: heavy multi-chapter load can exceed 90s per call
  }
}
