import type {StageMetrics,TelemetryEvent} from '../../src/semantic/planning/generate.js';
import type {StageCall,StageEvent} from '../../src/semantic/planning/model-adapter.js';
import type {CompiledSceneV2} from '../../src/semantic/types.js';
import type {LiveEvalCase} from './manifest.js';
import type {HarnessRunManifest} from '../../src/semantic/harness/contracts.js';

export interface StageSuccessFlags {
  sourceUnderstandingSuccess: boolean;
  teachingPlanSuccess: boolean;
  storyboardSuccess: boolean;
  mentalModelSuccess: boolean;
  representationResolutionSuccess: boolean;
  visualDirectionSuccess: boolean;
  sceneGraphSuccess: boolean;
  compileSuccess: boolean;
  timelineSuccess: boolean;
  ttsSuccess: boolean;
  fullJobSuccess: boolean;
  partialJob: boolean;
}

export interface RepairCounts {
  plannerRepairCount: number;
  directorRepairCount: number;
  representationFallbackCount: number;
  geometryRepairCount: number;
  timelineRepairCount: number;
  ttsFallbackCount: number;
  invalidReferenceCount: number;
  missingRepresentationCount: number;
  schemaRetryCount: number;
  modelRetryCount: number;
}

export interface PerformanceMetrics {
  sourceReadyMs: number | null;
  teachingPlanReadyMs: number | null;
  scenePlanReadyMs: number | null;
  firstRepresentationReadyMs: number | null;
  firstVisualReadyMs: number | null;
  narrationReadyMs: number | null;
  firstAudioByteMs: number | null;
  ttsCompleteMs: number | null;
  firstAVPlayableMs: number | null;
  fullPlayableMs: number | null;
  exportMs: number | null;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
}

export interface SemanticCoverage {
  criticalClaimCoverage:number;
  conceptCoverage:number;
  relationshipCoverage:number;
  archetypeAppropriate:boolean;
  forbiddenPatternCount:number;
  criticalAssetRoleCoverage:number;
}

export interface LiveRunMetrics extends StageSuccessFlags, RepairCounts, PerformanceMetrics, SemanticCoverage {normalizationCount:number;staticIntervalCount:number;continuityPreservationRate:number;unexplainedResetCount:number;teachingFailureCount:number}

export interface CaseTelemetry {
  caseId: string;
  runIndex: number;
  runId: string;
  modelConfigHash: string;
  envHash: string;
  status: 'complete' | 'partial' | 'error';
  error?: string;
  errorKind?: string;
  scenes: SceneTelemetry[];
  metrics: LiveRunMetrics;
  rawModelEvents: StageEvent[];
  telemetryEvents: TelemetryEvent[];
  startedAt: string;
  finishedAt: string;
  harnessManifests?:HarnessRunManifest[];
}

export interface SceneTelemetry {
  sceneId: string;
  stageMetrics: StageMetrics;
  diagnostics: string[];
  compileFindings: {code: string; severity: 'hard' | 'advisory'; message: string}[];
  objects: {id: string; conceptId?: string; assetRef?: string; role: string}[];
  relations: {id: string; from: string; to: string; relationType: string}[];
  timingKind: string;
  durationMs: number;
  archetype: string;
  continuityConcepts:string[];
  continuityTransitions:number;
}

export function emptyMetrics(): LiveRunMetrics {
  return {
    normalizationCount: 0,
    staticIntervalCount: 0,
    continuityPreservationRate:1,
    unexplainedResetCount:0,
    teachingFailureCount:0,
    sourceUnderstandingSuccess: false,
    teachingPlanSuccess: false,
    storyboardSuccess: false,
    mentalModelSuccess: false,
    representationResolutionSuccess: false,
    visualDirectionSuccess: false,
    sceneGraphSuccess: false,
    compileSuccess: false,
    timelineSuccess: false,
    ttsSuccess: false,
    fullJobSuccess: false,
    partialJob: false,
    plannerRepairCount: 0,
    directorRepairCount: 0,
    representationFallbackCount: 0,
    geometryRepairCount: 0,
    timelineRepairCount: 0,
    ttsFallbackCount: 0,
    invalidReferenceCount: 0,
    missingRepresentationCount: 0,
    schemaRetryCount: 0,
    modelRetryCount: 0,
    sourceReadyMs: null,
    teachingPlanReadyMs: null,
    scenePlanReadyMs: null,
    firstRepresentationReadyMs: null,
    firstVisualReadyMs: null,
    narrationReadyMs: null,
    firstAudioByteMs: null,
    ttsCompleteMs: null,
    firstAVPlayableMs: null,
    fullPlayableMs: null,
    exportMs: null,
    costUsd: 0,
    promptTokens: 0,
    completionTokens: 0
    ,criticalClaimCoverage: 0
    ,conceptCoverage: 0
    ,relationshipCoverage: 0
    ,archetypeAppropriate: false
    ,forbiddenPatternCount: 0
    ,criticalAssetRoleCoverage: 0
  };
}

