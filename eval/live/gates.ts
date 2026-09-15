import type {AggregateReport} from './compare.js';
import type {CaseTelemetry} from './metrics.js';

/** Machine-readable migration gates (plan Phase 10). Human-dependent gates
 *  report value:null and never pass until the protocol runs. */
export interface MigrationGate {
  id:string;
  target:string;
  value:number|string|null;
  pass:boolean|null;
  note?:string;
}

export interface MigrationReport {gates:MigrationGate[];allPassed:boolean;pendingHuman:number}

export function evaluateMigrationGates(report:AggregateReport,runs:CaseTelemetry[]):MigrationReport{
 const completeRuns=runs.filter(run=>run.status!=='error');
 const critical=completeRuns.flatMap(run=>[run.metrics.criticalClaimCoverage,run.metrics.relationshipCoverage]).filter(value=>value!==undefined) as number[];
 const minCritical=critical.length?Number(Math.min(...critical).toFixed(3)):null;
 const unexplainedResets=runs.reduce((sum,run)=>sum+(run.metrics.unexplainedResetCount??0),0);
 const teachingFailures=runs.reduce((sum,run)=>sum+(run.metrics.teachingFailureCount??0),0);
 const firstAv=report.dimensions.performance.firstAVP50Ms;
 const gates:MigrationGate[]=[
  {id:'compile_success',target:'>= 99%',value:report.stageSuccess.compileSuccess?.rate??null,pass:report.stageSuccess.compileSuccess?report.stageSuccess.compileSuccess.rate>=99:null},
  {id:'full_job_success',target:'>= 95%',value:report.stageSuccess.fullJobSuccess?.rate??null,pass:report.stageSuccess.fullJobSuccess?report.stageSuccess.fullJobSuccess.rate>=95:null},
  {id:'critical_coverage',target:'= 100%',value:minCritical,pass:minCritical===null?null:minCritical===1},
  {id:'prerequisite_violations',target:'= 0',value:teachingFailures,pass:teachingFailures===0},
  {id:'unexplained_resets',target:'= 0',value:unexplainedResets,pass:unexplainedResets===0},
  {id:'continuity',target:'> 90%',value:report.dimensions.continuity,pass:report.dimensions.continuity>0.9},
  {id:'first_av_p50',target:'<= 12000 ms',value:firstAv>0?firstAv:null,pass:firstAv>0?firstAv<=12000:null},
  {id:'representation_degradation',target:'~ 0 fallbacks per complete run',value:completeRuns.length?Number((runs.reduce((sum,run)=>sum+(run.metrics.forbiddenPatternCount??0),0)/Math.max(1,completeRuns.length)).toFixed(3)):null,pass:null,note:'advisory until a dedicated degradation metric lands'},
  {id:'browser_export_determinism',target:'unchanged',value:null,pass:null,note:'owned by the renderer test suite, asserted per wave'},
  {id:'blind_human_preference',target:'V2 >= 70%',value:null,pass:null,note:'pending blind pairwise protocol'},
  {id:'comprehension_gain',target:'positive on factual, mechanism, transfer',value:null,pass:null,note:'pending real-learner pre/post protocol'}
 ];
 const decided=gates.filter(gate=>gate.pass!==null);
 return {gates,allPassed:decided.length>0&&decided.every(gate=>gate.pass),pendingHuman:gates.filter(gate=>gate.pass===null).length};
}
