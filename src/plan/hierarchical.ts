import { z } from 'zod';
import { anchorQuote, nearestSpanSentence } from './evidenceAnchor.js';
import type { SourceDoc, SourceEvidenceRef } from '../intake/sourceDoc.js';
import { spanExcerptPrompt } from '../intake/sourceDoc.js';
import type { LessonRequest, StageModel } from './stages.js';
import { structuredCall, type StructuredCallResult } from '../llm/structuredCall.js';
import type { PersistentBudgetLedger } from '../run/budgetLedger.js';
import { relationalGoalNeedsComponents, SYLLABUS_COMPONENT_GUIDANCE } from './goalShape.js';

import { clampText } from './clamp.js';
import { ledgerPreprocess, recordCoercion } from '../structured/coercionLedger.js';
import { isSupportedLessonDuration, LESSON_COST_CAP_USD, LESSON_DURATIONS_SEC, lessonCostCapUsd, type LessonDurationSec } from '../run/config.js';

export { clampText };
export { isSupportedLessonDuration, LESSON_COST_CAP_USD, LESSON_DURATIONS_SEC, lessonCostCapUsd, type LessonDurationSec };
export const SYLLABUS_CONCEPT_LABEL_MAX_WORDS = 4;
const id = z.string().min(1).max(40).regex(/^[a-z0-9_]+$/);
const EvidenceQuote = z.object({ spanId: id, quote: z.string().min(1).max(600) }).strict();

export const SyllabusSchema = z.object({
  requestedDurationSec: z.number().int().positive(),
  plannedDurationSec: z.number().int().positive(),
  coverageReason: z.string().min(1).max(240),
  sourceSupport: z.enum(['supported', 'partial', 'insufficient']),
  learningObjective: z.string().min(1).max(240),
  audienceAssumptions: z.array(z.string().min(1).max(120)).max(6),
  concepts: z.array(z.object({ id, label: z.string().min(1).max(80).refine((value) => value.trim().split(/\s+/).length <= SYLLABUS_CONCEPT_LABEL_MAX_WORDS), definition: z.string().min(1).max(240), evidence: z.array(EvidenceQuote).min(1).max(3) }).strict()).min(1).max(48),
  prerequisites: z.array(z.object({ concept: id, needs: id }).strict()).max(96),
  modules: z.array(z.object({ id, title: z.string().min(1).max(80), goal: z.string().min(1).max(240), budgetSec: z.number().int().positive(), conceptIds: z.array(id).min(1).max(8), evidenceSpanIds: z.array(id).min(1).max(48), recallOfModuleIds: z.array(id).max(6) }).strict()).min(1).max(6),
}).strict();

/**
 * Generated IDs are references, not evidence. Normalize the two common
 * spelling variants before strict schema and referential validation, while
 * leaving source span IDs and every factual field untouched. Collisions still
 * fail the uniqueness checks in validateSyllabus.
 */
function normalizeGeneratedId(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  // Same mapping for every reference to an id (concepts, prerequisites, modules), so references stay consistent:
  // lowercase, any run of other characters becomes one underscore, capped at the schema's 40 characters.
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/_+$/g, '');
  return slug || value;
}