const normalize=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
function objectMatches(objects:CompiledSceneV2['objects'], concept:string) {
  const wanted=normalize(concept);
  return objects.filter(o=>[o.conceptId??'',o.label,o.assetRef??''].some(value=>normalize(value).includes(wanted)));
}

export function evaluateCaseSemantics(c:LiveEvalCase, scenes:CompiledSceneV2[]):SemanticCoverage {
  const allObjects=scenes.flatMap(s=>s.objects);
  const allText=scenes.flatMap(s=>[s.scene.teachingGoal,s.scene.mentalModel,...s.scene.beats.map(b=>b.narration),...s.objects.map(o=>o.label)]).join(' ');
  const claims=c.mustExplain.length
    ? c.mustExplain.filter(claim=>normalize(allText).includes(normalize(claim))).length/c.mustExplain.length
    : 1;
  const concepts=c.expectedConcepts?.length
    ? c.expectedConcepts.filter(concept=>objectMatches(allObjects,concept).length>0).length/c.expectedConcepts.length
    : 1;
  const relationships=c.requiredRelations?.length
    ? c.requiredRelations.filter(req=>scenes.some(scene=>{
      const fromIds=new Set(objectMatches(scene.objects,req.fromConcept).map(o=>o.id));
      const toIds=new Set(objectMatches(scene.objects,req.toConcept).map(o=>o.id));
      return scene.relations.some(r=>fromIds.has(r.from.objectId)&&toIds.has(r.to.objectId)
        &&(!req.targetPart||normalize(r.to.anchor).includes(normalize(req.targetPart))));
    })).length/c.requiredRelations.length
    : 1;
  const archetypeAppropriate=!c.preferredArchetypes?.length||scenes.some(s=>c.preferredArchetypes!.includes(s.scene.archetype));
  const forbiddenPatternCount=(c.forbiddenPatterns??[]).filter(pattern=>normalize(allText).includes(normalize(pattern))).length;
  const assetRoles=c.criticalAssetRoles??[];
  const criticalAssetRoleCoverage=assetRoles.length
    ? assetRoles.filter(role=>{const words=normalize(role).split('_').filter(Boolean);return allObjects.some(o=>words.every(word=>normalize(`${o.role}_${o.assetRef??''}_${o.label}`).includes(word)));}).length/assetRoles.length
    : 1;
  return {criticalClaimCoverage:claims,conceptCoverage:concepts,relationshipCoverage:relationships,archetypeAppropriate,forbiddenPatternCount,criticalAssetRoleCoverage};
}

