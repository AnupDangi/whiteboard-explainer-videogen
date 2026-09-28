import type { Edge, Element, LaidOutScene, ResolutionRecord, StageFailure, Timeline, SpokenClaimSpan } from '../types.js';
import type { SceneContract } from '../plan/schemas.js';
import { TEMPLATE_SPECS } from '../templates/catalog.js';
import { withFailureClass } from '../../shared/failure-taxonomy.js';
import type { EvidenceReference, NeutralElement, NeutralTimelineEvent } from '../../shared/contracts.js';
import { MAX_CONCURRENT_REVEALS, MIN_READABLE_FONT_PX, STYLE } from '../style.js';

import { LICENSE_ALLOWLIST } from '../catalog/normalize.js';
import { bridgeConceptFor } from '../catalog/bridge.js';
import { maxIdleWindowMs, nominalRevealMs } from '../timeline/compile.js';
import { formulaSource } from '../render/math.js';
import { tokenizeWords } from '../narration/align.js';

const evidenceKey = (ref: EvidenceReference): string => JSON.stringify([
  ref.sourceId, ref.spanId, ref.startChar, ref.endChar, ref.startLine, ref.endLine, ref.quote,
]);

/** Minimum element scale vs measured size: the solver's smallest deliberate factor (layout/solver.ts GROWTH_FACTORS). Anything smaller is silent over-shrink and fails loudly instead of rendering tiny. */
export const MIN_ELEMENT_SCALE = 0.6;

export const VISUAL_COVERAGE_GATE_VERSION = 'visual-claim-coverage/v2';
export interface ClaimCoverageInput {
  essentialClaims: SceneContract['essentialClaims'];
  spokenClaimSpans: SpokenClaimSpan[];
  plainText?: string;
  alignedWords?: Array<{ w: string; startMs: number; endMs: number }>;
}

