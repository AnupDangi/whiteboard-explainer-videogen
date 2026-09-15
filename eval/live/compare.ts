import type {CaseTelemetry, LiveRunMetrics} from './metrics.js';
import {percent, percentile, mean} from './metrics.js';
import type {LiveEvalCase} from './manifest.js';
import {evaluateMigrationGates,type MigrationGate} from './gates.js';

export interface AggregateReport {
  generatedAt: string;
  configHash: string;
  totalCases: number;
  totalRuns: number;
  stageSuccess: Record<string, {pass: number; fail: number; rate: number}>;
  byCategory: Record<string, {runs: number; fullJobSuccess: number; rate: number}>;
  byArchetype: Record<string, {runs: number; fullJobSuccess: number; rate: number}>;
  repairs: Record<string, number>;
  failureTaxonomy: Record<string, number>;
  latency: Record<string, {P50: number; P95: number; mean: number; unit: string}>;
  cost: {P50: number; P95: number; mean: number; total: number};
  stageAccounting:Record<string,{runs:number;costUsd:number;promptTokens:number;completionTokens:number;latencyP50Ms:number;latencyP95Ms:number}>;
  dimensions:{truth:number;teaching:number;visual:number;timing:number;continuity:number;reliability:number;performance:{firstAVP50Ms:number};cost:{meanUsd:number}};
  migrationGates:MigrationGate[];
  caseResults: CaseResult[];
  regressions: Regression[];
  limitations: string[];
}

export interface CaseResult {
  caseId: string;
  category: string;
  runs: number;
  fullJobSuccess: number;
  partialJob: number;
  error: number;
  meanCostUsd: number;
  meanFirstAVPlayableMs: number | null;
  meanFullPlayableMs: number | null;
  meanCriticalClaimCoverage: number;
  meanConceptCoverage: number;
  meanRelationshipCoverage: number;
  meanCriticalAssetRoleCoverage: number;
  forbiddenPatternRuns: number;
}

export interface Regression {
  caseId: string;
  runIndex: number;
  reason: string;
}