const LABEL_FILLER = new Set(['a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'and', 'with', 'by']);
/** A display label over the word limit loses its filler words first, then trailing words; a label is a term, not evidence. */
export function normalizeConceptLabel(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const all = value.trim().split(/\s+/);
  if (all.length <= SYLLABUS_CONCEPT_LABEL_MAX_WORDS) return value;
  const content = all.filter((word) => !LABEL_FILLER.has(word.toLowerCase()));
  return (content.length >= 2 ? content : all).slice(0, SYLLABUS_CONCEPT_LABEL_MAX_WORDS).join(' ');
}

export const SyllabusOutputSchema = ledgerPreprocess('syllabus-normalize', (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  return {
    ...raw,
    coverageReason: clampText(raw.coverageReason, 240),
    learningObjective: clampText(raw.learningObjective, 240),
    concepts: Array.isArray(raw.concepts) ? raw.concepts.map((item) => item && typeof item === 'object' && !Array.isArray(item) ? { ...item, id: normalizeGeneratedId((item as Record<string, unknown>).id), label: normalizeConceptLabel((item as Record<string, unknown>).label), definition: clampText((item as Record<string, unknown>).definition, 240) } : item) : raw.concepts,
    prerequisites: Array.isArray(raw.prerequisites) ? raw.prerequisites.map((item) => item && typeof item === 'object' && !Array.isArray(item) ? { ...item, concept: normalizeGeneratedId((item as Record<string, unknown>).concept), needs: normalizeGeneratedId((item as Record<string, unknown>).needs) } : item) : raw.prerequisites,
    modules: Array.isArray(raw.modules) ? raw.modules.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const module = item as Record<string, unknown>;
      return { ...module, title: clampText(module.title, 80), goal: clampText(module.goal, 240), id: normalizeGeneratedId(module.id), conceptIds: Array.isArray(module.conceptIds) ? module.conceptIds.map(normalizeGeneratedId) : module.conceptIds, recallOfModuleIds: Array.isArray(module.recallOfModuleIds) ? module.recallOfModuleIds.map(normalizeGeneratedId) : [] };
    }) : raw.modules,
  };
}, SyllabusSchema);

export type SyllabusModel = z.infer<typeof SyllabusSchema>;
export interface Syllabus extends Omit<SyllabusModel, 'concepts'> {
  concepts: Array<Omit<SyllabusModel['concepts'][number], 'evidence'> & { evidence: SourceEvidenceRef[] }>;
}

export interface ModulePlan {
  moduleId: string;
  title: string;
  goal: string;
  /** Effective target used to write this module; can shift after earlier audio is measured. */
  budgetSec: number;
  /** Syllabus allocation before audio-master re-budgeting. */
  requestedBudgetSec?: number;
  /** Measured narration plus inter-scene gaps for this module. */
  actualAudioDurationMs?: number;
  conceptIds: string[];
  graph: import('./schemas.js').ConceptGraph;
  plan: import('./schemas.js').TeachingPlan;
  script: import('./schemas.js').Script;
}

/**
 * Keep the complete, exact source text available to S1 without repeating the
 * retrieval snippets and figure metadata already represented in that text.
 * S1 only needs stable span IDs and ranges to choose source evidence; resolved
 * citations are attached from the full SourceDoc after schema validation.
 */
export function syllabusSourcePrompt(doc: SourceDoc): string {
  // Full text and a compact index are cheapest for short sources. For papers,
  // pair each exact excerpt with its span ID: a detached full-text/index pair
  // makes quote-to-span mistakes common and repeats a huge PDF on repair.
  if (doc.text.length > 12_000) {
    const textBudget = 48_000;
    const excerptLimit = 1_800;
    const selected = new Set<string>();
    const candidates: typeof doc.spans = [];
    const add = (span: typeof doc.spans[number] | undefined) => {
      if (span && !selected.has(span.id)) { selected.add(span.id); candidates.push(span); }
    };
    const substantive = doc.spans.filter((span) => span.kind !== 'heading' && span.kind !== 'figure' && span.text.trim().length >= 80);
    for (const span of substantive.slice(0, 5)) add(span);
    const byId = new Map(doc.spans.map((span) => [span.id, span]));
    for (const hit of doc.retrievalEvidence ?? []) if (hit.text.trim().length >= 80) add(byId.get(hit.citation.spanId));
    for (const span of substantive.slice(-3)) add(span);
    for (let i = 0; i < Math.min(36, substantive.length); i++) add(substantive[Math.floor(i * substantive.length / Math.min(36, substantive.length))]);
    for (const span of substantive) add(span);
    return spanExcerptPrompt(doc, { spans: candidates, maxChars: textBudget, perSpanChars: excerptLimit, minChars: 80 });
  }
  const spanIndex = doc.spans.map(({ id, kind, startChar, endChar, startLine, endLine, citationSourceId, sourceTitle, sourceLocation }) => ({
    id, kind, startChar, endChar, startLine, endLine,
    ...(citationSourceId ? { citationSourceId } : {}),
    ...(sourceTitle ? { sourceTitle } : {}),
    ...(sourceLocation ? { sourceLocation } : {}),
  }));
  return JSON.stringify({
    schemaVersion: doc.schemaVersion,
    sourceId: doc.sourceId,
    format: doc.format,
    ...(doc.title ? { title: doc.title } : {}),
    ...(doc.sourceUrl ? { sourceUrl: doc.sourceUrl } : {}),
    text: doc.text,
    spanIndex,
  });
}

