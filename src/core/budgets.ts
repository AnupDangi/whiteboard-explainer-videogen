/** Output/context/latency budgets for paid model calls. Each budget scales with its own
 *  input and NOTHING else: output grows with the requested artifact, retrieval with
 *  document size, and per-stage latency has one table instead of magic numbers per call
 *  site. Duration→cost ceilings live in the runtime budget ledger, not here. */

type BudgetTask='outline'|'content'|'director'|'critic'|'figure'|'embed'|'catalog'|'model';

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