export function aggregateReport(
  cases: LiveEvalCase[],
  runs: CaseTelemetry[],
  configHash: string
): AggregateReport {
  const stageKeys = [
    'sourceUnderstandingSuccess',
    'teachingPlanSuccess',
    'storyboardSuccess',
    'mentalModelSuccess',
    'representationResolutionSuccess',
    'visualDirectionSuccess',
    'sceneGraphSuccess',
    'compileSuccess',
    'timelineSuccess',
    'ttsSuccess',
    'fullJobSuccess'
  ] as const;

  const stageSuccess: AggregateReport['stageSuccess'] = {};
  for (const key of stageKeys) {
    const pass = runs.filter(r => r.metrics[key]).length;
    stageSuccess[key] = {pass, fail: runs.length - pass, rate: percent(pass, runs.length)};
  }

  const byCategory: AggregateReport['byCategory'] = {};
  const byArchetype: AggregateReport['byArchetype'] = {};
  const repairs: Record<string, number> = {};
  const failureTaxonomy: Record<string, number> = {};
  const regressions: Regression[] = [];
  const caseResults: CaseResult[] = [];

  for (const c of cases) {
    const caseRuns = runs.filter(r => r.caseId === c.id);
    const fullJob = caseRuns.filter(r => r.metrics.fullJobSuccess).length;
    const partial = caseRuns.filter(r => r.metrics.partialJob).length;
    const err = caseRuns.filter(r => r.status === 'error').length;
    const costs = caseRuns.map(r => r.metrics.costUsd).filter(x => x > 0);
    const firstAv = caseRuns.map(r => r.metrics.firstAVPlayableMs).filter((x): x is number => x !== null);
    const full = caseRuns.map(r => r.metrics.fullPlayableMs).filter((x): x is number => x !== null);
    const meanMetric=(key:'criticalClaimCoverage'|'conceptCoverage'|'relationshipCoverage'|'criticalAssetRoleCoverage')=>Number(mean(caseRuns.map(r=>r.metrics[key])).toFixed(3));
    caseResults.push({
      caseId: c.id,
      category: c.category,
      runs: caseRuns.length,
      fullJobSuccess: fullJob,
      partialJob: partial,
      error: err,
      meanCostUsd: costs.length ? Number(mean(costs).toFixed(6)) : 0,
      meanFirstAVPlayableMs: firstAv.length ? Math.round(mean(firstAv)) : null,
      meanFullPlayableMs: full.length ? Math.round(mean(full)) : null,
      meanCriticalClaimCoverage: meanMetric('criticalClaimCoverage'),
      meanConceptCoverage: meanMetric('conceptCoverage'),
      meanRelationshipCoverage: meanMetric('relationshipCoverage'),
      meanCriticalAssetRoleCoverage: meanMetric('criticalAssetRoleCoverage'),
      forbiddenPatternRuns: caseRuns.reduce((count,r)=>count+(r.metrics.forbiddenPatternCount>0?1:0),0)
    });

    byCategory[c.category] = {
      runs: caseRuns.length,
      fullJobSuccess: fullJob,
      rate: percent(fullJob, caseRuns.length)
    };

    for (const r of caseRuns) {
      const archetype = r.scenes[0]?.archetype ?? 'unknown';
      const entry = byArchetype[archetype] ?? {runs: 0, fullJobSuccess: 0, rate: 0};
      entry.runs++;
      if (r.metrics.fullJobSuccess) entry.fullJobSuccess++;
      entry.rate = percent(entry.fullJobSuccess, entry.runs);
      byArchetype[archetype] = entry;

      for (const [k, v] of Object.entries(r.metrics)) {
        if (typeof v === 'number' && k.endsWith('Count') && v > 0) {
          repairs[k] = (repairs[k] ?? 0) + v;
        }
      }

      if (r.errorKind) {
        failureTaxonomy[r.errorKind] = (failureTaxonomy[r.errorKind] ?? 0) + 1;
      }

      if (r.status === 'error') {
        regressions.push({caseId: c.id, runIndex: r.runIndex, reason: r.error ?? r.errorKind ?? 'unknown'});
      }
    }
  }

  const firstAvAll = runs.map(r => r.metrics.firstAVPlayableMs).filter((x): x is number => x !== null);
  const fullAll = runs.map(r => r.metrics.fullPlayableMs).filter((x): x is number => x !== null);
  const costAll = runs.map(r => r.metrics.costUsd);
  const stageAccounting:AggregateReport['stageAccounting']={};
  const seenStages=new Set<string>(),stageLatencies:Record<string,number[]>={};
  for(const run of runs)for(const manifest of run.harnessManifests??[])for(const stage of manifest.stages){const identity=`${manifest.runId}:${stage.stage}:${stage.startedAt}`;if(seenStages.has(identity))continue;seenStages.add(identity);const entry=stageAccounting[stage.stage]??{runs:0,costUsd:0,promptTokens:0,completionTokens:0,latencyP50Ms:0,latencyP95Ms:0};entry.runs++;entry.costUsd+=stage.costUsd;entry.promptTokens+=stage.promptTokens;entry.completionTokens+=stage.completionTokens;(stageLatencies[stage.stage]??=[]).push(stage.elapsedMs);stageAccounting[stage.stage]=entry;}
  for(const [stage,entry] of Object.entries(stageAccounting)){entry.costUsd=Number(entry.costUsd.toFixed(6));entry.latencyP50Ms=percentile(stageLatencies[stage]??[],50);entry.latencyP95Ms=percentile(stageLatencies[stage]??[],95);}
  const average=(key:keyof Pick<LiveRunMetrics,'criticalClaimCoverage'|'conceptCoverage'|'relationshipCoverage'|'criticalAssetRoleCoverage'|'continuityPreservationRate'>)=>Number(mean(runs.map(run=>run.metrics[key] as number)).toFixed(3));
  const rate=(predicate:(run:CaseTelemetry)=>boolean)=>Number((runs.length?runs.filter(predicate).length/runs.length:0).toFixed(3));

  const report:AggregateReport={
    generatedAt: new Date().toISOString(),
    configHash,
    totalCases: new Set(runs.map(r => r.caseId)).size,
    totalRuns: runs.length,
    stageSuccess,
    byCategory,
    byArchetype,
    repairs,
    failureTaxonomy,
    latency: {
      firstAVPlayableMs: {P50: percentile(firstAvAll, 50), P95: percentile(firstAvAll, 95), mean: Math.round(mean(firstAvAll)), unit: 'ms'},
      fullPlayableMs: {P50: percentile(fullAll, 50), P95: percentile(fullAll, 95), mean: Math.round(mean(fullAll)), unit: 'ms'}
    },
    cost: {P50: percentile(costAll, 50), P95: percentile(costAll, 95), mean: Number(mean(costAll).toFixed(6)), total: Number(costAll.reduce((a, b) => a + b, 0).toFixed(6))},
    stageAccounting,
    dimensions:{truth:average('criticalClaimCoverage'),teaching:rate(run=>run.metrics.teachingPlanSuccess&&run.metrics.teachingFailureCount===0),visual:Number(mean(runs.map(run=>(run.metrics.conceptCoverage+run.metrics.relationshipCoverage+run.metrics.criticalAssetRoleCoverage)/3)).toFixed(3)),timing:rate(run=>run.metrics.timelineSuccess&&run.metrics.staticIntervalCount===0),continuity:average('continuityPreservationRate'),reliability:rate(run=>run.metrics.fullJobSuccess),performance:{firstAVP50Ms:percentile(firstAvAll,50)},cost:{meanUsd:Number(mean(costAll).toFixed(6))}},
    migrationGates:[],
    caseResults,
    regressions,
    limitations: [
      'Timing source depends on configured speech provider; estimated timing is labeled.',
      'firstAVPlayableMs is null when narration is disabled or TTS fails.',
      'Repair counts rely on emitted telemetry and diagnostic strings.',
      'Teaching gates are structural; real comprehension still requires independent evaluator and human results.'
    ]
  };
  report.migrationGates=evaluateMigrationGates(report,runs).gates;
  return report;
}

