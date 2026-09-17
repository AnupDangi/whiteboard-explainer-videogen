import type {HarnessStage,StagePolicy} from './contracts.js';
import {DEFAULT_STAGE_POLICIES} from './stage.js';

/** A job-relative latency budget.
 *
 *  The stage policies carry absolute ceilings far above what a short video can
 *  justify — knowledge 600s and visual-director 360s for a one-minute lesson.
 *  A budget narrows each stage to a share of the time the job actually has, so
 *  no single stage can consume minutes the lesson cannot afford, and a stage
 *  that cannot start inside the remaining time fails explicitly instead of
 *  quietly overrunning.
 *
 *  Shedding: when the remaining time is thin, repairs are dropped first, since a
 *  second model call is the most expensive optional work in the pipeline. */
export interface StageBudgetOptions{
 /** Total wall-clock allowance for model work in this job. */
 totalMs:number;
 /** Injection point for tests; defaults to `performance.now`. */
 now?:()=>number;
 /** Floor for any single stage, so a tiny remainder cannot starve a stage. */
 minimumMs?:number;
}

/** Share of the remaining budget a stage may claim. The heavy model stages sum
 *  to more than one because they run at different times and each is capped by
 *  what is left, not by the total. */
const SHARE:Record<HarnessStage,number>={
 ingest:0.05,
 'knowledge-compiler':0.40,
 'teaching-architect':0.25,
 'whiteboard-planner':0.05,
 'representation-guide':0.05,
 'source-visual-grounding':0.05,
 'visual-director':0.35,
 compiler:0.05,
 'tts-alignment':0.30,
 'pedagogy-critic':0.10,
 render:0.05,
};

/** Minimum useful window per stage. Deterministic stages finish in
 *  milliseconds, so only the model stages need a meaningful floor. */
const STAGE_FLOOR_MS:Partial<Record<HarnessStage,number>>={'knowledge-compiler':30000,'teaching-architect':25000,'visual-director':30000,'pedagogy-critic':20000,'tts-alignment':20000};

export class StageBudget{
 private readonly startedAt:number;
 private readonly totalMs:number;
 private readonly minimumMs:number;
 private readonly now:()=>number;
 constructor(options:StageBudgetOptions){
  if(!Number.isFinite(options.totalMs)||options.totalMs<=0)throw new Error('Stage budget must be greater than zero');
  this.totalMs=options.totalMs;this.now=options.now??(()=>performance.now());this.minimumMs=options.minimumMs??8000;this.startedAt=this.now();
 }
 usedMs():number{return this.now()-this.startedAt;}
 remainingMs():number{return Math.max(0,this.totalMs-this.usedMs());}
 expired():boolean{return this.remainingMs()<=0;}
 /** Narrow a stage policy to the remaining budget. An explicit policy passed by
  *  the caller still wins; this only supplies the default. */
 policyFor(stage:HarnessStage,base:StagePolicy=DEFAULT_STAGE_POLICIES[stage]):StagePolicy{
  const remaining=this.remainingMs();
  if(remaining<=0)throw new Error(`${stage} cannot start: the job latency budget is exhausted`);
  /** A model stage needs a real window: truncating it to a few seconds
   *  guarantees failure, which is worse than overrunning a soft budget. The
   *  share is therefore bounded from below by a per-stage floor. Measured: a
   *  repair was cut off at 10.5s against a full model call that needs ~15s. */
  const floor=STAGE_FLOOR_MS[stage]??this.minimumMs;
  const timeoutMs=Math.max(floor,Math.min(base.timeoutMs,Math.round(remaining*SHARE[stage])));
  /** A repair is a second full model call: shed it as soon as the remainder
   *  could not fit one more window of this stage's floor size. */
  const maxRepairs:0|1=remaining<floor*2?0:base.maxRepairs;
  return {...base,timeoutMs,maxRepairs};
 }
}

/** Default allowance for a job: a small multiple of the requested lesson length,
 *  never below a floor that covers the fixed stages. `V2_JOB_BUDGET_MS` overrides
 *  it outright and `V2_JOB_BUDGET_FACTOR` scales it. */
export function jobBudgetMs(targetMinutes:number|undefined,env:NodeJS.ProcessEnv={}):number{
 const override=Number(env.V2_JOB_BUDGET_MS);
 if(Number.isFinite(override)&&override>0)return override;
 const factor=Number(env.V2_JOB_BUDGET_FACTOR);
 const scale=Number.isFinite(factor)&&factor>0?factor:3;
 const minutes=targetMinutes===undefined?1:targetMinutes;
 if(!Number.isFinite(minutes)||minutes<=0)throw new Error('targetMinutes must be greater than zero');
 return Math.max(120_000,Math.round(minutes*60_000*scale));
}