export function syllabusSystemPrompt(allowedDurations: readonly number[]): string {
  return `Create a source-grounded teaching syllabus for one narrated lesson. Return a single JSON object matching the schema. Set sourceSupport to supported when the source explains the learner's core goal at the requested depth, partial when it supports the core goal but only at a shallower depth, and insufficient when it does not explain the core goal. A title, table of contents, index, or list of topics that merely names the goal is insufficient. For insufficient support, explain the missing evidence in coverageReason; do not replace the learner's goal with a lesson about what the document lists. Select the deepest supported duration from ${allowedDurations.join(', ')} seconds; partial support must select a shorter duration and explain why in coverageReason. Do not repeat concepts merely to fill time. Support is judged on the text: a figure, diagram or table you cannot see never lowers support when the text names its parts and relations (teach the figure from those words). A scene needs roughly 18 seconds and about two distinct ideas, so when the SOURCE SIZE line shows at least requested-seconds/20 substantive paragraphs, the requested duration is normally supported; choose a shorter duration only when the learner's core goal truly cannot be explained at that depth from the text.

Use 1 module of 60 seconds for a 1-minute lesson; 1 module of 300 seconds for 5 minutes; 2 modules of 300 seconds for 10 minutes; 6 modules of 300 seconds for 30 minutes. Each module has a distinct goal and 1-8 stable global concept IDs. Use lowercase snake_case generated IDs such as concept_1 and module_1, never hyphens; copy those same IDs into every reference. Source span IDs must be copied exactly. Each concept label must contain at most ${SYLLABUS_CONCEPT_LABEL_MAX_WORDS} words; use a concise name, not a sentence. Concepts include an exact source-backed definition and 1-3 verbatim evidence quotes. Copy each quote as one contiguous substring of the cited span's text; do not paraphrase, splice, or use ellipses. Prefer one plain sentence or clause of at most 200 characters made of ordinary words; never quote equations, symbols or figure fragments that the text extraction may have split. When the source is supplied as labeled excerpts, cite only those displayed spans. ${SYLLABUS_COMPONENT_GUIDANCE} Prerequisites must occur in an earlier module or earlier within the same module concept list. Use recallOfModuleIds only for explicit spaced retrieval, never to pad. Module evidenceSpanIds must cover the concepts taught there. Include audience assumptions, progression, and a final synthesis module. Math lessons should reserve scenes for worked examples or derivations when supported. IDs and labels stay stable across every module. Every fact and requested depth must be supported by the provided source; a figure caption or figure metadata alone cannot justify a numerical fact.`;
}

/**
 * Reallocate the remaining course clock after a completed module has real audio.
 * Previously written modules are immutable. Remaining modules share the remaining
 * time in proportion to their syllabus budgets, with a 60-second floor so a
 * module is never squeezed into a non-teaching fragment. The final video clock
 * remains the measured audio clock if that floor causes an overrun.
 */