function row(values: (string | number)[]): string {
  return '| ' + values.join(' | ') + ' |';
}

export function reportToMarkdown(report: AggregateReport): string {
  const lines: string[] = [];
  lines.push('# Live Evaluation Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Config hash: \`${report.configHash}\``);
  lines.push(`Cases: ${report.totalCases} · Runs: ${report.totalRuns}`);
  lines.push('');

  lines.push('## Stage success');
  lines.push(row(['Stage', 'Pass', 'Fail', 'Rate']));
  lines.push(row(['---', '---', '---', '---']));
  for (const [stage, data] of Object.entries(report.stageSuccess)) {
    lines.push(row([stage, data.pass, data.fail, `${data.rate}%`]));
  }
  lines.push('');

  lines.push('## By category');
  lines.push(row(['Category', 'Runs', 'Full success', 'Rate']));
  lines.push(row(['---', '---', '---', '---']));
  for (const [cat, data] of Object.entries(report.byCategory)) {
    lines.push(row([cat, data.runs, data.fullJobSuccess, `${data.rate}%`]));
  }
  lines.push('');

  lines.push('## By archetype');
  lines.push(row(['Archetype', 'Runs', 'Full success', 'Rate']));
  lines.push(row(['---', '---', '---', '---']));
  for (const [arch, data] of Object.entries(report.byArchetype)) {
    lines.push(row([arch, data.runs, data.fullJobSuccess, `${data.rate}%`]));
  }
  lines.push('');

  lines.push('## Repair histogram');
  lines.push(row(['Repair', 'Count']));
  lines.push(row(['---', '---']));
  const repairs = Object.entries(report.repairs).sort((a, b) => b[1] - a[1]);
  if (repairs.length === 0) lines.push(row(['(none)', 0]));
  for (const [k, v] of repairs) lines.push(row([k, v]));
  lines.push('');

  lines.push('## Failure taxonomy');
  lines.push(row(['Kind', 'Count']));
  lines.push(row(['---', '---']));
  const failures = Object.entries(report.failureTaxonomy).sort((a, b) => b[1] - a[1]);
  if (failures.length === 0) lines.push(row(['(none)', 0]));
  for (const [k, v] of failures) lines.push(row([k, v]));
  lines.push('');

  lines.push('## Latency');
  lines.push(row(['Metric', 'P50', 'P95', 'Mean']));
  lines.push(row(['---', '---', '---', '---']));
  for (const [k, v] of Object.entries(report.latency)) {
    lines.push(row([k, v.P50, v.P95, v.mean]));
  }
  lines.push('');

  lines.push('## Cost');
  lines.push(row(['P50', 'P95', 'Mean', 'Total']));
  lines.push(row(['---', '---', '---', '---']));
  lines.push(row([report.cost.P50, report.cost.P95, report.cost.mean, report.cost.total]));
  lines.push('');

  lines.push('## Separate quality dimensions');
  lines.push(row(['Truth', 'Teaching', 'Visual', 'Timing', 'Continuity', 'Reliability', 'First AV P50 ms', 'Mean cost USD']));
  lines.push(row(['---', '---', '---', '---', '---', '---', '---', '---']));
  lines.push(row([report.dimensions.truth,report.dimensions.teaching,report.dimensions.visual,report.dimensions.timing,report.dimensions.continuity,report.dimensions.reliability,report.dimensions.performance.firstAVP50Ms,report.dimensions.cost.meanUsd]));
  lines.push('');

  lines.push('## Migration gates (machine-evaluated)');
  lines.push(row(['Gate', 'Target', 'Value', 'Pass']));
  lines.push(row(['---', '---', '---', '---']));
  for (const gate of report.migrationGates) lines.push(row([gate.id, gate.target, gate.value === null ? 'pending' : String(gate.value), gate.pass === null ? 'PENDING-HUMAN' : String(gate.pass)]));
  lines.push('');

  lines.push('## Per-stage accounting');
  lines.push(row(['Stage','Runs','Cost USD','Prompt tokens','Completion tokens','P50 ms','P95 ms']));
  lines.push(row(['---','---','---','---','---','---','---']));
  for(const [stage,data] of Object.entries(report.stageAccounting))lines.push(row([stage,data.runs,data.costUsd,data.promptTokens,data.completionTokens,data.latencyP50Ms,data.latencyP95Ms]));
  lines.push('');

  lines.push('## Case-level results');
  lines.push(row(['Case', 'Category', 'Runs', 'Success', 'Partial', 'Error', 'Claims', 'Concepts', 'Relations', 'Assets', 'Forbidden', 'Mean cost', 'Mean first AV ms', 'Mean full ms']));
  lines.push(row(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---']));
  for (const c of report.caseResults) {
    lines.push(row([
      c.caseId,
      c.category,
      c.runs,
      c.fullJobSuccess,
      c.partialJob,
      c.error,
      c.meanCriticalClaimCoverage,
      c.meanConceptCoverage,
      c.meanRelationshipCoverage,
      c.meanCriticalAssetRoleCoverage,
      c.forbiddenPatternRuns,
      c.meanCostUsd,
      c.meanFirstAVPlayableMs ?? '—',
      c.meanFullPlayableMs ?? '—'
    ]));
  }
  lines.push('');

  if (report.regressions.length) {
    lines.push('## Regressions');
    lines.push(row(['Case', 'Run', 'Reason']));
    lines.push(row(['---', '---', '---']));
    for (const r of report.regressions) lines.push(row([r.caseId, r.runIndex, r.reason]));
    lines.push('');
  }

  lines.push('## Limitations');
  for (const lim of report.limitations) lines.push(`- ${lim}`);
  lines.push('');

  return lines.join('\n');
}