/** Structural S6 coverage: source-backed targets, linked concepts/relations, and aligned reveal timing. Semantic entailment still needs review. */
export function visualClaimCoverageFailures(scene: BoardAdequacyInput, coverage: ClaimCoverageInput, timeline?: Timeline): StageFailure[] {
  const failures: StageFailure[] = [];
  const fail = (message: string) => failures.push({ code: 'visual-claim-coverage', stage: timeline ? 'timeline' : 'planner', message: `${scene.sceneId}: ${message}`, hard: true });
  const claimById = new Map(coverage.essentialClaims.map((claim) => [claim.id, claim]));
  const intents = scene.boardIntent?.visualIntents ?? [];
  const spans = new Map<string, SpokenClaimSpan[]>();
  const claimEndMs = new Map<string, number>();
  if (timeline) {
    const text = coverage.plainText ?? '';
    const words: Array<{ text: string; start: number; end: number }> = [];
    const re = /[\p{L}\p{M}\p{N}]+(?:['’‘ʼ-][\p{L}\p{M}\p{N}]+)*/gu;
    for (const match of text.matchAll(re)) words.push({ text: match[0], start: match.index!, end: match.index! + match[0].length });
    const aligned = coverage.alignedWords ?? [];
    const alignedTokens = aligned.flatMap((word, alignedIndex) => tokenizeWords(word.w).map((token) => ({ token, alignedIndex })));
    const sameTokens = words.length === alignedTokens.length && words.every((word, index) => tokenizeWords(word.text)[0]?.toLocaleLowerCase() === alignedTokens[index]!.token.toLocaleLowerCase());
    if (!text || !sameTokens) fail('claim timing cannot be mapped to the validated aligned narration');
    else for (const span of coverage.spokenClaimSpans) {
      const firstToken = words.findIndex((word) => word.end > span.plainStart);
      let finalToken = -1;
      for (let index = words.length - 1; index >= 0; index--) if (words[index]!.start < span.plainEnd) { finalToken = index; break; }
      if (firstToken < 0 || words[firstToken]!.start < span.plainStart || finalToken < firstToken || words[finalToken]!.end > span.plainEnd) {
        fail(`claim ${span.claimId} exact spoken span does not start and end on aligned word boundaries`);
      } else claimEndMs.set(span.claimId, aligned[alignedTokens[finalToken]!.alignedIndex]!.endMs);
    }
  }
  for (const span of coverage.spokenClaimSpans) {
    spans.set(span.claimId, [...(spans.get(span.claimId) ?? []), span]);
    if (!claimById.has(span.claimId)) fail(`spoken span names unknown claim ${span.claimId}`);
    if (!span.exactText.trim() || span.plainStart < 0 || span.plainEnd - span.plainStart !== span.exactText.length || (coverage.plainText !== undefined && coverage.plainText.slice(span.plainStart, span.plainEnd) !== span.exactText)) fail(`claim ${span.claimId} has an invalid exact spoken span`);
  }
  const byClaim = new Map<string, typeof intents>();
  for (const intent of intents) {
    byClaim.set(intent.claimId, [...(byClaim.get(intent.claimId) ?? []), intent]);
    if (!claimById.has(intent.claimId)) fail(`visual intent names unknown claim ${intent.claimId}`);
  }
  const elements = new Map(scene.elements.map(({ id, element }) => [id, element]));
  const revealEnd = (target: { kind: 'element'; elementId: string } | { kind: 'edge'; fromElementId: string; toElementId: string; relationType: NonNullable<Edge['factualRelation']>['type'] }): number | undefined => {
    if (!timeline) return undefined;
    if (target.kind === 'element' && (scene as LaidOutScene).carryOver?.includes(target.elementId)) return timeline.sceneStartMs;
    const event = target.kind === 'element'
      ? timeline.events.find((item) => item.elementId === target.elementId && isPrimaryReveal(item.track))
      : timeline.events.find((item) => item.track === 'edge' && item.edgeIndex === scene.edges.findIndex((edge) => edge.from === target.fromElementId && edge.to === target.toElementId && edge.factualRelation?.type === target.relationType));
    return event && event.t1 - event.t0 >= 1 && event.t0 < timeline.sceneEndMs - 1 ? event.t1 : undefined;
  };
  for (const claim of coverage.essentialClaims) {
    const spoken = spans.get(claim.id) ?? [];
    if (spoken.length !== 1) { fail(`essential claim ${claim.id} requires exactly one exact spoken span (found ${spoken.length})`); continue; }
    const links = byClaim.get(claim.id) ?? [];
    if (links.length !== 1) { fail(`essential spoken claim ${claim.id} requires exactly one visual intent (found ${links.length})`); continue; }
    const intent = links[0]!;
    if (!intent.targets.length) { fail(`claim ${claim.id} has no depiction targets`); continue; }
    const coveredConcepts = new Set<string>();
    const coveredRelations = new Set<string>();
    const seenTargets = new Set<string>();
    for (const target of intent.targets) {
      const key = target.kind === 'element' ? `element:${target.elementId}` : `edge:${target.fromElementId}->${target.relationType}->${target.toElementId}`;
      if (seenTargets.has(key)) { fail(`claim ${claim.id} repeats target ${key}`); continue; }
      seenTargets.add(key);
      if (target.kind === 'element') {
        const element = elements.get(target.elementId);
        if (!element || element.origin === 'illustrative-example' || element.origin === 'fixture' || !element.evidenceRefs?.some((ref) => claim.evidenceSpanIds.includes(ref.spanId))) {
          fail(`claim ${claim.id} targets unsupported element ${target.elementId}`); continue;
        }
        for (const conceptId of element.conceptIds ?? []) coveredConcepts.add(conceptId);
      } else {
        const from = elements.get(target.fromElementId);
        const to = elements.get(target.toElementId);
        const edge = scene.edges.find((item) => item.from === target.fromElementId && item.to === target.toElementId && item.factualRelation?.type === target.relationType);
        const relation = edge?.factualRelation;
        if (!from || !to || !edge || !relation || edge.origin === 'illustrative-example' || edge.origin === 'fixture' ||
          !edge.evidenceRefs?.some((ref) => claim.evidenceSpanIds.includes(ref.spanId)) ||
          !relation.evidenceRefs.some((ref) => claim.evidenceSpanIds.includes(ref.spanId)) ||
          !from.conceptIds?.includes(relation.fromConceptId) || !to.conceptIds?.includes(relation.toConceptId) ||
          !claim.relations.some((expected) => expected.from === relation.fromConceptId && expected.to === relation.toConceptId && expected.type === relation.type)) {
          fail(`claim ${claim.id} targets unsupported edge ${target.fromElementId}->${target.relationType}->${target.toElementId}`); continue;
        }
        coveredConcepts.add(relation.fromConceptId);
        coveredConcepts.add(relation.toConceptId);
        coveredRelations.add(`${relation.fromConceptId}|${relation.type}|${relation.toConceptId}`);
      }
      const end = revealEnd(target);
      if (timeline && (end === undefined || end > (claimEndMs.get(claim.id) ?? -Infinity))) fail(`claim ${claim.id} target ${key} is not fully revealed by the end of its spoken claim`);
    }
    for (const conceptId of claim.conceptIds) if (!coveredConcepts.has(conceptId)) fail(`claim ${claim.id} has no depicting target for concept ${conceptId}`);
    for (const relation of claim.relations) if (!coveredRelations.has(`${relation.from}|${relation.type}|${relation.to}`)) fail(`claim ${claim.id} has no depicting edge for ${relation.from} -[${relation.type}]-> ${relation.to}`);
  }
  return failures.map(withFailureClass);
}

/**
 * B4 semantic fitness (Teaching Compiler V1 §6): B3 proves structure (one
 * span + one intent per claim, source-backed targets); B4 judges whether the
 * depiction actually teaches. Hard only when a major claim has NO drawing at
 * all (every target is rung-4 text); weaker-but-present depictions are
 * DRAFT findings (hard:false), never silent passes.
 */
export const SEMANTIC_FITNESS_GATE_VERSION = 'semantic-fitness/v1';

/** Per-claim depiction summary shared by the B4 gate and Simi coverage metrics. */
export interface ClaimDepiction {
  claimId: string;
  hasIntent: boolean;
  elementTargets: number;
  drawnTargets: number;
  textTargets: number;
  edgeTargets: number;
  strategies: Array<string | undefined>;
  encodedRelations: string[];
  diagramFirst: boolean;
}

export function depictClaims(scene: LaidOutScene, coverage: ClaimCoverageInput): ClaimDepiction[] {
  const intents = scene.boardIntent?.visualIntents ?? [];
  const byClaim = new Map<string, typeof intents>();
  for (const intent of intents) byClaim.set(intent.claimId, [...(byClaim.get(intent.claimId) ?? []), intent]);
  const resolutionByElement = new Map(scene.elements.map(({ id, resolution }) => [id, resolution]));
  return coverage.essentialClaims.map((claim) => {
    const links = byClaim.get(claim.id) ?? [];
    const elementTargets = links.flatMap((intent) => intent.targets.filter((t) => t.kind === 'element'));
    const edgeTargets = links.flatMap((intent) => intent.targets.filter((t) => t.kind === 'edge'));
    const strategies = elementTargets.map((t) => resolutionByElement.get(t.kind === 'element' ? t.elementId : '')?.strategy);
    const rungs = elementTargets.map((t) => resolutionByElement.get(t.kind === 'element' ? t.elementId : '')?.rung);
    const encodedRelations = edgeTargets
      .filter((t) => t.kind === 'edge' && scene.edges.some((e) =>
        e.from === t.fromElementId && e.to === t.toElementId && e.factualRelation?.type === t.relationType))
      .map((t) => t.kind === 'edge' ? `${t.fromElementId}|${t.relationType}|${t.toElementId}` : '');
    return {
      claimId: claim.id,
      hasIntent: links.length > 0,
      elementTargets: elementTargets.length,
      drawnTargets: rungs.filter((r) => r !== undefined && r !== 4).length,
      textTargets: rungs.filter((r) => r === 4 || r === undefined).length,
      edgeTargets: edgeTargets.length,
      strategies,
      encodedRelations,
      diagramFirst: claim.conceptIds.some((cid) => bridgeConceptFor(cid)?.preferredStrategies[0] === 'diagram'),
    };
  });
}

/** Simi release metrics (Teaching Compiler V1 §6/§24): coverage ratios over depicted claims. */
export function semanticCoverageMetrics(depictions: ClaimDepiction[], scenes: Array<{ laidOut: LaidOutScene; timeline: Timeline }>): Record<string, number> {
  const major = depictions.length;
  const depicted = depictions.filter((d) => d.drawnTargets > 0 || d.edgeTargets > 0).length;
  const textFallback = depictions.filter((d) => d.elementTargets > 0 && d.drawnTargets === 0).length;
  const weakMechanism = depictions.filter((d) =>
    d.diagramFirst && d.drawnTargets > 0 && !d.strategies.some((s) => s === 'R1-diagram' || s === 'R2-semantic-core')).length;
  let reveals = 0;
  let occupancySum = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  for (const { laidOut, timeline } of scenes) {
    reveals += timeline.events.filter((e) => e.track !== 'hold' && e.track !== 'emphasis').length;
    occupancySum += laidOut.occupancy;
    for (const el of laidOut.elements) {
      if (el.element.prim === 'object' && el.resolution && el.resolution.rung !== 4) {
        scoreSum += el.resolution.score;
        scoreCount++;
      }
    }
  }
  const ratio = (n: number): number => (major ? Math.round((n / major) * 1000) / 1000 : 1);
  return {
    'semantic.majorClaims': major,
    'semantic.depictedClaims': depicted,
    'semantic.majorClaimVisualCoverage': ratio(depicted),
    'semantic.textFallbackClaims': textFallback,
    'semantic.lastResortTextRate': ratio(textFallback),
    'semantic.weakMechanismClaims': weakMechanism,
    'semantic.meaningfulReveals': reveals,
    'semantic.meaningfulRevealsPerClaim': major ? Math.round((reveals / major) * 10) / 10 : 0,
    'semantic.meanAssetConfidence': scoreCount ? Math.round((scoreSum / scoreCount) * 1000) / 1000 : 1,
    'semantic.finalBoardOccupancy': scenes.length ? Math.round((occupancySum / scenes.length) * 1000) / 1000 : 0,
  };
}

export function semanticFitnessFailures(scene: LaidOutScene, coverage: ClaimCoverageInput): StageFailure[] {
  const failures: StageFailure[] = [];
  for (const depiction of depictClaims(scene, coverage)) {
    const claim = coverage.essentialClaims.find((c) => c.id === depiction.claimId)!;
    if (!depiction.hasIntent) continue; // B3 (visual-claim-coverage) owns missing intents.
    // Edge targets depict relations, not drawings; an edge-only claim is
    // depicted when its edge exists (B3) — fitness judges element drawings.
    if (!depiction.elementTargets) continue;
    if (!depiction.drawnTargets) {
      failures.push({ code: 'major-claim-undepicted', stage: 'resolve', message: `${scene.sceneId}: essential claim ${claim.id} is depicted only by text fallback, never drawn`, hard: true });
      const hasAssets = claim.conceptIds.some((cid) => (bridgeConceptFor(cid)?.approvedAssetRefs.length ?? 0) > 0);
      if (hasAssets) {
        failures.push({ code: 'text-fallback-despite-assets', stage: 'resolve', message: `${scene.sceneId}: essential claim ${claim.id} fell back to text although approved assets exist`, hard: false });
      }
      continue;
    }
    if (depiction.diagramFirst && !depiction.strategies.some((s) => s === 'R1-diagram' || s === 'R2-semantic-core')) {
      failures.push({ code: 'mechanism-literal-fallback', stage: 'resolve', message: `${scene.sceneId}: essential claim ${claim.id} describes a mechanism but depicts it with a literal/retrieval asset instead of a diagram or semantic role`, hard: false });
    }
  }
  return failures.map(withFailureClass);
}

/**
 * Check the semantic structure retained by a compiled typed board. This does
 * not score visual quality; it only prevents a board from silently dropping
 * source-required concepts/relations or the explicit roles required by its
 * selected structural template.
 */
/** The parts of a scene the adequacy check reads; a compiled SceneSpec (before layout) satisfies it too. */
export interface BoardAdequacyInput {
  sceneId: string;
  template: LaidOutScene['template'];
  elements: ReadonlyArray<{ id: string; element: Element }>;
  edges: readonly Edge[];
  boardIntent?: LaidOutScene['boardIntent'];
}

export function typedBoardAdequacyFailures(scene: BoardAdequacyInput): StageFailure[] {
  const intent = scene.boardIntent;
  if (!intent) return [];
  const failures: StageFailure[] = [];
  const elementsByConcept = new Map<string, Array<BoardAdequacyInput['elements'][number]>>();
  for (const element of scene.elements) {
    for (const conceptId of element.element.conceptIds ?? []) {
      elementsByConcept.set(conceptId, [...(elementsByConcept.get(conceptId) ?? []), element]);
    }
  }

  for (const conceptId of intent.requiredConceptIds) {
    if (!elementsByConcept.has(conceptId)) {
      failures.push({ code: 'board-concept-omitted', stage: 'planner', message: `${scene.sceneId}: typed board omits required source concept ${conceptId}`, hard: true });
    }
  }

  for (const relation of intent.requiredRelations) {
    const edge = scene.edges.find((candidate) => candidate.factualRelation?.fromConceptId === relation.from
      && candidate.factualRelation.toConceptId === relation.to
      && candidate.factualRelation.type === relation.type
      && (elementsByConcept.get(relation.from) ?? []).some((element) => element.element.id === candidate.from)
      && (elementsByConcept.get(relation.to) ?? []).some((element) => element.element.id === candidate.to));
    const actualRefs = new Set((edge?.factualRelation?.evidenceRefs ?? []).map(evidenceKey));
    const expectedRefs = relation.evidenceRefs.map(evidenceKey);
    const evidenceMatches = expectedRefs.length > 0 && expectedRefs.some((ref) => actualRefs.has(ref));
    if (!edge || !evidenceMatches) {
      failures.push({
        code: 'board-relation-omitted', stage: 'planner',
        message: `${scene.sceneId}: typed board must draw and cite source relation ${relation.from} -[${relation.type}]-> ${relation.to}`,
        hard: true,
      });
    }
  }

  // Every declared semantic role must still point at a visible node and each
  // visible node must have at most one declared role. This catches role loss
  // or metadata detached from the actual rendered board.
  const ids = new Set(scene.elements.map((element) => element.id));
  const roleIds = new Set<string>();
  for (const role of intent.roles) {
    if (roleIds.has(role.elementId)) {
      failures.push({ code: 'board-role-duplicate', stage: 'planner', message: `${scene.sceneId}: typed board assigns multiple roles to ${role.elementId}`, hard: true });
      continue;
    }
    roleIds.add(role.elementId);
    const element = scene.elements.find((candidate) => candidate.id === role.elementId);
    if (!element || !ids.has(role.elementId) || !(element.element.conceptIds?.length)) {
      failures.push({ code: 'board-role-detached', stage: 'planner', message: `${scene.sceneId}: typed board role ${role.role} is not attached to a visible concept node (${role.elementId})`, hard: true });
    } else if (intent.layout === 'convergence' && scene.template === 'convergence') {
      // Structured visuals (formula/plot/…) keep the model's layout in the intent but place nodes as callouts.
      const expectedSlot = role.role === 'process' ? 'operator' : role.role === 'output' ? 'output' : role.role === 'input' ? 'input' : undefined;
      if (expectedSlot && element.element.slot !== expectedSlot) {
        failures.push({ code: 'board-role-misplaced', stage: 'planner', message: `${scene.sceneId}: convergence ${role.role} role ${role.elementId} must occupy the ${expectedSlot} slot`, hard: true });
      }
    }
  }
  if (intent.visualKind === 'process' && !intent.roles.some(({ role, elementId }) => role === 'process' && ids.has(elementId))) {
    failures.push({ code: 'board-role-incomplete', stage: 'planner', message: `${scene.sceneId}: process board intent requires a visible process-role node`, hard: true });
  }

  // These templates preserve their structural slots through SceneSpec ->
  // layout. Validate both the retained semantic intent and the visible slots.
  const slots = new Set(scene.elements.filter((element) => (element.element.conceptIds?.length ?? 0) > 0).map((element) => element.element.slot));
  const requiredSlots = TEMPLATE_SPECS[scene.template].requiredSlots ?? [];
  const missingSlots = requiredSlots.filter(({ slot }) => !slots.has(slot));
  if (missingSlots.length) {
    failures.push({
      code: 'board-role-incomplete', stage: 'planner',
      message: `${scene.sceneId}: ${scene.template} typed board is missing ${missingSlots.map(({ explanation }) => explanation).join(', ')}`,
      hard: true,
    });
  }

  return failures.map(withFailureClass);
}

/**
 * A weak catalog match shown as an icon teaches the wrong association: a wrong
 * icon is worse than no icon. Rung 3 is the weak-match zone (mid thresholds in
 * catalog/ladder.ts are explicitly uncalibrated starting points), so an object
 * element resolved there is a hard failure. The safe fallback is a labelled
 * primitive or short text (rung 4), never the doubtful asset.
 */
export interface AssetMismatchInput {
  sceneId: string;
  elements: ReadonlyArray<{
    id: string;
    element: Pick<Element, 'prim'> & { concept?: string; iconBasis?: Element['iconBasis'] };
    resolution?: ResolutionRecord;
  }>;
}

export function semanticAssetMismatchFailures(scene: AssetMismatchInput): StageFailure[] {
  const failures: StageFailure[] = [];
  for (const { id, element, resolution } of scene.elements) {
    if (element.prim !== 'object' || resolution?.rung !== 3) continue;
    failures.push({
      code: 'semantic-asset-mismatch', stage: 'resolve',
      message: `${scene.sceneId}: ${id} shows a weak catalog match for "${element.concept ?? id}" (asset ${resolution.assetId}, score ${resolution.score.toFixed(2)}, ${element.iconBasis ?? 'unknown basis'}); use a labelled primitive or short text instead`,
      hard: true,
    });
  }
  return failures.map(withFailureClass);
}

/** Review cue only: a word-only process may still be the right diagram for an abstract lesson. */
export function labelOnlyProcessWarnings(scene: BoardAdequacyInput): StageFailure[] {
  if (scene.boardIntent?.visualKind !== 'process') return [];
  const byId = new Map(scene.elements.map(({ id, element }) => [id, element]));
  const textOnly = (id: string): boolean => {
    const prim = byId.get(id)?.prim;
    return prim === 'box' || prim === 'pill' || prim === 'text';
  };
  return scene.edges
    .filter((edge) => edge.factualRelation && textOnly(edge.from) && textOnly(edge.to))
    .map((edge) => ({
      code: 'board-label-only-process', stage: 'planner' as const,
      message: `${scene.sceneId}: source relation ${edge.from} -> ${edge.to} is shown with text-only endpoints; review whether a geometric or state-change depiction would teach it more clearly`,
      hard: false,
    }));
}

/** Container elements are organizational (they hug their children) and are excluded from overlap/leaf accounting per claude_pipeline.md §20's "excluding declared containers/badges". */
export function toNeutralElements(scene: LaidOutScene): NeutralElement[] {
  return scene.elements
    .filter((e) => e.element.prim !== 'container')
    .map((e) => ({ id: `${scene.sceneId}:${e.id}`, kind: e.element.prim, label: e.element.label, bbox: e.bbox, sourceRef: e.resolution?.assetId ?? undefined, evidenceRefs: e.element.evidenceRefs }));
}

export function toNeutralEvents(scene: LaidOutScene, timeline: Timeline, timeOriginMs = 0): NeutralTimelineEvent[] {
  return timeline.events.map((ev) => {
    // An edge event is attributed to its source element (neutral bundles only know elements).
    // Guard an out-of-range edgeIndex: fall back to the raw elementId (an "a->b"
    // edge label no element carries), so the shared deterministicGates emits a
    // `dangling-event` hard failure instead of this throwing a TypeError.
    const edge = ev.track === 'edge' && ev.edgeIndex !== undefined ? scene.edges[ev.edgeIndex] : undefined;
    const from = edge?.from ?? ev.elementId;
    return {
    elementId: `${scene.sceneId}:${from}`,
    action: ev.track,
    // Timelines use the lesson clock; per-scene gates and module clips use a
    // local clock. Callers pass the scene/module start when validating those.
    startMs: ev.t0 - timeOriginMs,
    endMs: ev.t1 - timeOriginMs,
    anchor: scene.elements.find((e) => e.id === ev.elementId)?.element.anchor,
    pedagogicalHold: ev.track === 'hold',
    };
  });
}

/**
 * Track-specific hard gates beyond the shared neutral checks (claude_pipeline.md
 * §20). The shared `deterministicGates` (src/experimental/hypothesis/shared/evaluation.ts)
 * already covers schema/overlap/safe-area/timeline-bounds/av-sync/unsafe-svg/license
 * generically across both tracks; this adds the Claude-specific readability,
 * concurrency, and resolution-completeness checks.
 */
const isFactual = (element: Element): boolean => Boolean(element.conceptIds?.length || element.evidenceRefs?.length);
const isPrimaryReveal = (track: string): boolean => track !== 'hold' && track !== 'emphasis' && track !== 'edge' && track !== 'term';

/**
 * Source-backed content that never becomes visible: an element or relation
 * arrow with no reveal, or one squeezed to zero duration at the scene end.
 */
export function timelineVisibilityFailures(scene: LaidOutScene, timeline: Timeline): StageFailure[] {
  const failures: StageFailure[] = [];
  const endMs = timeline.sceneEndMs;
  const visible = (t0: number, t1: number) => t1 - t0 >= 1 && t0 < endMs - 1;
  for (const el of scene.elements) {
    if (!isFactual(el.element) || scene.carryOver?.includes(el.id)) continue;
    const reveal = timeline.events.find((event) => event.elementId === el.id && isPrimaryReveal(event.track));
    if (!reveal || !visible(reveal.t0, reveal.t1)) failures.push({ code: 'reveal-invisible', stage: 'timeline', message: `${scene.sceneId}: source-backed element ${el.id} is never visibly drawn before the scene ends`, hard: true });
  }
  scene.edges.forEach((edge, edgeIndex) => {
    if (!edge.factualRelation) return;
    const event = timeline.events.find((candidate) => candidate.track === 'edge' && candidate.edgeIndex === edgeIndex);
    if (!event || !visible(event.t0, event.t1)) failures.push({ code: 'reveal-invisible', stage: 'timeline', message: `${scene.sceneId}: source relation ${edge.from} -> ${edge.to} (${edge.factualRelation.type}) is never visibly drawn`, hard: true });
  });
  return failures.map(withFailureClass);
}

/** Reveals shortened below their nominal drawing time to fit the scene audio. */
function compressedReveals(scene: LaidOutScene, timeline: Timeline): { count: number; slowest: number } {
  const byId = new Map(scene.elements.map((element) => [element.id, element]));
  let count = 0;
  let slowest = 1;
  for (const event of timeline.events) {
    const el = event.phases ? byId.get(event.elementId) : undefined;
    if (!el) continue;
    const nominal = nominalRevealMs(el);
    const actual = event.t1 - event.t0;
    if (nominal > 0 && actual < nominal - 1) { count += 1; slowest = Math.min(slowest, actual / nominal); }
  }
  return { count, slowest };
}

export function runClaudeGates(scene: LaidOutScene, timeline: Timeline, claimCoverage?: ClaimCoverageInput): { failures: StageFailure[]; warnings: StageFailure[] } {
  const failures: StageFailure[] = [];
  const warnings: StageFailure[] = [];

  // The retained S6 intent marks typed-board-v2 output. Older SceneSpec
  // artifacts omit it and remain backward-compatible without this gate.
  if (scene.boardIntent) {
    failures.push(...typedBoardAdequacyFailures(scene));
    warnings.push(...labelOnlyProcessWarnings(scene));
  }
  if (claimCoverage) failures.push(...visualClaimCoverageFailures(scene, claimCoverage, timeline));
  if (claimCoverage) failures.push(...semanticFitnessFailures(scene, claimCoverage));
  failures.push(...semanticAssetMismatchFailures(scene));

  for (const el of scene.elements) {
    if (el.element.prim === 'object' && !el.resolution) {
      failures.push({ code: 'unresolved-object', stage: 'resolve', message: `${el.id} is an object element with no resolution record`, hard: true });
    }
    if (el.resolution && !LICENSE_ALLOWLIST.includes(el.resolution.license)) {
      failures.push({ code: 'license', stage: 'resolve', message: `${el.id} resolved to an unlicensed asset (${el.resolution.license})`, hard: true });
    }
    const sy = el.bbox.h / Math.max(1e-6, el.intrinsicSize.h);
    for (const t of el.visual.texts) {
      const renderedPx = t.size * sy;
      if (renderedPx < MIN_READABLE_FONT_PX) {
        // G6 is a hard floor for every visible text run, including annotations.
        failures.push({ code: 'min-readable-text', stage: 'layout', message: `${el.id} label renders at ${renderedPx.toFixed(1)}px < ${MIN_READABLE_FONT_PX}px`, hard: true });
      }
    }
    // Small-element floor: a leaf scaled below the solver's smallest
    // deliberate factor is over-shrunk content, not a layout fit — fail hard
    // instead of rendering a tiny unreadable element. Containers are
    // excluded (their intrinsic size is a placeholder; the solver hugs them
    // to their children).
    if (el.element.prim !== 'container') {
      const scale = Math.min(el.bbox.w / Math.max(1e-6, el.intrinsicSize.w), sy);
      if (scale < MIN_ELEMENT_SCALE - 1e-9) {
        failures.push({ code: 'tiny-element', stage: 'layout', message: `${el.id} renders at ${(scale * 100).toFixed(0)}% of measured size, below the ${(MIN_ELEMENT_SCALE * 100).toFixed(0)}% readable floor`, hard: true });
      }
    }
  }

  // Concurrency: at most MAX_CONCURRENT_REVEALS element reveals active at any instant.
  // Arrows (`edge`) and formula terms (`term`) are sub-reveals of elements already on the board,
  // scheduled outside the element servers (timeline/compile.ts).
  const reveals = timeline.events.filter((e) => e.track !== 'hold' && e.track !== 'emphasis' && e.track !== 'edge' && e.track !== 'term');
  const boundaries = [...new Set(reveals.flatMap((e) => [e.t0, e.t1]))].sort((a, b) => a - b);
  for (let i = 0; i < boundaries.length - 1; i++) {
    const mid = (boundaries[i] + boundaries[i + 1]) / 2;
    const active = reveals.filter((e) => e.t0 <= mid && mid < e.t1).length;
    if (active > MAX_CONCURRENT_REVEALS) {
      failures.push({ code: 'concurrency', stage: 'timeline', message: `${active} simultaneous reveals at ${mid}ms exceeds ${MAX_CONCURRENT_REVEALS}`, hard: true });
      break;
    }
  }

  // G5 occupancy at scene end: outside the band is a warning; a board that
  // leaves most of the frame empty is a hard failure (a draft, not a lesson).
  // Structured boards (formula / plot / matrix / number-line / worked-example,
  // by element prim or board visual kind) and compare boards (by board layout
  // or compare_2 template) carry meaning in few elements and are exempt.
  // Detection is structural only: element count, union-bbox occupancy, prims,
  // template, board intent — never lesson wording. A single-node board can be
  // scaled up to the sparse floor by occupancy growth, so <2 elements fails on
  // its own.
  const STRUCTURAL_PRIMS: string[] = ['formula', 'plot', 'matrix', 'numberLine'];
  const STRUCTURAL_VISUAL_KINDS: string[] = ['formula', 'plot', 'matrix', 'number-line', 'worked-example'];
  const structured = scene.elements.some((el) => STRUCTURAL_PRIMS.includes(el.element.prim))
    || (scene.boardIntent ? STRUCTURAL_VISUAL_KINDS.includes(scene.boardIntent.visualKind) : false);
  const compare = (scene.boardIntent?.layout === 'compare') || scene.template === 'compare_2';
  if (!structured && !compare && scene.elements.length > 0 && (scene.occupancy < STYLE.occupancy.sparse || scene.elements.length < 2)) {
    failures.push({ code: 'board-too-sparse', stage: 'layout', message: `board covers ${Math.round(scene.occupancy * 100)}% of the frame (< ${Math.round(STYLE.occupancy.sparse * 100)}%) with ${scene.elements.length} elements; it needs more or larger nodes`, hard: true });
  } else if (scene.occupancy < STYLE.occupancy.min || scene.occupancy > STYLE.occupancy.max) {
    warnings.push({ code: 'occupancy', stage: 'layout', message: `occupancy ${scene.occupancy.toFixed(2)} outside [${STYLE.occupancy.min}, ${STYLE.occupancy.max}]`, hard: false });
  }
  // G9 idle: the longest stretch, including the end of the scene, with no new
  // content drawn. Emphasis rings are filler and are reported, not counted.
  const idle = maxIdleWindowMs(timeline);
  if (idle > STYLE.motion.maxIdleMs) {
    const filled = idle - maxIdleWindowMs(timeline, { countEmphasis: true });
    warnings.push({ code: 'idle', stage: 'timeline', message: `${Math.round(idle)}ms without new content exceeds ${STYLE.motion.maxIdleMs}ms${filled > 0 ? ` (emphasis rings fill ${Math.round(filled)}ms of it)` : ''}`, hard: false });
  }
  failures.push(...timelineVisibilityFailures(scene, timeline));
  const compressed = compressedReveals(scene, timeline);
  if (compressed.count) {
    warnings.push({ code: 'timeline-compressed', stage: 'timeline', message: `${compressed.count} reveal(s) were sped up to fit the narration (fastest at ${Math.round(compressed.slowest * 100)}% of normal drawing time)`, hard: false });
  }
  const crowdedLabels = scene.edges.filter((edge) => edge.labelOverlapsNode).map((edge) => `${edge.from}->${edge.to}`);
  if (crowdedLabels.length) warnings.push({ code: 'edge-label-overlap', stage: 'layout', message: `no clear place for arrow label(s) ${crowdedLabels.join(', ')}; they overlap a node`, hard: false });
  // Formula error: a TeX expression MathJax could not typeset is a hard failure (hypothesis plan "formula error").
  for (const el of scene.elements) {
    if (el.element.prim === 'formula' && !(el.visual.embeds?.length)) {
      failures.push({ code: 'formula-error', stage: 'render', message: `${el.id}: MathJax could not typeset "${formulaSource(el.element)}"`, hard: true });
    }
  }

  if (scene.elements.length < 2 || scene.elements.length > 9) {
    warnings.push({ code: 'element-count', stage: 'planner', message: `scene has ${scene.elements.length} elements (expected 2-9)`, hard: false });
  }

  return { failures: failures.map(withFailureClass), warnings: warnings.map(withFailureClass) };
}