export function rebudgetUnwrittenModules<T extends { budgetSec: number }>(
  unwritten: readonly T[],
  lessonTargetDurationSec: number,
  committedAudioDurationMs: number,
): Array<T & { budgetSec: number }> {
  if (!Number.isFinite(lessonTargetDurationSec) || lessonTargetDurationSec <= 0) throw new Error('lesson target duration must be positive');
  if (!Number.isFinite(committedAudioDurationMs) || committedAudioDurationMs < 0) throw new Error('committed audio duration must be non-negative');
  if (!unwritten.length) return [];
  if (unwritten.some((module) => !Number.isFinite(module.budgetSec) || module.budgetSec <= 0)) throw new Error('unwritten module budgets must be positive');
  const currentBudgetTotal = unwritten.reduce((sum, module) => sum + module.budgetSec, 0);
  const remainingTargetSec = Math.max(60 * unwritten.length, lessonTargetDurationSec - committedAudioDurationMs / 1000);
  const raw = unwritten.map((module) => remainingTargetSec * module.budgetSec / currentBudgetTotal);
  const budgets = raw.map((value) => Math.max(60, Math.floor(value)));
  // Assign rounding remainder to the last module, preserving the exact available budget.
  const roundedTotal = budgets.reduce((sum, value) => sum + value, 0);
  budgets[budgets.length - 1] += Math.round(remainingTargetSec) - roundedTotal;
  // A rounding correction must not take the final module below the teaching floor.
  if (budgets[budgets.length - 1] < 60) {
    const deficit = 60 - budgets[budgets.length - 1];
    budgets[budgets.length - 1] = 60;
    let left = deficit;
    for (let i = budgets.length - 2; i >= 0 && left > 0; i--) {
      const reducible = Math.max(0, budgets[i] - 60);
      const take = Math.min(left, reducible);
      budgets[i] -= take;
      left -= take;
    }
  }
  return unwritten.map((module, index) => ({ ...module, budgetSec: budgets[index] }));
}