export function computeRunMetrics(
  telemetry: TelemetryEvent[],
  modelEvents: StageEvent[],
  calls: StageCall[],
  scenes: SceneTelemetry[],
  status: CaseTelemetry['status'],
  error?: string,
  manifests:HarnessRunManifest[]=[]
): LiveRunMetrics {
  const m = emptyMetrics();
  const byStage = new Map<TelemetryEvent['stage'], TelemetryEvent[]>();
  for (const e of telemetry) {
    const list = byStage.get(e.stage) ?? [];
    list.push(e);
    byStage.set(e.stage, list);
  }

  const stageSuccess = (stage: TelemetryEvent['stage']) => {
    const list = byStage.get(stage) ?? [];
    if (list.length === 0) return false;
    return list[list.length - 1].status === 'success';
  };

  const harnessStage=(stage:string)=>manifests.some(manifest=>manifest.stages.some(entry=>entry.stage===stage&&entry.gate.passed));
  m.sourceUnderstandingSuccess = manifests.length?manifests.every(manifest=>manifest.stages.some(entry=>entry.stage==='knowledge-compiler'&&entry.gate.passed)):false;
  m.teachingPlanSuccess = harnessStage('teaching-architect')||stageSuccess('teaching');
  m.storyboardSuccess = harnessStage('whiteboard-planner')||m.teachingPlanSuccess;
  m.mentalModelSuccess = stageSuccess('visual-model');
  m.representationResolutionSuccess = harnessStage('representation-guide')||((byStage.get('representation') ?? []).length
    ? stageSuccess('representation')
    : m.mentalModelSuccess);
  m.visualDirectionSuccess = harnessStage('visual-director')||stageSuccess('director');
  m.sceneGraphSuccess = m.visualDirectionSuccess;
  m.compileSuccess = harnessStage('compiler')||stageSuccess('compile');
  m.timelineSuccess = harnessStage('tts-alignment')||m.compileSuccess;
  m.ttsSuccess = scenes.length > 0 ? scenes.every(s => s.timingKind !== 'estimated') : false;
  m.fullJobSuccess = status === 'complete';
  m.partialJob = status === 'partial';

  for (const e of telemetry) {
    const details = (e.details ?? {}) as Record<string, unknown>;
    if (e.stage === 'representation' && typeof details.fallbackCount === 'number') {
      m.representationFallbackCount += details.fallbackCount;
    }
    if (e.stage === 'director' && e.status === 'failure' && /No teaching asset|Unavailable semantic anchor/i.test(e.error ?? '')) {
      m.missingRepresentationCount++;
    }
  }
  for (const e of modelEvents) {
    if (e.kind === 'healed') m.normalizationCount++;
    if(e.kind==='failure'){m.schemaRetryCount++;if(e.stage==='teaching')m.plannerRepairCount++;if(e.stage==='director')m.directorRepairCount++;}
    // Attempts are counted from calls, not again from validation events.
  }
  for (const c of calls) {
    if (c.attempt > 0) m.modelRetryCount++;
  }

  for (const scene of scenes) {
    for (const d of scene.diagnostics) {
      if (d.includes('geometry repair')) m.geometryRepairCount++;
      if (d.includes('representation fallback')) m.representationFallbackCount++;
      if (d.includes('Narrated static interval')) m.staticIntervalCount++;
    }
    for (const f of scene.compileFindings) {
      if (f.severity === 'hard' && /reference|anchor|dangling/.test(f.code)) m.invalidReferenceCount++;
    }
  }
  let expectedContinuity=0,preservedContinuity=0;
  for(let index=1;index<scenes.length;index++){
    const before=new Set(scenes[index-1].objects.map(o=>o.conceptId).filter(Boolean)),after=new Set(scenes[index].objects.map(o=>o.conceptId).filter(Boolean)),expected=new Set(scenes[index].continuityConcepts);
    expectedContinuity+=expected.size;for(const concept of expected)if(before.has(concept)&&after.has(concept))preservedContinuity++;
    if(before.size&&after.size&&![...before].some(concept=>after.has(concept)))m.unexplainedResetCount++;
  }
  m.continuityPreservationRate=expectedContinuity?preservedContinuity/expectedContinuity:1;
  m.teachingFailureCount=manifests.flatMap(manifest=>manifest.gates).flatMap(gate=>gate.findings).filter(finding=>finding.severity==='hard').length;

  m.costUsd = Number(calls.reduce((s, c) => s + c.costUsd, 0).toFixed(6));
  m.promptTokens = calls.reduce((s, c) => s + c.promptTokens, 0);
  m.completionTokens = calls.reduce((s, c) => s + c.completionTokens, 0);

  const first = (stage: TelemetryEvent['stage'], status: TelemetryEvent['status']) => {
    const e = telemetry.find(ev => ev.stage === stage && ev.status === status);
    return e?.atMs ?? null;
  };

  m.teachingPlanReadyMs = first('teaching', 'success');
  m.firstRepresentationReadyMs = first('representation', 'success');
  m.firstVisualReadyMs = first('compile', 'success');
  m.narrationReadyMs = first('narration-finalize', 'success');
  m.firstAudioByteMs = null; // Buffered local speech does not expose first-byte arrival.
  m.ttsCompleteMs = m.ttsSuccess ? first('tts', 'success') : null;

  if (scenes.length > 0) {
    const last = scenes[scenes.length - 1];
    m.fullPlayableMs = last.stageMetrics.sceneReadyMs ?? null;
    m.firstAVPlayableMs = m.ttsSuccess
      ? (scenes[0].stageMetrics.sceneReadyMs ?? null)
      : null;
  }

  return m;
}

export function sceneTelemetry(scene: CompiledSceneV2, stageMetrics: StageMetrics): SceneTelemetry {
  return {
    sceneId: scene.scene.id,
    stageMetrics,
    diagnostics: scene.diagnostics,
    compileFindings: [],
    objects: scene.objects.map(o => ({id: o.id, conceptId: o.conceptId, assetRef: o.assetRef, role: o.role})),
    relations: scene.relations.map(r => ({id: r.id, from: r.from.objectId, to: r.to.objectId, relationType: r.relationType})),
    timingKind: scene.timing.kind,
    durationMs: scene.durationMs,
    archetype: scene.scene.archetype,
    continuityConcepts:[...new Set([...scene.scene.continuity.keepFromPrevious.map(id=>scene.objects.find(o=>o.id===id)?.conceptId).filter((id):id is string=>Boolean(id)),...(scene.scene.continuity.transitions??[]).filter(t=>['KEEP','MOVE','TRANSFORM'].includes(t.action)).map(t=>t.conceptId)])],
    continuityTransitions:scene.scene.continuity.transitions?.length??0
  };
}

export function percent(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 1000) / 10;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
