import type { Element, SceneSpec, StageFailure } from '../shared/types.js';
import { SceneSpecSchema, safeParseSceneSpec, validateSceneSpecStructure } from '../shared/schema.js';
import { structuredCall, type CallUsage, type StructuredCallAttemptRecord } from '../llm/structuredCall.js';
import { buildScenePlannerPrompt, type PlannerSceneInput } from './prompt.js';
import { MAX_ELEMENTS_PER_SCENE, MAX_LABEL_WORDS, MAX_TITLE_WORDS } from '../render/style.js';
import type { PersistentBudgetLedger } from '../run/budgetLedger.js';
import { unsupportedNumericClaims } from '../validate/numericClaims.js';
import { visualClaimCoverageFailures } from '../validate/gates.js';
import { TEMPLATE_SPECS } from '../layout/templates/catalog.js';

/**
 * S6 — Scene Planner (claude_pipeline.md §6/§9): strongest affordable model,
 * zod + structural validation, exactly one repair, then the §9 deterministic
 * fallback — a `list_icon` scene built from the scene's own mentions — so a
 * scene is never empty. A fallback is always visible: counted in
 * `usage.fallbacks` and recorded as a `planner-fallback` failure.
 */
export type PlannerCallUsage = CallUsage & { fallbacks: number };

export interface PlanSceneResult {
  spec?: SceneSpec;
  usage: PlannerCallUsage;
  failures: StageFailure[];
  rawResponses: StructuredCallAttemptRecord[];
  fallback: boolean;
}

export interface PlanSceneOptions {
  model: string;
  apiKey: string;
  maxTokens?: number;
  /** Thinking effort for Anthropic planners (default 'medium': scene design needs some deliberation, not 3k tokens of it). */
  effort?: 'low' | 'medium' | 'high';
  remainingBudgetUsd: number;
  budgetLedger?: PersistentBudgetLedger;
  /** Test seam for deterministic planner-contract tests; production defaults to global fetch. */
  fetcher?: typeof fetch;
  /** Build the §9 deterministic fallback scene after a failed repair (default true). */
  fallback?: boolean;
  signal?: AbortSignal;
  /** Exact code-compiled prompt already captured in the S6 artifact log. */
  compiledPrompt?: { system: string; user: string };
}

const normalizeFact = (value: string): string => value.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}.%+-]+/gu, ' ').trim();

function renderedText(spec: SceneSpec): string[] {
  const values = [spec.title];
  for (const element of spec.elements) {
    values.push(element.label ?? '');
    if ('text' in element && element.text) values.push(element.text);
    // The icon name is drawn only when the object has no label (layout/measure.ts, catalog/ladder.ts).
    if (element.prim === 'object' && !element.label) values.push(element.concept);
    if (element.prim === 'container') values.push(...element.children);
    if (element.prim === 'tokenStrip') values.push(...element.tokens);
    if (element.prim === 'meter') values.push(...(element.labels ?? []));
    if (element.prim === 'matrix') values.push(...element.rows.flat());
    if (element.prim === 'formula') values.push(element.latex ?? '', ...(element.parts?.map((part) => part.tex) ?? []));
    if (element.prim === 'code') values.push(element.source);
    if (element.prim === 'plot') values.push(element.xLabel ?? '', element.yLabel ?? '', ...(element.markers?.map((marker) => marker.label ?? '') ?? []));
    if (element.prim === 'numberLine') values.push(...(element.points?.map((point) => point.label ?? '') ?? []));
    if (element.prim === 'shape') values.push(...(element.sideLabels ?? []));
  }
  for (const edge of spec.edges) values.push(edge.label ?? '');
  return values.filter(Boolean);
}

function terminologyText(element: Element): string[] {
  const values = [element.label ?? ''];
  if ('text' in element && element.text) values.push(element.text);
  switch (element.prim) {
    case 'object': if (!element.label) values.push(element.concept); break;
    case 'tokenStrip': values.push(...element.tokens); break;
    case 'meter': values.push(...(element.labels ?? [])); break;
    case 'matrix': values.push(...element.rows.flat()); break;
    case 'formula': values.push(element.latex ?? '', ...(element.parts?.map((part) => part.tex) ?? [])); break;
    case 'code': values.push(element.source); break;
    case 'plot': values.push(element.xLabel ?? '', element.yLabel ?? '', ...(element.markers?.map((marker) => marker.label ?? '') ?? [])); break;
    case 'numberLine': values.push(...(element.points?.map((point) => point.label ?? '') ?? [])); break;
    case 'shape': values.push(...(element.sideLabels ?? [])); break;
  }
  return values.filter(Boolean);
}