export function moduleBudgetShape(durationSec: number): number[] | undefined {
  if (!isSupportedLessonDuration(durationSec)) return undefined;
  if (durationSec === 60) return [60];
  if (durationSec === 300) return [300];
  if (durationSec === 600) return [300, 300];
  if (durationSec === 1800) return Array(6).fill(300) as number[];
  if (durationSec === 3600) return Array(6).fill(600) as number[];
  const count = Math.ceil(durationSec / 600);
  const base = Math.floor(durationSec / count);
  const remainder = durationSec % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function validateSyllabus(syllabus: SyllabusModel, requestedDurationSec: number, learnerGoal?: string): string[] {
  const problems: string[] = [];
  if (!moduleBudgetShape(requestedDurationSec)) return ['duration must be a whole number of seconds between 60 and 3600'];
  if (syllabus.requestedDurationSec !== requestedDurationSec) problems.push(`requestedDurationSec must be ${requestedDurationSec}`);
  if (!moduleBudgetShape(syllabus.plannedDurationSec) || syllabus.plannedDurationSec > requestedDurationSec) problems.push('plannedDurationSec must be a supported duration no greater than the request');
  if (syllabus.sourceSupport === 'supported' && syllabus.plannedDurationSec !== requestedDurationSec) problems.push('supported source support must cover the full requested duration');
  if (syllabus.sourceSupport === 'partial' && syllabus.plannedDurationSec >= requestedDurationSec) problems.push('partial source support must select a shorter supported duration');
  if (syllabus.modules.reduce((sum, module) => sum + module.budgetSec, 0) !== syllabus.plannedDurationSec) problems.push('module budgets must sum exactly to plannedDurationSec');
  const expected = moduleBudgetShape(syllabus.plannedDurationSec);
  if (expected && (expected.length !== syllabus.modules.length || expected.some((budget, index) => syllabus.modules[index]?.budgetSec !== budget))) problems.push(`module budgets must follow ${expected.join('+')} seconds for the selected duration`);
  const concepts = new Map(syllabus.concepts.map((concept) => [concept.id, concept]));
  if (concepts.size !== syllabus.concepts.length) problems.push('syllabus concept IDs must be unique');
  if (relationalGoalNeedsComponents(learnerGoal)) {
    if (concepts.size < 2) problems.push('the learner goal requires distinct interacting or contrasting source concepts, but the syllabus has fewer than two concepts');
    else if (!syllabus.modules.some((module) => new Set(module.conceptIds).size >= 2)) problems.push('the learner goal requires related components to be taught together, but no module contains multiple concepts');
  }
  const moduleIds = new Set(syllabus.modules.map((module) => module.id));
  const moduleIndexById = new Map(syllabus.modules.map((module, index) => [module.id, index]));
  if (moduleIds.size !== syllabus.modules.length) problems.push('module IDs must be unique');
  for (const [index, module] of syllabus.modules.entries()) {
    for (const conceptId of module.conceptIds) if (!concepts.has(conceptId)) problems.push(`module ${module.id} references unknown concept ${conceptId}`);
    if (new Set(module.conceptIds).size !== module.conceptIds.length) problems.push(`module ${module.id} repeats a concept ID`);
    for (const recallId of module.recallOfModuleIds) {
      const recallIndex = moduleIndexById.get(recallId);
      if (!moduleIds.has(recallId) || recallIndex === undefined || recallIndex >= index) problems.push(`module ${module.id} has invalid recall target ${recallId}; recall targets must be earlier modules`);
    }
    if (index > 0) {
      const repeatedConcepts = module.conceptIds.filter((id) => syllabus.modules.slice(0, index).some((prior) => prior.conceptIds.includes(id)));
      if (repeatedConcepts.length && !module.recallOfModuleIds.length) problems.push(`module ${module.id} repeats prior concepts without a spaced-recall purpose`);
      const recalledConcepts = new Set(module.recallOfModuleIds.flatMap((recallId) => {
        const recallIndex = moduleIndexById.get(recallId);
        return recallIndex === undefined || recallIndex >= index ? [] : syllabus.modules[recallIndex]!.conceptIds;
      }));
      for (const conceptId of repeatedConcepts) if (!recalledConcepts.has(conceptId)) problems.push(`module ${module.id} repeats ${conceptId} without recalling a prior module that teaches it`);
    }
    if (new Set(module.evidenceSpanIds).size !== module.evidenceSpanIds.length) problems.push(`module ${module.id} repeats an evidence span ID`);
  }
  const covered = new Set(syllabus.modules.flatMap((module) => module.conceptIds));
  for (const conceptId of concepts.keys()) if (!covered.has(conceptId)) problems.push(`syllabus concept ${conceptId} is not assigned to any module`);
  if (new Set(syllabus.modules.map((module) => module.goal.trim().toLocaleLowerCase())).size !== syllabus.modules.length) problems.push('each module must have a distinct teaching goal');
  for (const prerequisite of syllabus.prerequisites) {
    if (!concepts.has(prerequisite.concept) || !concepts.has(prerequisite.needs)) problems.push(`prerequisite ${prerequisite.concept}<-${prerequisite.needs} references an unknown concept`);
    if (prerequisite.concept === prerequisite.needs) problems.push(`concept ${prerequisite.concept} cannot be its own prerequisite`);
    const teachingModule = syllabus.modules.findIndex((module) => module.conceptIds.includes(prerequisite.concept));
    const prerequisiteModule = syllabus.modules.findIndex((module) => module.conceptIds.includes(prerequisite.needs));
    if (teachingModule >= 0 && prerequisiteModule > teachingModule) problems.push(`${prerequisite.concept} appears before prerequisite ${prerequisite.needs}`);
    if (teachingModule >= 0 && prerequisiteModule === teachingModule) {
      const module = syllabus.modules[teachingModule]!;
      if (module.conceptIds.indexOf(prerequisite.needs) > module.conceptIds.indexOf(prerequisite.concept)) problems.push(`${prerequisite.concept} appears before prerequisite ${prerequisite.needs} inside module ${module.id}`);
    }
  }
  return [...new Set(problems)];
}

export async function buildSyllabus(req: LessonRequest, model: StageModel, ledger?: PersistentBudgetLedger): Promise<StructuredCallResult<Syllabus>> {
  const sourceDoc: SourceDoc = req.sourceDoc!;
  const requested = req.targetDurationSec;
  const allowed = [...new Set([...LESSON_DURATIONS_SEC.filter((duration) => duration <= requested), requested])].sort((a, b) => a - b);
  const activeLedger = ledger ?? model.budgetLedger;
  const ledgerSpend = activeLedger ? (await activeLedger.snapshot()).spentUsd : 0;
  // The syllabus itself must fit the minimum possible planned-duration cap. The
  // selected longer plan can spend more on its later bounded module calls.
  const syllabusAllowanceUsd = Math.min(model.remainingBudgetUsd, Math.max(0, LESSON_COST_CAP_USD[60] - ledgerSpend));
  const system = syllabusSystemPrompt(allowed);
  const substantiveParagraphs = sourceDoc.spans.filter((span) => span.kind !== 'heading' && span.kind !== 'figure' && span.text.trim().length >= 80).length;
  const user = `Requested duration: ${requested}s\nSOURCE SIZE: ${sourceDoc.text.split(/\s+/).filter(Boolean).length} words in ${substantiveParagraphs} substantive paragraphs\nLearner request: ${req.instruction ?? 'Teach the central ideas in this source.'}\nAudience: ${req.audience ?? 'general learner'}\n\nSOURCE AND CITATION INDEX (exact source text and compact span index):\n${syllabusSourcePrompt(sourceDoc)}`;
  let quotesAsked = false;
  const snapped: string[] = [];
  const result = await structuredCall({ stage: 'syllabus', subject: 'lesson syllabus', model: model.model, apiKey: model.apiKey, system, user, schema: SyllabusOutputSchema, schemaName: 'lesson_syllabus', maxRepairs: 2, maxTokens: Math.min(12000, 4000 + Math.max(1, allowed.length) * 1500), remainingBudgetUsd: syllabusAllowanceUsd, budgetLedger: activeLedger, fetcher: model.fetcher,
    validate: (raw) => {
      // Only explicit learner instructions impose this structural gate. A
      // generated objective can overstate the requested scope and should not
      // be used to reject an otherwise valid syllabus.
      const problems = validateSyllabus(raw, requested, req.instruction);
      // The model is asked about an unanchorable quote once; if it is still unanchorable on a later pass, the cited span's
      // closest sentence is cited instead (verbatim source text) and the snap is recorded.
      if (quotesAsked) {
        raw.concepts.forEach((concept, conceptIndex) => concept.evidence.forEach((evidence, evidenceIndex) => {
          if (anchorQuote(sourceDoc, evidence.spanId, evidence.quote)) return;
          const sentence = nearestSpanSentence(sourceDoc, evidence.spanId, `${evidence.quote} ${concept.label} ${concept.definition}`);
          if (sentence) {
            recordCoercion({ path: `/concepts/${conceptIndex}/evidence/${evidenceIndex}/quote`, oldValue: evidence.quote, newValue: sentence, reason: 'syllabus-evidence-snapped', semanticRisk: 'semantic' });
            evidence.quote = sentence; snapped.push(concept.id);
          }
        }));
      }
      if (raw.concepts.some((concept) => concept.evidence.some((evidence) => !anchorQuote(sourceDoc, evidence.spanId, evidence.quote)))) quotesAsked = true;
      for (const concept of raw.concepts) for (const evidence of concept.evidence) if (!anchorQuote(sourceDoc, evidence.spanId, evidence.quote)) problems.push(`concept ${concept.id} evidence quote is absent from source span ${evidence.spanId}`);
      for (const module of raw.modules) {
        if (module.evidenceSpanIds.some((spanId) => !sourceDoc.spans.some((span) => span.id === spanId))) problems.push(`module ${module.id} contains an unknown evidence span ID`);
        for (const conceptId of module.conceptIds) {
          const concept = raw.concepts.find((candidate) => candidate.id === conceptId);
          if (concept) for (const ref of concept.evidence) if (!module.evidenceSpanIds.includes(ref.spanId)) problems.push(`module ${module.id} omits syllabus evidence ${ref.spanId} for concept ${conceptId}`);
        }
      }
      return [...new Set(problems)];
    },
  });
  if (!result.value) return result as unknown as StructuredCallResult<Syllabus>;
  if (snapped.length) result.failures.push({ code: 'syllabus-evidence-snapped', stage: 'syllabus', message: `evidence for ${[...new Set(snapped)].join(', ')} was snapped to the nearest verbatim sentence of the cited span after the model's quote could not be anchored`, hard: false });
  return { ...result, value: { ...result.value, concepts: result.value.concepts.map(({ evidence, ...concept }) => ({ ...concept, evidence: evidence.map((ref) => anchorQuote(sourceDoc, ref.spanId, ref.quote)!.ref) })) } };
}
