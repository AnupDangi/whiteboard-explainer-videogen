/** LD7: budget manager. The blended per-call constants become five separate functions so
 *  each budget scales with its own input and NOTHING else: source size never raises an
 *  output budget; duration never raises a retrieval budget; model context is a hard
 *  clamp, not a strategy. All values match the live-proven defaults at the 1-min tier. */

export type BudgetTask='outline'|'content'|'director'|'critic'|'figure'|'embed'|'catalog'|'model';

/** Hard per-duration planner budget (USD), the ceiling a job for that target may
 *  reserve/spend. These are deliberately well above measured spend so a run
 *  completes under them rather than bumping the cap; they exist to bound a
 *  runaway job, not to be hit. 30 min measured ~$0.30, 10 min ~$0.11, 1 min ~$0.02. */
export const DURATION_BUDGET_USD:Record<number,number>={1:0.5,5:0.7,10:1,30:1.2,60:2};
export const MAX_JOB_BUDGET_USD=Math.max(...Object.values(DURATION_BUDGET_USD));

/** Budget for a requested target length. Unknown lengths fall back to the largest
 *  tier at or below the request (so 20 → 10's cap, not 30's), never unbounded. */
export function budgetForMinutes(minutes:number):number {
  const exact=DURATION_BUDGET_USD[minutes];
  if(exact!==undefined)return exact;
  const tiers=Object.keys(DURATION_BUDGET_USD).map(Number).sort((a,b)=>a-b);
  const atOrBelow=[...tiers].reverse().find(t=>t<=minutes);
  return DURATION_BUDGET_USD[atOrBelow??tiers[0]];
}

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

/** Hard cost envelope (reservation math unchanged; the cap is the duration table's max). */
export function getCostBudget(maxCostUsd:number):number {
  if(!Number.isFinite(maxCostUsd)||maxCostUsd<=0||maxCostUsd>MAX_JOB_BUDGET_USD)throw new Error(`Planner budget must be above $0 and at most $${MAX_JOB_BUDGET_USD}`);
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
