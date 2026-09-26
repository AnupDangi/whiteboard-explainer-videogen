import { stableJson } from '../../shared/artifacts.js';
import type { StageFailure } from '../types.js';
import { addUsage, emptyUsage, type CallUsage, type StructuredCallAttemptRecord } from '../llm/structuredCall.js';
import { analyzeTeachingPlan, type PlanAnalysis } from '../plan/analyze.js';
import type { ConceptGraph, Script, TeachingPlan } from '../plan/schemas.js';
import { teachingContractFindings, teachingContractProblems } from '../plan/contracts.js';
import { sourceDocFromText, type SourceDoc } from '../plan/sourceDoc.js';
import { buildConceptGraph, buildTeachingPlan, writeScript, DEFAULT_PLAN_PROMPT_VARIANT, type LessonRequest } from '../plan/stages.js';
import type { HypothesisLiveInput, LiveSceneInput } from './runLive.js';
import type { PersistentBudgetLedger } from './budgetLedger.js';
import { ContentAddressedArtifactStore } from '../artifactCache.js';
import type { StageRunRecord } from '../../shared/contracts.js';

/**
 * S2 -> S3 -> plan analysis -> S4 for a free-form lesson request. Stops at
 * the first stage that fails validation (after its one repair) or when the
 * teaching-plan analyser finds a blocking F-PED error: a bad plan is never
 * narrated. Every call's usage and raw output is kept for the run log.
 */
export interface PreparedLesson {
  sourceDoc: SourceDoc;
  graph?: ConceptGraph;
  plan?: TeachingPlan;
  analysis?: PlanAnalysis;
  script?: Script;
  usage: CallUsage;
  failures: StageFailure[];
  rawResponses: Record<string, StructuredCallAttemptRecord[]>;
  cacheHits: string[];
  stageArtifacts: Record<string, { key: string; contentHash: string; cacheHit: boolean }>;
  stageRuns: StageRunRecord[];
}

export async function prepareLesson(req: LessonRequest, m: { model: string; apiKey: string; budgetUsd: number; budgetLedger?: PersistentBudgetLedger; artifactStore?: ContentAddressedArtifactStore; fetcher?: typeof fetch }): Promise<PreparedLesson> {
  const sourceStartedAtMs = Date.now();
  const sourceDoc = req.sourceDoc ?? sourceDocFromText(req.source, req.sourceFormat ?? 'text');
  const sourceDurationMs = Date.now() - sourceStartedAtMs;
  const groundedRequest: LessonRequest = { ...req, sourceDoc };
  const usage = emptyUsage();
  const failures: StageFailure[] = [];
  const rawResponses: PreparedLesson['rawResponses'] = {};
  const cacheHits: string[] = [];
  const stageArtifacts: PreparedLesson['stageArtifacts'] = {};
  const stageRuns: StageRunRecord[] = [{ stage: 'S1-source-intake', kind: 'local', status: 'completed', durationMs: req.sourceDoc ? 0 : sourceDurationMs, timingKnown: !req.sourceDoc, apiCostUsd: 0, cacheHit: false, fallbackCount: 0, failures: [] }];
  const budget = () => Math.max(0, m.budgetUsd - usage.costUsd);
  const runCached = async <T extends { usage: CallUsage; failures: StageFailure[] }>(stage: string, input: unknown, schemaVersion: string, stageVersion: string, produce: () => Promise<T>, promptVersion = `${stage}-prompt-v1`) => {
    const startedAtMs = Date.now();
    try {
      const cached = m.artifactStore
        ? await m.artifactStore.run(stage, input, { schemaVersion, stageVersion, promptVersion, modelId: m.model }, produce)
        : undefined;
      if (cached) stageArtifacts[stage] = { key: cached.key, contentHash: cached.artifact.contentHash, cacheHit: cached.cacheHit };
      const artifactResult = cached?.artifact.payload ?? await produce();
      const isCacheHit = Boolean(cached?.cacheHit);
      if (isCacheHit) cacheHits.push(stage);
      const measuredUsage = isCacheHit ? { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0 } : artifactResult.usage;
      stageRuns.push({
        stage, kind: 'provider', status: artifactResult.failures.some((failure) => failure.hard) ? 'failed' : 'completed',
        durationMs: Date.now() - startedAtMs, apiCostUsd: measuredUsage.costUsd,
        ...(isCacheHit ? { artifactApiCostUsd: artifactResult.usage.costUsd } : {}),
        cacheHit: isCacheHit, fallbackCount: 0,
        usage: { ...measuredUsage, fallbacks: 0, cacheHits: isCacheHit ? 1 : 0 },
        failures: artifactResult.failures.map((failure) => ({ code: failure.code, stage: failure.stage, message: failure.message, hard: failure.hard })),
      });
      return { result: isCacheHit ? { ...artifactResult, usage: measuredUsage } : artifactResult };
    } catch (error) {
      stageRuns.push({ stage, kind: 'provider', status: 'failed', durationMs: Date.now() - startedAtMs, apiCostUsd: 0, cacheHit: false, fallbackCount: 0, failures: [{ code: 'stage-threw', stage, message: error instanceof Error ? error.message : String(error), hard: true }] });
      throw error;
    }
  };

  const preparedResult = (extra: Partial<PreparedLesson>): PreparedLesson => ({ sourceDoc, usage, failures, rawResponses, cacheHits, stageArtifacts, stageRuns, ...extra });

  const gRun = await runCached('S2-concepts', groundedRequest, 'claude-concept-graph/v1', 'S2-concept-graph-v3-keyword-guard', () => buildConceptGraph(groundedRequest, { model: m.model, apiKey: m.apiKey, remainingBudgetUsd: budget(), budgetLedger: m.budgetLedger, fetcher: m.fetcher }));
  const g = gRun.result;
  addUsage(usage, g.usage); failures.push(...g.failures); rawResponses.concepts = g.rawResponses;
  if (!g.value) return preparedResult({});

  const pRun = await runCached('S3-teaching-plan', { request: groundedRequest, graph: g.value }, 'claude-teaching-plan/v2', `S3-teaching-plan-${DEFAULT_PLAN_PROMPT_VARIANT}-scaled-tokens`, () => buildTeachingPlan(groundedRequest, g.value!, { model: m.model, apiKey: m.apiKey, remainingBudgetUsd: budget(), budgetLedger: m.budgetLedger, fetcher: m.fetcher }), `S3-teaching-plan-prompt-${DEFAULT_PLAN_PROMPT_VARIANT}`);
  const p = pRun.result;
  addUsage(usage, p.usage); failures.push(...p.failures); rawResponses.plan = p.rawResponses;
  if (!p.value) return preparedResult({ graph: g.value });

  const analysis = analyzeTeachingPlan(p.value, g.value);
  const contractFindings = teachingContractFindings(p.value, g.value, groundedRequest.audience ?? 'general learner');
  for (const finding of contractFindings) failures.push({ code: finding.code, stage: 'plan', message: finding.message, hard: true });
  for (const f of analysis.findings) failures.push({ code: `${f.code}:${f.check}`, stage: 'plan', message: f.message, hard: f.severity === 'error' });
  const planGateFailures = failures.filter((failure) => failure.stage === 'plan');
  const planStageRun = stageRuns.find((stageRun) => stageRun.stage === 'S3-teaching-plan');
  if (planStageRun && planGateFailures.length) {
    planStageRun.status = planGateFailures.some((failure) => failure.hard) ? 'failed' : planStageRun.status;
    planStageRun.failures.push(...planGateFailures.map((failure) => ({ code: failure.code, stage: failure.stage, message: failure.message, hard: failure.hard })));
  }
  if (!analysis.ok || contractFindings.length) return preparedResult({ graph: g.value, plan: p.value, analysis });

  const sRun = await runCached('S4-narration-script', { request: groundedRequest, graph: g.value, plan: p.value }, 'claude-script/v1', 'S4-script-v1', () => writeScript(groundedRequest, g.value!, p.value!, { model: m.model, apiKey: m.apiKey, remainingBudgetUsd: budget(), budgetLedger: m.budgetLedger, fetcher: m.fetcher }));
  const s = sRun.result;
  addUsage(usage, s.usage); failures.push(...s.failures); rawResponses.script = s.rawResponses;
  return preparedResult({ graph: g.value, plan: p.value, analysis, script: s.value });
}