function normalizeTerm(value: string): string {
  return value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function persistentTerminologyProblems(spec: SceneSpec, input: PlannerSceneInput): string[] {
  const bible = input.planningContext?.lessonBible;
  if (!input.teachingContext?.requireEvidence || !bible) return [];
  const persistent = new Set(bible.persistentConceptIds);
  const visibleConceptIds = new Set(spec.elements.flatMap((element) => element.conceptIds ?? []).filter((id) => persistent.has(id)));
  const problems: string[] = [];
  for (const conceptId of visibleConceptIds) {
    const canonical = bible.terminology.find((term) => term.conceptId === conceptId)?.label;
    if (!canonical) {
      problems.push(`persistent concept ${conceptId} has no canonical terminology in the LessonBible`);
      continue;
    }
    const expected = normalizeTerm(canonical);
    const linkedText = spec.elements.filter((element) => element.conceptIds?.includes(conceptId)).flatMap(terminologyText).map(normalizeTerm);
    if (!linkedText.some((text) => ` ${text} `.includes(` ${expected} `))) {
      problems.push(`persistent concept ${conceptId} must visibly use its canonical term "${canonical}"`);
    }
  }
  return problems;
}

function numericFacts(value: unknown, output: Set<string> = new Set()): Set<string> {
  if (typeof value === 'number' && Number.isFinite(value)) output.add(String(value));
  else if (Array.isArray(value)) value.forEach((item) => numericFacts(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => numericFacts(item, output));
  return output;
}

function sceneNumericValues(spec: SceneSpec): string[] {
  const values = [...renderedText(spec)];
  const add = (value: unknown) => { for (const number of numericFacts(value)) values.push(number); };
  for (const element of spec.elements) {
    switch (element.prim) {
      case 'meter': add(element.values); break;
      case 'object': add(element.count); break;
      case 'stack': add(element.count); break;
      case 'plot': add([element.params, element.domain, element.markers?.map((marker) => marker.x), element.tangentAt, element.trajectory, element.riseRun]); break;
      case 'numberLine': add([element.min, element.max, element.points?.map((point) => point.x), element.interval]); break;
      case 'axis': add(element.points); break;
      case 'hill': add([element.peaks, element.marker]); break;
      default: break;
    }
  }
  return values;
}

function visualNumericProblems(spec: SceneSpec, input: PlannerSceneInput): string[] {
  if (!input.teachingContext?.requireEvidence) return [];
  const problems: string[] = [];
  const titleValues = unsupportedNumericClaims([spec.title], spec.titleEvidenceRefs?.map((ref) => ref.quote) ?? []);
  if (spec.titleOrigin !== 'illustrative-example') for (const value of titleValues) problems.push(`scene title numeric value "${value}" is not supported by its cited evidence; remove it or cite an exact source span that contains it`);
  for (const element of spec.elements) {
    if (element.origin === 'illustrative-example') continue;
    const unsupported = unsupportedNumericClaims(sceneNumericValues({ ...spec, title: '', elements: [element], edges: [] }), element.evidenceRefs?.map((ref) => ref.quote) ?? []);
    for (const value of unsupported) problems.push(`element ${element.id} numeric value "${value}" is not supported by its cited evidence; remove it or cite an exact source span that contains it`);
  }
  for (const [index, edge] of spec.edges.entries()) {
    if (edge.origin === 'illustrative-example') continue;
    const unsupported = unsupportedNumericClaims([edge.label ?? ''], edge.evidenceRefs?.map((ref) => ref.quote) ?? []);
    for (const value of unsupported) problems.push(`edge ${index} numeric value "${value}" is not supported by its cited evidence; remove it or cite an exact source span that contains it`);
  }
  return problems;
}

/** Reject distinctive example facts copied into a generated scene unless the target source independently supports them. */
export function exemplarCopyProblems(spec: SceneSpec, input: PlannerSceneInput): string[] {
  const examples = input.planningContext?.examples ?? [];
  if (!examples.length) return [];
  const targetEvidence = [
    ...(input.teachingContext?.sourceEvidenceRefs ?? []).map((ref) => ref.quote),
    ...(input.teachingContext?.concepts ?? []).flatMap((concept) => [concept.label, concept.definition, ...concept.evidenceRefs.map((ref) => ref.quote)]),
    ...(input.teachingContext?.relations ?? []).flatMap((relation) => relation.evidenceRefs.map((ref) => ref.quote)),
  ].map(normalizeFact).filter(Boolean).join(' ');
  const targetEvidenceTokens = new Set(targetEvidence.split(/\s+/));
  const outputFacts = renderedText(spec).map(normalizeFact).filter(Boolean);
  const examplePhrases = new Set<string>();
  const exampleNumbers = new Set<string>();
  for (const { exemplar } of examples) {
    for (const phrase of renderedText(exemplar.sceneSpec)) {
      const fact = normalizeFact(phrase);
      if (fact.split(' ').some((word) => word.length >= 6) || fact.split(' ').length >= 2) examplePhrases.add(fact);
    }
    numericFacts(exemplar.sceneSpec, exampleNumbers);
  }
  const problems: string[] = [];
  for (const fact of examplePhrases) {
    if (outputFacts.some((output) => ` ${output} `.includes(` ${fact} `)) && !` ${targetEvidence} `.includes(` ${fact} `)) {
      problems.push(`scene copies unsupported exemplar fact "${fact}"`);
    }
  }
  const outputNumbers = numericFacts(spec);
  for (const number of exampleNumbers) {
    if (outputNumbers.has(number) && !targetEvidenceTokens.has(normalizeFact(number))) {
      problems.push(`scene copies unsupported exemplar value "${number}"`);
    }
  }
  return problems;
}

/** Semantic checks the zod shape cannot express: sceneId, structure, and that every mention anchor names a real mention. */
export function plannerProblems(spec: SceneSpec, input: PlannerSceneInput): string[] {
  const problems: string[] = [];
  problems.push(...exemplarCopyProblems(spec, input));
  problems.push(...visualNumericProblems(spec, input));
  problems.push(...persistentTerminologyProblems(spec, input));
  if (spec.sceneId !== input.sceneId) problems.push(`sceneId must be exactly "${input.sceneId}", got "${spec.sceneId}"`);
  for (const issue of validateSceneSpecStructure(spec)) problems.push(`[${issue.code}] ${issue.message}`);
  // The selectable legacy SceneSpec planner has no BoardIntent sidecar, so its
  // typed topologies must satisfy the same visible-slot contract directly.
  const requiredSlots = TEMPLATE_SPECS[spec.template].requiredSlots ?? [];
  if (['hierarchy_tree', 'decision_tree', 'timeline', 'rule_exception', 'claim_evidence'].includes(spec.template)) {
    const representedSlots = new Set(spec.elements.filter((element) => (element.conceptIds?.length ?? 0) > 0).map((element) => element.slot));
    const missingSlots = requiredSlots.filter(({ slot }) => !representedSlots.has(slot));
    if (missingSlots.length) problems.push(`${spec.template} scene is missing ${missingSlots.map(({ explanation }) => explanation).join(', ')} in source-linked element slots`);
  }
  const mentionIds = new Set(input.mentions.map((m) => m.id));
  const allowedEvidence = input.teachingContext?.sourceEvidenceRefs ?? [];
  const sameEvidence = (left: (typeof allowedEvidence)[number], right: (typeof allowedEvidence)[number]) =>
    left.sourceId === right.sourceId && left.spanId === right.spanId && left.startChar === right.startChar && left.endChar === right.endChar &&
    left.startLine === right.startLine && left.endLine === right.endLine && left.quote === right.quote &&
    JSON.stringify(left.sourceLocation ?? null) === JSON.stringify(right.sourceLocation ?? null);
  const validEvidence = (refs: typeof allowedEvidence | undefined) => {
    const evidence = refs ?? [];
    return evidence.length > 0 && evidence.every((ref) =>
      allowedEvidence.some((allowed) => sameEvidence(allowed, ref)));
  };
  const evidenceMatches = (refs: typeof allowedEvidence | undefined, expected: typeof allowedEvidence) =>
    Boolean(refs?.length) && refs!.every((ref) => expected.some((item) => sameEvidence(item, ref)));
  const includesConceptEvidence = (refs: typeof allowedEvidence | undefined, expected: typeof allowedEvidence) =>
    Boolean(refs?.length) && refs!.some((ref) => expected.some((item) => sameEvidence(item, ref)));
  if (input.teachingContext?.requireEvidence) {
    const concepts = input.teachingContext.concepts ?? [];
    const linkedEvidence = (owner: string, conceptIds: string[] | undefined, refs: typeof allowedEvidence | undefined) => {
      if (!conceptIds?.length) { problems.push(`${owner} is not linked to a source concept or marked illustrative-example`); return; }
      for (const conceptId of conceptIds) {
        const concept = concepts.find((item) => item.id === conceptId);
        if (!concept) problems.push(`${owner} links to unknown source concept ${conceptId}`);
        else if (!includesConceptEvidence(refs, concept.evidenceRefs)) problems.push(`${owner} evidence does not support linked concept ${conceptId}; retain at least one exact source reference for every linked concept`);
      }
    };
    if (spec.titleOrigin === 'fixture') problems.push('generated scene title cannot use fixture provenance');
    else if (spec.titleOrigin !== 'illustrative-example') {
      if (!validEvidence(spec.titleEvidenceRefs)) problems.push('scene title lacks valid source evidence');
      linkedEvidence('scene title', spec.titleConceptIds, spec.titleEvidenceRefs);
    }
    for (const element of spec.elements) {
      if (element.origin === 'fixture') problems.push(`generated element ${element.id} cannot use fixture provenance`);
      else if (element.origin !== 'illustrative-example') {
        if (!validEvidence(element.evidenceRefs)) problems.push(`element ${element.id} lacks valid source evidence`);
        linkedEvidence(`element ${element.id}`, element.conceptIds, element.evidenceRefs);
      }
      for (const conceptId of element.conceptIds ?? []) {
        const concept = concepts.find((item) => item.id === conceptId);
        if (!concept) problems.push(`element ${element.id} links to unknown source concept ${conceptId}`);
        else if (!includesConceptEvidence(element.evidenceRefs, concept.evidenceRefs)) problems.push(`element ${element.id} evidence does not support linked concept ${conceptId}; retain at least one exact source reference for every linked concept`);
      }
    }
    for (const edge of spec.edges) {
      if (edge.origin === 'fixture') problems.push(`generated edge ${edge.from}->${edge.to} cannot use fixture provenance`);
      else if (edge.origin !== 'illustrative-example' && !edge.factualRelation) problems.push(`edge ${edge.from}->${edge.to} is not linked to a source-grounded relation or marked illustrative-example`);
      if (edge.origin !== 'illustrative-example' && !validEvidence(edge.evidenceRefs)) problems.push(`edge ${edge.from}->${edge.to} lacks valid source evidence`);
      if (edge.factualRelation) {
        const relation = input.teachingContext.relations?.find((item) => item.from === edge.factualRelation!.fromConceptId && item.to === edge.factualRelation!.toConceptId && item.type === edge.factualRelation!.type);
        if (!relation || !validEvidence(edge.factualRelation.evidenceRefs) || !validEvidence(relation.evidenceRefs) ||
          !evidenceMatches(edge.factualRelation.evidenceRefs, relation.evidenceRefs) || !evidenceMatches(edge.evidenceRefs, relation.evidenceRefs)) {
          problems.push(`edge ${edge.from}->${edge.to} has an unsupported factual relation or mismatched relation evidence`);
        }
      }
    }
    // Relations extracted in S2 must survive into the S6 scene graph. A clean
    // schema or plausible-looking unlabeled arrow is not proof of transfer.
    for (const relation of input.teachingContext.relations ?? []) {
      const sourceConcept = concepts.find((concept) => concept.id === relation.from);
      const targetConcept = concepts.find((concept) => concept.id === relation.to);
      const sourceElements = spec.elements.filter((element) => element.conceptIds?.includes(relation.from) && sourceConcept && evidenceMatches(element.evidenceRefs, sourceConcept.evidenceRefs));
      const targetElements = spec.elements.filter((element) => element.conceptIds?.includes(relation.to) && targetConcept && evidenceMatches(element.evidenceRefs, targetConcept.evidenceRefs));
      const transferred = spec.edges.some((edge) => sourceElements.some((element) => element.id === edge.from) &&
        targetElements.some((element) => element.id === edge.to) && edge.factualRelation?.fromConceptId === relation.from &&
        edge.factualRelation.toConceptId === relation.to && edge.factualRelation.type === relation.type &&
        evidenceMatches(edge.factualRelation.evidenceRefs, relation.evidenceRefs) && evidenceMatches(edge.evidenceRefs, relation.evidenceRefs));
      if (!transferred) problems.push(`scene omits source-grounded relation ${relation.from}->${relation.to} (${relation.type})`);
    }
    for (const conceptId of input.planningContext?.sceneContract.requiredConceptIds ?? []) {
      if (!spec.elements.some((element) => element.conceptIds?.includes(conceptId))) problems.push(`scene omits required visual concept ${conceptId}`);
    }
  }
  const anchors: Array<[string, string]> = [];
  for (const el of spec.elements) {
    anchors.push([el.id, el.anchor]);
    if (el.prim === 'formula') for (const p of el.parts ?? []) if (p.anchor) anchors.push([`${el.id} term`, p.anchor]);
    if (el.prim === 'plot') for (const a of [el.tangentAnchor, el.stepsAnchor, el.riseRunAnchor]) if (a) anchors.push([`${el.id} plot group`, a]);
  }
  for (const e of spec.edges) if (e.anchor) anchors.push([`edge ${e.from}->${e.to}`, e.anchor]);
  for (const [who, a] of anchors) {
    if (a.startsWith('mention:') && !mentionIds.has(a.slice('mention:'.length))) problems.push(`${who} anchors to unknown mention "${a.slice('mention:'.length)}" (allowed: ${[...mentionIds].join(', ')})`);
  }
  const prevIds = new Set(input.previousElements?.map((e) => e.id) ?? []);
  for (const id of spec.carryOver ?? []) if (!prevIds.has(id)) problems.push(`carryOver "${id}" is not an element of the previous scene`);
  if (input.planningContext?.sceneContract.essentialClaims?.length) {
    problems.push(...visualClaimCoverageFailures({ ...spec, elements: spec.elements.map((element) => ({ id: element.id, element })) }, {
      essentialClaims: input.planningContext.sceneContract.essentialClaims,
      spokenClaimSpans: input.claimSpans ?? [],
    }).map((failure) => failure.message));
  }
  return problems;
}

const firstWords = (s: string, n: number) => s.trim().split(/\s+/).slice(0, n).join(' ');

/**
 * §9 deterministic fallback: one labelled object per mention (up to the
 * element cap), anchored to its mention, in a list. It never invents content
 * beyond the narration's own marked phrases.
 */
export function fallbackScene(input: PlannerSceneInput): SceneSpec {
  const evidenceForMention = (id: string) => input.teachingContext?.concepts?.find((concept) => concept.id === id)?.evidenceRefs ?? input.teachingContext?.sourceEvidenceRefs?.slice(0, 3);
  const elements: Element[] = input.mentions.slice(0, MAX_ELEMENTS_PER_SCENE).map((m) => ({
    id: m.id.replace(/[^a-zA-Z0-9_.-]/g, '_'),
    slot: 'item',
    anchor: `mention:${m.id}` as const,
    prim: 'object' as const,
    concept: m.phrase.toLowerCase().replace(/[^a-z0-9_ -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || 'idea',
    label: firstWords(m.phrase, MAX_LABEL_WORDS),
    ...(evidenceForMention(m.id)?.length ? { evidenceRefs: evidenceForMention(m.id) } : {}),
  }));
  if (elements.length === 0) elements.push({ id: 'idea', anchor: 'sceneStart', prim: 'text', text: firstWords(input.plainText, 12), size: 'body', ...(input.teachingContext?.sourceEvidenceRefs?.length ? { evidenceRefs: input.teachingContext.sourceEvidenceRefs.slice(0, 3) } : {}) });
  const title = firstWords(input.teachingContext?.displayText ?? 'Key Ideas', MAX_TITLE_WORDS).slice(0, 60);
  return { schemaVersion: 'claude-scene-spec/v1', sceneId: input.sceneId, title, ...(input.teachingContext?.sourceEvidenceRefs?.length ? { titleEvidenceRefs: input.teachingContext.sourceEvidenceRefs.slice(0, 3) } : {}), template: 'list_icon', elements, edges: [] };
}

/** Keep a schema-safe fallback renderable for diagnosis, while retaining every evidence/relation gap as a hard failure. */
export function fallbackPlanResult(
  input: PlannerSceneInput,
  spec: SceneSpec,
  priorFailures: StageFailure[],
  usage: PlannerCallUsage,
  rawResponses: PlanSceneResult['rawResponses'],
): PlanSceneResult {
  const checked = safeParseSceneSpec(spec);
  if (!checked.success) {
    return { usage, failures: [...priorFailures, { code: 'planner-fallback-invalid', stage: 'planner', message: `${input.sceneId}: fallback SceneSpec failed schema validation: ${checked.error.message}`, hard: true }], rawResponses, fallback: false };
  }
  const problems = plannerProblems(checked.data, input);
  const fallbackUsage = { ...usage, fallbacks: usage.fallbacks + 1 };
  const failures: StageFailure[] = [
    ...priorFailures,
    { code: 'planner-fallback', stage: 'planner', message: `${input.sceneId}: planner produced no valid SceneSpec; deterministic list_icon diagnostic fallback used (claude_pipeline.md §9)`, hard: true },
  ];
  if (problems.length) failures.push({
    code: 'planner-fallback-gate', stage: 'planner',
    message: `${input.sceneId}: fallback retained as a diagnostic preview but did not satisfy: ${problems.join('; ')}`,
    hard: true,
  });
  return { spec: checked.data, usage: fallbackUsage, failures, rawResponses, fallback: true };
}

/** Skip a paid S6 call after a hard S5 clock failure, retaining a failed diagnostic scene. */
export function skipPlanAfterAlignmentFailure(input: PlannerSceneInput, failureCount: number): PlanSceneResult {
  if (!Number.isInteger(failureCount) || failureCount < 1) throw new Error('alignment failure count must be a positive integer');
  const usage: PlannerCallUsage = { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0, fallbacks: 0 };
  const result = fallbackPlanResult(input, fallbackScene(input), [{
    code: 'planner-skipped-alignment-failure', stage: 'planner',
    message: `${input.sceneId}: paid S6 planning skipped because S5 recorded ${failureCount} hard word-alignment failure${failureCount === 1 ? '' : 's'}`,
    hard: true,
  }], usage, []);
  return result;
}

/**
 * Paid S6 planning is skipped after hard S5 alignment failures unless the
 * caller explicitly opts in for diagnosis. The opt-in never removes the S5
 * failures, so the run cannot pass publish gates.
 */
export function shouldSkipPaidPlanning(input: { hasHandAuthoredSpec: boolean; hardAlignmentFailureCount: number; planDespiteAlignmentFailure: boolean }): boolean {
  return !input.hasHandAuthoredSpec && input.hardAlignmentFailureCount > 0 && !input.planDespiteAlignmentFailure;
}

export async function planScene(input: PlannerSceneInput, options: PlanSceneOptions): Promise<PlanSceneResult> {
  const prompt = options.compiledPrompt ?? buildScenePlannerPrompt(input);
  const result = await structuredCall({
    stage: 'planner',
    subject: input.sceneId,
    model: options.model,
    apiKey: options.apiKey,
    // Never show a scene its own hand-authored answer as a few-shot (leakage guard).
    system: prompt.system,
    user: prompt.user,
    schema: SceneSpecSchema,
    schemaName: 'scene_spec',
    maxTokens: options.maxTokens ?? 6000,
    effort: options.effort ?? 'medium',
    remainingBudgetUsd: options.remainingBudgetUsd,
    budgetLedger: options.budgetLedger,
    signal: options.signal,
    fetcher: options.fetcher,
    validate: (value) => {
      const parsed = safeParseSceneSpec(value);
      return parsed.success ? plannerProblems(parsed.data, input) : parsed.error.issues.map((i) => i.message);
    },
  });
  const usage: PlannerCallUsage = { ...result.usage, fallbacks: 0 };
  if (result.value) {
    const parsed = safeParseSceneSpec(result.value);
    if (parsed.success) return { spec: parsed.data, usage, failures: result.failures, rawResponses: result.rawResponses, fallback: false };
  }
  if (options.fallback === false) return { usage, failures: result.failures, rawResponses: result.rawResponses, fallback: false };

  // Planner/provider failures stay on record; the fallback is retained for a visible, judgeable diagnostic.
  const spec = fallbackScene(input);
  const fallbackResult = fallbackPlanResult(input, spec, result.failures, usage, result.rawResponses);
  const cause = result.failures.map((f) => f.code).join(', ') || 'no valid output';
  fallbackResult.failures.find((f) => f.code === 'planner-fallback')!.message += ` (${cause})`;
  return fallbackResult;
}
