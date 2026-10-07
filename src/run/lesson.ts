import { runBeatStages } from '../teaching/beat-pipeline.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import type { CompiledSceneNarration } from '../narration/beat-narration/types.js';
import type { NarrationContext } from '../narration/beat-narration/validate.js';
import type { ModelClient } from '../llm/modelClient.js';
import { discoverVisualVocabulary, type VisualVocabulary } from '../planner/visualDiscovery.js';
import { catalogVersion as enabledCatalogVersion } from '../assets/registry.js';
import { sha256, stableJson } from '../shared/artifacts.js';
import type { synthesizeAndAlign } from '../shared/alignment/align.js';
import { isSupportedLessonDuration, PIPELINE } from './config.js';
import { sceneAudioStage, synthesizeSceneAudio } from '../audio/sceneAudio.js';
import type { StageFailure } from '../shared/types.js';
import { addUsage, emptyUsage, type CallUsage, type StructuredCallAttemptRecord } from '../llm/structuredCall.js';
import { analyzeTeachingPlan, type PlanAnalysis } from '../plan/analyze.js';
import type { ConceptGraph, Script, TeachingPlan } from '../plan/schemas.js';
import { teachingContractFindings, teachingContractProblems, uniquifyClaimIds } from '../plan/contracts.js';
import { sourceDocFromText, type SourceDoc, type SourceBundle } from '../intake/sourceDoc.js';
import { buildConceptGraph, buildTeachingPlan, writeScript, DEFAULT_PLAN_PROMPT_VARIANT, type LessonRequest } from '../plan/stages.js';
import type { HypothesisLiveInput, LiveSceneInput } from './runLive.js';
import type { PersistentBudgetLedger } from './budgetLedger.js';
import { ContentAddressedArtifactStore } from './artifactCache.js';
import type { GroundingMode } from '../evidence/ledger.js';
import type { StageRunRecord } from '../shared/contracts.js';
import { intakeWarningFailures, loadSourceDoc, loadSourceDocFromUrl } from '../intake/sourceIntake.js';
import { buildSourceBundle, evidenceHitBudget } from '../intake/sourceBundle.js';
import { buildSyllabus, lessonCostCapUsd, rebudgetUnwrittenModules, type ModulePlan, type Syllabus } from '../plan/hierarchical.js';
import { parseMarkers } from '../narration/markers.js';
import { alignedWordTimingProblems, tokenizeWords } from '../narration/align.js';

/**
 * S2 -> S3 -> plan analysis -> S4 for a free-form lesson request. Stops at
 * the first stage that fails validation (after its one repair) or when the
 * teaching-plan analyser finds a blocking F-PED error: a bad plan is never
 * narrated. Every call's usage and raw output is kept for the run log.
 */
export interface PreparedLesson {
  sourceDoc: SourceDoc;
  sourceBundle?: SourceBundle;
  groundingMode: GroundingMode;
  syllabus?: Syllabus;
  modules?: ModulePlan[];
  requestedDurationSec?: number;
  plannedDurationSec?: number;
  coverageReason?: string;
  graph?: ConceptGraph;
  plan?: TeachingPlan;
  analysis?: PlanAnalysis;
  script?: Script;
  /** Visual Discovery (S3b) output per section id, and lesson concept -> validated catalog entry. Locked with the lesson. */
  visualVocabularies?: Record<string, VisualVocabulary>;
  validatedByConcept?: Record<string, string>;
  /** Beat mode (TEACHING_BEATS_V2): teaching beats and beat narration per section id (module-prefixed). */
  beatPlans?: Record<string, TeachingBeat[]>;
  beatNarrations?: Record<string, CompiledSceneNarration>;
  beatNarrationContexts?: Record<string, NarrationContext>;
  usage: CallUsage;
  failures: StageFailure[];
  rawResponses: Record<string, StructuredCallAttemptRecord[]>;
  cacheHits: string[];
  stageArtifacts: Record<string, { key: string; contentHash: string; cacheHit: boolean }>;
  stageRuns: StageRunRecord[];
}

/** Content stages whose model can be chosen independently (OPENROUTER_<STAGE>_MODEL). */
export type ContentStage = 'syllabus' | 'concepts' | 'plan' | 'script';
const CONTENT_STAGE_FOR: Array<[prefix: string, stage: ContentStage]> = [['S1-syllabus', 'syllabus'], ['S2-concepts', 'concepts'], ['S3-teaching-plan', 'plan'], ['S3b-visual-discovery', 'plan'], ['S4-narration-script', 'script']];