/** Map a prepared lesson onto the live S5->S11 pipeline input: one scene per plan section, with its teaching context and concept subgraph. */
export function lessonToLiveInput(caseId: string, prepared: PreparedLesson): HypothesisLiveInput {
  const { graph, plan, script, sourceDoc } = prepared;
  if (!graph || !plan || !script) throw new Error('lessonToLiveInput: lesson preparation did not complete');
  if (teachingContractProblems(plan, graph).length) throw new Error('lessonToLiveInput: missing or unsupported scene contract');
  const scenes: LiveSceneInput[] = plan.sections.map((section, i) => {
    const contract = section.contract!;
    const concepts = graph.concepts.filter((c) => contract.requiredConceptIds.includes(c.id));
    const ids = new Set(section.conceptIds);
    const relations = graph.relations.filter((r) => ids.has(r.from) && ids.has(r.to) && contract.requiredRelations.some((required) => required.from === r.from && required.to === r.to && required.type === r.type)).map(({ from, to, type, evidence }) => ({ from, to, type, evidenceRefs: evidence }));
    const sourceEvidenceRefs = [...new Map(
      [...concepts.flatMap((c) => c.evidence), ...relations.flatMap((r) => r.evidenceRefs)]
        // Key on the whole reference: two quotes from one span can share a start but end differently.
        .map((ref) => [stableJson(ref), ref]),
    ).values()];
    return {
      sceneId: section.id,
      sectionId: section.id,
      raw: script.scenes[i].text,
      sceneContract: contract,
      lessonBible: plan.lessonBible!,
      teachingContext: {
        displayText: section.title,
        visualIntent: section.goal,
        role: section.kind,
        equations: concepts.flatMap((c) => (c.latex ? [c.latex] : [])),
        concepts: concepts.map((c) => ({ id: c.id, label: c.label, kind: c.kind, definition: c.definition, level: c.level, evidenceRefs: c.evidence })),
        relations,
        sourceEvidenceRefs,
        requireEvidence: true,
        sourceId: sourceDoc.sourceId,
      },
    };
  });
  return { caseId, scenes, targetDurationMs: plan.targetDurationSec * 1000, runClass: 'generated-lesson', sourceDoc, stageRuns: prepared.stageRuns };
}