export async function prepareLesson(req: LessonRequest, m: { model: string; stageModels?: Partial<Record<ContentStage, string>>; apiKey: string; budgetUsd: number; budgetLedger?: PersistentBudgetLedger; artifactStore?: ContentAddressedArtifactStore; visionModel?: string; fetcher?: typeof fetch; speechAligner?: typeof synthesizeAndAlign; speechLanguage?: string; speechVoice?: string; alignmentCalibrationMedianErrorMs?: number; /** Plan beats and write beat narration instead of the marker script (V2 plan Phases 2-3). */ beats?: boolean; beatClient?: ModelClient }): Promise<PreparedLesson> {
  const groundingMode = req.groundingMode ?? 'STRICT_SOURCE';
  if (groundingMode !== 'STRICT_SOURCE' && groundingMode !== 'SOURCE_PLUS_BACKGROUND' && groundingMode !== 'OPEN_EXPLANATION') {
    throw new Error(`unknown grounding mode: ${String(groundingMode)}`);
  }
  const sourceStartedAtMs = Date.now();
  const sourceDocs = !req.sourceDoc && req.sources?.length ? await Promise.all(req.sources.map(async (source) => {
    if (source.kind === 'document') return loadSourceDoc(source.path);
    if (source.kind === 'url') return loadSourceDocFromUrl(source.url);
    const doc = sourceDocFromText(source.text, source.format ?? 'text');
    doc.title = source.title;
    return doc;
  })) : undefined;
  const bundled = !req.sourceDoc && sourceDocs?.length ? buildSourceBundle(sourceDocs, req.instruction ?? sourceDocs.map((doc) => doc.title ?? '').join(' '), { topK: evidenceHitBudget(req.targetDurationSec) }) : undefined;
  const sourceDoc = req.sourceDoc ?? bundled?.sourceDoc ?? sourceDocFromText(req.source, req.sourceFormat ?? 'text');
  const sourceBundle = req.sourceBundle ?? bundled?.sourceBundle;
  const sourceDurationMs = Date.now() - sourceStartedAtMs;
  const groundedRequest: LessonRequest = { ...req, groundingMode, sourceDoc, ...(sourceBundle ? { sourceBundle } : {}) };
  const usage = emptyUsage();
  let effectiveBudgetUsd = m.budgetUsd;
  const failures: StageFailure[] = [];
  const rawResponses: PreparedLesson['rawResponses'] = {};
  const cacheHits: string[] = [];
  const stageArtifacts: PreparedLesson['stageArtifacts'] = {};
  const stageRuns: StageRunRecord[] = [{ stage: 'S1-source-intake', kind: 'local', status: 'completed', durationMs: req.sourceDoc ? 0 : sourceDurationMs, startedAt: new Date(sourceStartedAtMs).toISOString(), completedAt: new Date(sourceStartedAtMs + sourceDurationMs).toISOString(), timingKnown: !req.sourceDoc, apiCostUsd: 0, cacheHit: false, fallbackCount: 0, failures: (sourceDocs ?? []).flatMap(intakeWarningFailures) }];
  if (sourceBundle) stageRuns.push({ stage: 'S1-evidence-retrieval', kind: 'local', status: sourceBundle.evidenceHits.length ? 'completed' : 'failed', durationMs: sourceBundle.retrievalCost.elapsedMs, apiCostUsd: sourceBundle.retrievalCost.apiCostUsd, costEstimated: sourceBundle.retrievalCost.estimated || undefined, cacheHit: false, fallbackCount: 0, failures: sourceBundle.evidenceHits.length ? [] : [{ code: 'no-source-evidence-hit', stage: 'S1-evidence-retrieval', message: 'No source spans matched the lesson instruction; source coverage must be checked before planning.', hard: true }] });
  if (sourceBundle && sourceBundle.evidenceHits.length === 0) failures.push({ code: 'no-source-evidence-hit', stage: 'source', message: 'No source spans matched the lesson instruction; source coverage must be checked before planning.', hard: true });
  const budget = () => Math.max(0, effectiveBudgetUsd - usage.costUsd);
  const modelFor = (stage: ContentStage): string => m.stageModels?.[stage] ?? m.model;
  const modelForStage = (stageName: string): string => modelFor(CONTENT_STAGE_FOR.find(([prefix]) => stageName.startsWith(prefix))?.[1] ?? 'concepts');
  const runCached = async <T extends { usage: CallUsage; failures: StageFailure[] }>(stage: string, input: unknown, schemaVersion: string, stageVersion: string, produce: () => Promise<T>, promptVersion = `${stage}-prompt-v1`) => {
    const startedAtMs = Date.now();
    try {
      const cached = m.artifactStore
        // Only complete results are stored: a failed or rejected call is retried on the next warm run.
        ? await m.artifactStore.run(stage, input, { schemaVersion, stageVersion, promptVersion, modelId: modelForStage(stage) }, produce, { cacheable: (result) => !result.failures.some((failure) => failure.hard) })
        : undefined;
      if (cached) stageArtifacts[stage] = { key: cached.key, contentHash: cached.artifact.contentHash, cacheHit: cached.cacheHit };
      const artifactResult = cached?.artifact.payload ?? await produce();
      const isCacheHit = Boolean(cached?.cacheHit);
      if (isCacheHit) cacheHits.push(stage);
      const measuredUsage = isCacheHit ? { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0 } : artifactResult.usage;
      const nestedSceneRuns = stage.startsWith('S4-narration-script') && 'sceneStageRuns' in artifactResult && Array.isArray(artifactResult.sceneStageRuns)
        ? artifactResult.sceneStageRuns as StageRunRecord[]
        : undefined;
      stageRuns.push({
        stage, kind: 'provider', modelId: modelForStage(stage), status: artifactResult.failures.some((failure) => failure.hard) ? 'failed' : 'completed',
        durationMs: Date.now() - startedAtMs, startedAt: new Date(startedAtMs).toISOString(), completedAt: new Date().toISOString(), apiCostUsd: measuredUsage.costUsd,
        ...(nestedSceneRuns ? { accountingRole: 'aggregate' as const } : {}),
        ...(isCacheHit ? { artifactApiCostUsd: artifactResult.usage.costUsd } : {}),
        cacheHit: isCacheHit, fallbackCount: 0,
        usage: { ...measuredUsage, fallbacks: 0, cacheHits: isCacheHit ? 1 : 0 },
        failures: artifactResult.failures.map((failure) => ({ code: failure.code, stage: failure.stage, message: failure.message, hard: failure.hard })),
      });
      if (nestedSceneRuns) {
        const completedAt = new Date().toISOString();
        const cachedSceneRuns = isCacheHit
          ? nestedSceneRuns.map((record: StageRunRecord) => ({
              ...record,
              durationMs: 0,
              startedAt: completedAt,
              completedAt,
              apiCostUsd: 0,
              artifactApiCostUsd: record.apiCostUsd,
              cacheHit: true,
              usage: record.usage ? { ...record.usage, calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0 } : undefined,
            }))
          : nestedSceneRuns;
        stageRuns.push(...cachedSceneRuns);
      }
      return { result: isCacheHit ? { ...artifactResult, usage: measuredUsage } : artifactResult };
    } catch (error) {
      stageRuns.push({ stage, kind: 'provider', status: 'failed', durationMs: Date.now() - startedAtMs, startedAt: new Date(startedAtMs).toISOString(), completedAt: new Date().toISOString(), apiCostUsd: 0, cacheHit: false, fallbackCount: 0, failures: [{ code: 'stage-threw', stage, message: error instanceof Error ? error.message : String(error), hard: true }] });
      throw error;
    }
  };

  const lessonClaimIds = new Set<string>();
  const vocabularies: Record<string, VisualVocabulary> = {};
  const validatedByConcept: Record<string, string> = {};
  const beatPlans: Record<string, TeachingBeat[]> = {};
  const beatNarrations: Record<string, CompiledSceneNarration> = {};
  const beatNarrationContexts: Record<string, NarrationContext> = {};
  /** S3b Visual Discovery: decide how every scene concept will be drawn BEFORE narration is written. */
  const discoverFor = async (tag: string, graph: ConceptGraph, plan: TeachingPlan, sectionPrefix = ''): Promise<Record<string, VisualVocabulary>> => {
    const run = await runCached(`S3b-visual-discovery${tag}`, { graph, plan, catalog: enabledCatalogVersion(), domain: process.env.ASSET_USAGE_CONTEXT ?? 'production' }, 'claude-visual-discovery/v1', 'S3b-discovery-v3-vision-check', () => discoverVisualVocabulary({ plan, graph, model: modelFor('plan'), apiKey: m.apiKey, ...(m.visionModel ? { visionModel: m.visionModel } : {}), remainingBudgetUsd: budget(), ...(m.budgetLedger ? { budgetLedger: m.budgetLedger } : {}), ...(m.fetcher ? { fetcher: m.fetcher } : {}) }), 'S3b-visual-discovery-prompt-v1');
    addUsage(usage, run.result.usage); failures.push(...run.result.failures);
    Object.assign(validatedByConcept, run.result.validatedByConcept);
    for (const [sectionId, vocabulary] of Object.entries(run.result.vocabularies)) vocabularies[`${sectionPrefix}${sectionId}`] = { ...vocabulary, sceneId: `${sectionPrefix}${sectionId}` };
    return run.result.vocabularies;
  };

  const preparedResult = (extra: Partial<PreparedLesson>): PreparedLesson => ({ sourceDoc, groundingMode, ...(Object.keys(beatPlans).length ? { beatPlans, beatNarrations, beatNarrationContexts } : {}), ...(Object.keys(vocabularies).length ? { visualVocabularies: vocabularies, validatedByConcept } : {}), ...(sourceBundle ? { sourceBundle } : {}), usage, failures, rawResponses, cacheHits, stageArtifacts, stageRuns, ...extra });

  if (isSupportedLessonDuration(groundedRequest.targetDurationSec)) {
    const requestedDurationSec = groundedRequest.targetDurationSec;
    const syllabusRun = await runCached('S1-syllabus', { request: groundedRequest }, 'lesson-syllabus/v5', 'hierarchical-syllabus-v10-source-noun-referents', () => buildSyllabus(groundedRequest, { model: modelFor('syllabus'), apiKey: m.apiKey, remainingBudgetUsd: budget(), budgetLedger: m.budgetLedger, fetcher: m.fetcher }), 'S1-syllabus-prompt-v4-source-noun-referents');
    const syllabusResult = syllabusRun.result;
    addUsage(usage, syllabusResult.usage); failures.push(...syllabusResult.failures); rawResponses.syllabus = syllabusResult.rawResponses;
    if (!syllabusResult.value) return preparedResult({ requestedDurationSec });
    const syllabus = syllabusResult.value;
    const lessonTerminology = syllabus.concepts
      .map(({ label }) => label.trim())
      .filter((term, index, terms) => term.length > 0 && terms.indexOf(term) === index)
      .map((term) => ({ term }));
    const sufficiencyCheckedAt = new Date().toISOString();
    const sufficiencyFailure: StageFailure | undefined = syllabus.sourceSupport === 'insufficient' ? {
      code: 'source-insufficient-for-goal', stage: 'source',
      message: `Source cannot teach the requested core learning goal: ${syllabus.coverageReason}`,
      hard: true,
    } : undefined;
    const partialSupportWarning: StageFailure | undefined = syllabus.sourceSupport === 'partial' ? {
      code: 'source-support-limited-depth', stage: 'source',
      message: `Source supports a shorter lesson depth: ${syllabus.coverageReason}`,
      hard: false,
    } : undefined;
    stageRuns.push({ stage: 'S1-goal-sufficiency', kind: 'local', status: sufficiencyFailure ? 'failed' : 'completed', durationMs: 0, startedAt: sufficiencyCheckedAt, completedAt: sufficiencyCheckedAt, apiCostUsd: 0, cacheHit: false, fallbackCount: 0, failures: [sufficiencyFailure, partialSupportWarning].filter((failure): failure is StageFailure => Boolean(failure)) });
    if (sufficiencyFailure) {
      failures.push(sufficiencyFailure);
      return preparedResult({ syllabus, requestedDurationSec, plannedDurationSec: syllabus.plannedDurationSec, coverageReason: syllabus.coverageReason });
    }
    if (partialSupportWarning) failures.push(partialSupportWarning);
    if (m.budgetLedger) {
      const ledgerSpendBeforeSyllabus = Math.max(0, (await m.budgetLedger.snapshot()).spentUsd - usage.costUsd);
      effectiveBudgetUsd = Math.max(0, lessonCostCapUsd(syllabus.plannedDurationSec) - ledgerSpendBeforeSyllabus);
    } else effectiveBudgetUsd = lessonCostCapUsd(syllabus.plannedDurationSec);
    const allConcepts = new Map(syllabus.concepts.map((concept) => [concept.id, concept]));
    const moduleGraphs: ConceptGraph[] = [];
    const allSections: TeachingPlan['sections'] = [];
    const allScenes: Script['scenes'] = [];
    const completedModules: ModulePlan[] = [];
    const toScopedDoc = (spanIds: string[]): SourceDoc => {
      const selected = sourceDoc.spans.filter((span) => spanIds.includes(span.id));
      const text = selected.map((span) => span.text.trimEnd()).join('\n\n');
      return { ...sourceDoc, text, spans: selected, contentSha256: sha256(text), retrievalEvidence: sourceDoc.retrievalEvidence?.filter((hit) => spanIds.includes(hit.citation.spanId)), figureAssets: sourceDoc.figureAssets?.filter((figure) => selected.some((span) => {
        // A figure belongs to a module only when it comes from the same document as one of its spans.
        if ((span.citationSourceId ?? sourceDoc.sourceId) !== figure.sourceId) return false;
        if (figure.sourceLocation && JSON.stringify(span.sourceLocation) === JSON.stringify(figure.sourceLocation)) return true;
        if (figure.page && span.sourceLocation?.kind === 'pdf-page') return figure.page === span.sourceLocation.page;
        return span.sourceLocation?.kind === 'pptx-slide' && figure.page === span.sourceLocation.slide;
      })) };
    };
    let remainingModules = syllabus.modules.map((module) => ({ ...module }));
    let committedAudioDurationMs = 0;
    for (const [moduleIndex, module] of syllabus.modules.entries()) {
      const effectiveModule = remainingModules[moduleIndex] ?? module;
      const scopedSource = toScopedDoc(module.evidenceSpanIds);
      const scopedConcepts = module.conceptIds.map((id) => allConcepts.get(id)).filter((concept): concept is Syllabus['concepts'][number] => Boolean(concept));
      const moduleLabels = remainingModules.map((candidate, index) => `${index + 1}. ${candidate.title}: ${candidate.goal} (${candidate.budgetSec}s)`).join('\n');
      const moduleRequest: LessonRequest = { ...groundedRequest, source: scopedSource.text, sourceDoc: scopedSource, sourceBundle: undefined, targetDurationSec: effectiveModule.budgetSec, instruction: `Course objective: ${syllabus.learningObjective}\nFull course modules:\n${moduleLabels}\n\nCurrent module ${moduleIndex + 1}: ${module.title}. ${module.goal}\nEffective time budget: ${effectiveModule.budgetSec} seconds. Write narration with enough explanation to teach this module inside that budget; do not repeat or pad.\nUse only this module's assigned concepts; preserve global IDs and labels.`, conceptScope: scopedConcepts.map(({ id, label, definition }) => ({ id, label, definition })) };
      const moduleTag = `${String(moduleIndex + 1).padStart(2, '0')}-${module.id}`;
      const graphRun = await runCached(`S2-concepts:${moduleTag}`, { request: moduleRequest, syllabusConcepts: scopedConcepts }, 'claude-concept-graph/v1', 'S2-module-concept-graph-v7-exact-relation-participants', () => buildConceptGraph(moduleRequest, { model: modelFor('concepts'), apiKey: m.apiKey, remainingBudgetUsd: budget(), budgetLedger: m.budgetLedger, fetcher: m.fetcher }), 'S2-concept-graph-prompt-v5-exact-relation-participants');
      addUsage(usage, graphRun.result.usage); failures.push(...graphRun.result.failures); rawResponses[`concepts:${moduleTag}`] = graphRun.result.rawResponses;
      if (!graphRun.result.value) return preparedResult({ syllabus, modules: completedModules, requestedDurationSec, plannedDurationSec: syllabus.plannedDurationSec, coverageReason: syllabus.coverageReason });
      const rawGraph = graphRun.result.value;
      const graph: ConceptGraph = { ...rawGraph, concepts: rawGraph.concepts.map((concept) => {
        const syllabusConcept = allConcepts.get(concept.id);
        return syllabusConcept ? { ...concept, label: syllabusConcept.label, definition: syllabusConcept.definition, evidence: syllabusConcept.evidence } : concept;
      }) };
      const planRun = await runCached(`S3-teaching-plan:${moduleTag}`, { request: moduleRequest, graph, module }, 'claude-teaching-plan/v8', `S3-module-${DEFAULT_PLAN_PROMPT_VARIANT}-v16-canonical-relation-wording`, () => buildTeachingPlan(moduleRequest, graph, { model: modelFor('plan'), apiKey: m.apiKey, remainingBudgetUsd: budget(), budgetLedger: m.budgetLedger, fetcher: m.fetcher }), `S3-teaching-plan-prompt-${DEFAULT_PLAN_PROMPT_VARIANT}-v16-canonical-relation-wording`);
      addUsage(usage, planRun.result.usage); failures.push(...planRun.result.failures); rawResponses[`plan:${moduleTag}`] = planRun.result.rawResponses;
      if (!planRun.result.value) return preparedResult({ syllabus, graph, modules: completedModules, requestedDurationSec, plannedDurationSec: syllabus.plannedDurationSec, coverageReason: syllabus.coverageReason });
      const modulePlan = uniquifyClaimIds(planRun.result.value, lessonClaimIds);
      const analysis = analyzeTeachingPlan(modulePlan, graph);
      const contractFindings = teachingContractFindings(modulePlan, graph, groundedRequest.audience ?? 'general learner');
      for (const finding of contractFindings) failures.push({ code: finding.code, stage: 'plan', message: `${module.id}: ${finding.message}`, hard: true });
      for (const finding of analysis.findings) failures.push({ code: `${finding.code}:${finding.check}`, stage: 'plan', message: `${module.id}: ${finding.message}`, hard: finding.severity === 'error' });
      if (!analysis.ok || contractFindings.length) return preparedResult({ syllabus, graph, plan: modulePlan, analysis, modules: completedModules, requestedDurationSec, plannedDurationSec: syllabus.plannedDurationSec, coverageReason: syllabus.coverageReason });
      const sectionPrefix = `${moduleTag}_`;
      // Keep S3b in beat mode: it fixes approved library pictures before S4, and V2 locks those selections with scene concepts.
      const moduleVocabulary = await discoverFor(`:${moduleTag}`, graph, modulePlan, sectionPrefix);
      const beatRun = m.beats ? await runCached(`S3b-beats:${moduleTag}`, { request: moduleRequest, graph, plan: modulePlan, terminology: lessonTerminology, vocabulary: moduleVocabulary }, 'claude-beats/v10', 'S3b-beats-v17-bidirectional-anchor-repair', () => runBeatStages({ plan: modulePlan, graph, sourceDoc: scopedSource, terminology: lessonTerminology, visualVocabulary: moduleVocabulary }, { ...(m.speechLanguage ? { language: m.speechLanguage } : {}), model: modelFor('plan'), apiKey: m.apiKey, remainingBudgetUsd: budget(), ...(m.budgetLedger ? { budgetLedger: m.budgetLedger } : {}), ...(m.fetcher ? { fetcher: m.fetcher } : {}), ...(m.beatClient ? { client: m.beatClient } : {}) })) : undefined;
      const scriptRun = beatRun ? { result: { value: beatRun.result.value?.script, usage: beatRun.result.usage, failures: beatRun.result.failures, rawResponses: beatRun.result.rawResponses } } : await runCached(`S4-narration-script:${moduleTag}`, { request: moduleRequest, graph, plan: modulePlan, vocabulary: moduleVocabulary }, 'claude-script/v1', 'S4-module-script-v10-claim-semantics', () => writeScript(moduleRequest, graph, modulePlan, { visualVocabulary: moduleVocabulary, model: modelFor('script'), apiKey: m.apiKey, remainingBudgetUsd: budget(), budgetLedger: m.budgetLedger, fetcher: m.fetcher }));
      addUsage(usage, scriptRun.result.usage); failures.push(...scriptRun.result.failures); rawResponses[`script:${moduleTag}`] = scriptRun.result.rawResponses;
      if (!scriptRun.result.value) return preparedResult({ syllabus, graph, plan: modulePlan, modules: completedModules, requestedDurationSec, plannedDurationSec: syllabus.plannedDurationSec, coverageReason: syllabus.coverageReason });
      const prefixedSections = modulePlan.sections.map((section) => ({ ...section, id: `${sectionPrefix}${section.id}` }));
      const prefixedScenes = scriptRun.result.value.scenes.map((scene) => ({ ...scene, sectionId: `${sectionPrefix}${scene.sectionId}` }));
      allSections.push(...prefixedSections);
      allScenes.push(...prefixedScenes);
      moduleGraphs.push(graph);
      if (beatRun?.result.value) for (const id of Object.keys(beatRun.result.value.beatPlans)) {
        beatPlans[`${sectionPrefix}${id}`] = beatRun.result.value.beatPlans[id]!;
        beatNarrations[`${sectionPrefix}${id}`] = beatRun.result.value.narrations[id]!;
        beatNarrationContexts[`${sectionPrefix}${id}`] = beatRun.result.value.narrationContexts[id]!;
      }
      const completed: ModulePlan = { moduleId: module.id, title: module.title, goal: module.goal, budgetSec: effectiveModule.budgetSec, requestedBudgetSec: module.budgetSec, conceptIds: [...module.conceptIds], graph, plan: { ...modulePlan, sections: prefixedSections }, script: { scenes: prefixedScenes } };
      if (m.speechAligner) {
        const alignStartedAtMs = Date.now();
        const alignmentResults = await Promise.allSettled(prefixedScenes.map(async (scene) => {
          const sceneId = scene.sectionId;
          const audio = await synthesizeSceneAudio({ sceneId, text: parseMarkers(scene.text).plainText, language: m.speechLanguage ?? 'en', voice: m.speechVoice, calibrationMedianErrorMs: m.alignmentCalibrationMedianErrorMs }, { aligner: m.speechAligner, artifactStore: m.artifactStore });
          if (audio.artifact) stageArtifacts[sceneAudioStage(sceneId)] = audio.artifact;
          if (audio.cacheHit) cacheHits.push(sceneAudioStage(sceneId));
          return { sceneId, ...audio };
        }));
        const alignmentErrors = alignmentResults.flatMap((result, index) => result.status === 'rejected' ? [`${prefixedScenes[index]!.sectionId}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []);
        if (alignmentErrors.length) {
          stageRuns.push({ stage: `S5-module-audio:${moduleTag}`, kind: 'local', status: 'failed', durationMs: Date.now() - alignStartedAtMs, startedAt: new Date(alignStartedAtMs).toISOString(), completedAt: new Date().toISOString(), apiCostUsd: 0, cacheHit: false, fallbackCount: 0, failures: alignmentErrors.map((message) => ({ code: 'module-audio-generation-failed', stage: 'align', message, hard: true })) });
          failures.push(...alignmentErrors.map((message) => ({ code: 'module-audio-generation-failed', stage: 'align', message: `${module.id}: ${message}`, hard: true })));
          completedModules.push(completed);
          return preparedResult({ syllabus, modules: completedModules, requestedDurationSec, plannedDurationSec: syllabus.plannedDurationSec, coverageReason: syllabus.coverageReason });
        }
        const aligned = alignmentResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
        const timingProblems: string[] = [];
        const unusableDuration = aligned.some((scene) => !Number.isFinite(scene.durationMs) || scene.durationMs <= 0);
        let moduleAudioDurationMs = 0;
        for (const [sceneIndex, alignedScene] of aligned.entries()) {
          const expectedTokens = tokenizeWords(parseMarkers(prefixedScenes[sceneIndex]!.text).plainText);
          const actualTokens = alignedScene.words.flatMap((word) => tokenizeWords(word.word));
          if (expectedTokens.join('\u0000') !== actualTokens.join('\u0000')) timingProblems.push(`${alignedScene.sceneId}: aligned words do not match narration token sequence`);
          timingProblems.push(...alignedWordTimingProblems(alignedScene.words.map((word) => ({ w: word.word, startMs: word.startMs, endMs: word.endMs })), alignedScene.durationMs).map((problem) => `${alignedScene.sceneId}: ${problem}`));
          moduleAudioDurationMs += alignedScene.durationMs + (sceneIndex < aligned.length - 1 ? PIPELINE.sceneGapMs : 0);
        }
        completed.actualAudioDurationMs = moduleAudioDurationMs;
        stageRuns.push({ stage: `S5-module-audio:${moduleTag}`, kind: 'local', status: timingProblems.length ? 'failed' : 'completed', durationMs: Date.now() - alignStartedAtMs, startedAt: new Date(alignStartedAtMs).toISOString(), completedAt: new Date().toISOString(), apiCostUsd: 0, cacheHit: aligned.length > 0 && aligned.every((scene) => scene.cacheHit), fallbackCount: 0, failures: timingProblems.map((message) => ({ code: 'invalid-module-audio-timing', stage: 'align', message, hard: true })) });
        if (timingProblems.length) {
          failures.push(...timingProblems.map((message) => ({ code: 'invalid-module-audio-timing', stage: 'align', message: `${module.id}: ${message}`, hard: true })));
        }
        if (unusableDuration) {
          completedModules.push(completed);
          return preparedResult({ syllabus, modules: completedModules, requestedDurationSec, plannedDurationSec: syllabus.plannedDurationSec, coverageReason: syllabus.coverageReason });
        }
        committedAudioDurationMs += moduleAudioDurationMs + (moduleIndex > 0 ? PIPELINE.sceneGapMs : 0);
        if (moduleIndex < syllabus.modules.length - 1) {
          remainingModules = [
            ...remainingModules.slice(0, moduleIndex + 1),
            ...rebudgetUnwrittenModules(remainingModules.slice(moduleIndex + 1), syllabus.plannedDurationSec, committedAudioDurationMs),
          ];
        }
      }
      completedModules.push(completed);
    }
    const concepts = [...new Map(moduleGraphs.flatMap((graph) => graph.concepts).map((concept) => [concept.id, concept])).values()];
    const relations = [...new Map(moduleGraphs.flatMap((graph) => graph.relations).map((relation) => [stableJson({ from: relation.from, to: relation.to, type: relation.type }), relation])).values()];
    const globalGraph: ConceptGraph = { concepts: concepts.map((concept) => { const syllabusConcept = allConcepts.get(concept.id); return syllabusConcept ? { ...concept, label: syllabusConcept.label, definition: syllabusConcept.definition } : concept; }), relations, prerequisites: syllabus.prerequisites };
    const persistentConceptIds = syllabus.concepts.filter((concept) => allSections.filter((section) => section.conceptIds.includes(concept.id)).length > 1).map((concept) => concept.id);
    const globalBible = { audience: groundedRequest.audience ?? 'general learner', terminology: syllabus.concepts.map(({ id, label }) => ({ conceptId: id, label })), persistentConceptIds };
    const plan: TeachingPlan = { targetDurationSec: syllabus.plannedDurationSec, intro: completedModules[0]!.plan.intro, lessonBible: globalBible, sections: allSections, recap: { keyPoints: [syllabus.learningObjective, ...syllabus.modules.slice(-2).map((module) => module.goal)].slice(0, 6) } };
    return preparedResult({ syllabus, modules: completedModules, graph: globalGraph, plan, script: { scenes: allScenes }, requestedDurationSec, plannedDurationSec: syllabus.plannedDurationSec, coverageReason: syllabus.coverageReason });
  }

  const gRun = await runCached('S2-concepts', groundedRequest, 'claude-concept-graph/v1', 'S2-concept-graph-v10-exact-relation-participants', () => buildConceptGraph(groundedRequest, { model: modelFor('concepts'), apiKey: m.apiKey, remainingBudgetUsd: budget(), budgetLedger: m.budgetLedger, fetcher: m.fetcher }), 'S2-concept-graph-prompt-v5-exact-relation-participants');
  const g = gRun.result;
  addUsage(usage, g.usage); failures.push(...g.failures); rawResponses.concepts = g.rawResponses;
  if (!g.value) return preparedResult({});

  const pRun = await runCached('S3-teaching-plan', { request: groundedRequest, graph: g.value }, 'claude-teaching-plan/v8', `S3-teaching-plan-${DEFAULT_PLAN_PROMPT_VARIANT}-v16-canonical-relation-wording`, () => buildTeachingPlan(groundedRequest, g.value!, { model: modelFor('plan'), apiKey: m.apiKey, remainingBudgetUsd: budget(), budgetLedger: m.budgetLedger, fetcher: m.fetcher }), `S3-teaching-plan-prompt-${DEFAULT_PLAN_PROMPT_VARIANT}-v16-canonical-relation-wording`);
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

  const lessonVocabulary = await discoverFor('', g.value, p.value);
  const sRun = await runCached('S4-narration-script', { request: groundedRequest, graph: g.value, plan: p.value, vocabulary: lessonVocabulary }, 'claude-script/v1', 'S4-script-v9-claim-markers', () => writeScript(groundedRequest, g.value!, p.value!, { visualVocabulary: lessonVocabulary, model: modelFor('script'), apiKey: m.apiKey, remainingBudgetUsd: budget(), budgetLedger: m.budgetLedger, fetcher: m.fetcher }));
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
      ...(script.scenes[i].claimSpans ? { claimSpans: script.scenes[i].claimSpans } : {}),
      sceneContract: contract,
      lessonBible: plan.lessonBible!,
      ...(prepared.visualVocabularies?.[section.id] ? { visualVocabulary: prepared.visualVocabularies[section.id] } : {}),
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
  return { caseId, scenes, ...(prepared.validatedByConcept && Object.keys(prepared.validatedByConcept).length ? { validatedByConcept: prepared.validatedByConcept } : {}), targetDurationMs: plan.targetDurationSec * 1000, runClass: 'generated-lesson', sourceDoc, ...(prepared.sourceBundle ? { sourceBundle: prepared.sourceBundle } : {}), requestedDurationSec: prepared.requestedDurationSec ?? plan.targetDurationSec, plannedDurationSec: prepared.plannedDurationSec ?? plan.targetDurationSec, ...(prepared.coverageReason ? { coverageReason: prepared.coverageReason } : {}), ...(prepared.modules ? { modules: prepared.modules.map((module) => ({ id: module.moduleId, title: module.title, goal: module.goal, budgetSec: module.budgetSec, requestedBudgetSec: module.requestedBudgetSec, actualAudioDurationMs: module.actualAudioDurationMs, sceneIds: module.plan.sections.map((section) => section.id) })) } : {}), preflightAlignmentFailures: prepared.failures.filter((failure) => failure.stage === 'align'), stageRuns: prepared.stageRuns };
}
