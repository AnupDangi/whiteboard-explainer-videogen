import type { Edge, Element, LaidOutScene, ResolutionRecord, StageFailure, Timeline, SpokenClaimSpan } from '../shared/types.js';
import type { SceneContract } from '../plan/schemas.js';
import { TEMPLATE_SPECS } from '../layout/templates/catalog.js';
import { withFailureClass } from '../shared/failure-taxonomy.js';
import type { EvidenceReference, NeutralElement, NeutralTimelineEvent } from '../shared/contracts.js';
import { MAX_CONCURRENT_REVEALS, MIN_READABLE_FONT_PX, STYLE } from '../render/style.js';

import { licenseAllowed } from '../assets/normalize.js';
import { isExemptFamily } from '../assets/sceneFamily.js';
import { bridgeConceptFor } from '../assets/bridge.js';
import { maxIdleWindowMs, nominalRevealMs } from '../timeline/compile.js';
import { formulaSource } from '../render/math.js';
import { tokenizeWords } from '../narration/align.js';

const evidenceKey = (ref: EvidenceReference): string => JSON.stringify([
  ref.sourceId, ref.spanId, ref.startChar, ref.endChar, ref.startLine, ref.endLine, ref.quote,
]);

/** Minimum element scale vs measured size: the solver's smallest deliberate factor (layout/solver.ts GROWTH_FACTORS). Anything smaller is silent over-shrink and fails loudly instead of rendering tiny. */
export const MIN_ELEMENT_SCALE = 0.6;

export const VISUAL_COVERAGE_GATE_VERSION = 'visual-claim-coverage/v4';
/** Grace after a claim's last spoken word during which its depiction may finish drawing (§22). */
/** Minimum time the completed board stays up before the scene ends (Simi benchmark §11: ~3 s ideal, 1.5 s floor). */
export const CLOSING_FREEZE_MIN_MS = 1500;
export const CLAIM_REVEAL_GRACE_MS = 900;
export interface ClaimCoverageInput {
  essentialClaims: SceneContract['essentialClaims'];
  spokenClaimSpans: SpokenClaimSpan[];
  plainText?: string;
  alignedWords?: Array<{ w: string; startMs: number; endMs: number }>;
  mentionTimes?: Array<{ id: string; startMs: number; endMs: number }>;
}

/** Aligned start/end of every spoken claim span (absolute ms); empty when the narration cannot be mapped to the alignment. */
export function claimSpanTimesMs(coverage: ClaimCoverageInput): Map<string, { startMs: number; endMs: number }> {
  const out = new Map<string, { startMs: number; endMs: number }>();
  const text = coverage.plainText ?? '';
  const aligned = coverage.alignedWords ?? [];
  const re = /[\p{L}\p{M}\p{N}]+(?:['’‘ʼ-][\p{L}\p{M}\p{N}]+)*/gu;
  const words = [...text.matchAll(re)].map((match) => ({ text: match[0], start: match.index!, end: match.index! + match[0].length }));
  const alignedTokens = aligned.flatMap((word, alignedIndex) => tokenizeWords(word.w).map((token) => ({ token, alignedIndex })));
  const same = words.length === alignedTokens.length && words.every((word, index) => tokenizeWords(word.text)[0]?.toLocaleLowerCase() === alignedTokens[index]!.token.toLocaleLowerCase());
  if (!text || !same) return out;
  for (const span of coverage.spokenClaimSpans) {
    const first = words.findIndex((word) => word.end > span.plainStart);
    let last = -1;
    for (let index = words.length - 1; index >= 0; index--) if (words[index]!.start < span.plainEnd) { last = index; break; }
    if (first < 0 || last < first) continue;
    out.set(span.claimId, { startMs: aligned[alignedTokens[first]!.alignedIndex]!.startMs, endMs: aligned[alignedTokens[last]!.alignedIndex]!.endMs });
  }
  return out;
}

/** Structural S6 coverage: source-backed targets, linked concepts/relations, and aligned reveal timing. Semantic entailment still needs review. */
export function visualClaimCoverageFailures(scene: BoardAdequacyInput, coverage: ClaimCoverageInput, timeline?: Timeline): StageFailure[] {
  const failures: StageFailure[] = [];
  const fail = (message: string) => failures.push({ code: 'visual-claim-coverage', stage: timeline ? 'timeline' : 'planner', message: `${scene.sceneId}: ${message}`, hard: true });
  const claimById = new Map(coverage.essentialClaims.map((claim) => [claim.id, claim]));
  const intents = scene.boardIntent?.visualIntents ?? [];
  const spans = new Map<string, SpokenClaimSpan[]>();
  const claimStartMs = new Map<string, number>();
  const claimEndMs = new Map<string, number>();
  const mentionStartMs = new Map((coverage.mentionTimes ?? []).map((mention) => [mention.id, mention.startMs]));
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
      } else {
        claimStartMs.set(span.claimId, aligned[alignedTokens[firstToken]!.alignedIndex]!.startMs);
        claimEndMs.set(span.claimId, aligned[alignedTokens[finalToken]!.alignedIndex]!.endMs);
      }
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
  // Synchronized depiction (§22 temporal policy): an element's drawing must
  // START within its claim window (introduction roughly around the claim),
  // while a relation arrow must COMPLETE within claim end + grace (relation
  // completion). Judging element wipes by their end punished slow-but-
  // synchronized drawing and caused systematic false failures.
  const revealWindow = (target: { kind: 'element'; elementId: string } | { kind: 'edge'; fromElementId: string; toElementId: string; relationType: NonNullable<Edge['factualRelation']>['type'] }): { startMs: number; endMs: number } | undefined => {
    if (!timeline) return undefined;
    // A carried object is already present as continuity context; it has no new
    // reveal to time against this claim.
    if (target.kind === 'element' && (scene as LaidOutScene).carryOver?.includes(target.elementId)) return undefined;
    const event = target.kind === 'element'
      ? timeline.events.find((item) => item.elementId === target.elementId && isPrimaryReveal(item.track))
      : timeline.events.find((item) => item.track === 'edge' && item.edgeIndex === scene.edges.findIndex((edge) => edge.from === target.fromElementId && edge.to === target.toElementId && edge.factualRelation?.type === target.relationType));
    if (!event || event.t1 - event.t0 < 1 || event.t0 >= timeline.sceneEndMs - 1) return undefined;
    return { startMs: event.t0, endMs: target.kind === 'element' ? event.t0 : event.t1 };
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
        const cited = (target.evidenceSpanIds ?? []).some((span) => claim.evidenceSpanIds.includes(span));
        const grounded = element?.evidenceRefs?.some((ref) => claim.evidenceSpanIds.includes(ref.spanId)) ?? false;
        if (!element || element.origin === 'illustrative-example' || element.origin === 'fixture' || (!cited && !grounded)) {
          fail(`claim ${claim.id} targets unsupported element ${target.elementId}`); continue;
        }
        // A copied label can be evidence-backed, but it does not depict a
        // concept. Typed geometry, including formulas and plots, remains a
        // structural target here; B4 checks the resolved drawing separately.
        if (element.prim !== 'text') for (const conceptId of element.conceptIds ?? []) coveredConcepts.add(conceptId);
      } else {
        const from = elements.get(target.fromElementId);
        const to = elements.get(target.toElementId);
        const edge = scene.edges.find((item) => item.from === target.fromElementId && item.to === target.toElementId && item.factualRelation?.type === target.relationType);
        const relation = edge?.factualRelation;
        const cited = (target.evidenceSpanIds ?? []).some((span) => claim.evidenceSpanIds.includes(span));
        if (!from || !to || !edge || !relation || edge.origin === 'illustrative-example' || edge.origin === 'fixture' ||
          (!cited && !edge.evidenceRefs?.some((ref) => claim.evidenceSpanIds.includes(ref.spanId))) ||
          (!cited && !relation.evidenceRefs.some((ref) => claim.evidenceSpanIds.includes(ref.spanId))) ||
          !from.conceptIds?.includes(relation.fromConceptId) || !to.conceptIds?.includes(relation.toConceptId) ||
          !claim.relations.some((expected) => expected.from === relation.fromConceptId && expected.to === relation.toConceptId && expected.type === relation.type)) {
          fail(`claim ${claim.id} targets unsupported edge ${target.fromElementId}->${target.relationType}->${target.toElementId}`); continue;
        }
        coveredConcepts.add(relation.fromConceptId);
        coveredConcepts.add(relation.toConceptId);
        coveredRelations.add(`${relation.fromConceptId}|${relation.type}|${relation.toConceptId}`);
      }
      const reveal = revealWindow(target);
      // Relation completion grace (§22 temporal policy): a reveal finishing
      // within CLAIM_REVEAL_GRACE_MS after the spoken claim still reads as
      // synchronized; anything later misses its narration window.
      const carried = target.kind === 'element' && Boolean((scene as LaidOutScene).carryOver?.includes(target.elementId));
      if (timeline && !carried && (!reveal || reveal.endMs > (claimEndMs.get(claim.id) ?? -Infinity) + CLAIM_REVEAL_GRACE_MS)) fail(`claim ${claim.id} target ${key} is not fully revealed by the end of its spoken claim`);
      // The timeline compiler deliberately starts mention-anchored reveals
      // STYLE.motion.leadMs before the aligned word. Treat that configured
      // lead as synchronized; larger unexplained early reveals still fail.
      const anchor = target.kind === 'element'
        ? elements.get(target.elementId)?.anchor
        : scene.edges.find((edge) => edge.from === target.fromElementId && edge.to === target.toElementId && edge.factualRelation?.type === target.relationType)?.anchor;
      const mentionId = anchor?.startsWith('mention:') ? anchor.slice('mention:'.length) : undefined;
      const synchronizedStart = mentionId ? mentionStartMs.get(mentionId) : claimStartMs.get(claim.id);
      if (timeline && reveal && reveal.startMs < (synchronizedStart ?? claimStartMs.get(claim.id) ?? Infinity) - STYLE.motion.leadMs) fail(`claim ${claim.id} target ${key} appears before its spoken claim begins`);
    }
    for (const conceptId of claim.conceptIds) if (!coveredConcepts.has(conceptId)) fail(`claim ${claim.id} has no depicting target for concept ${conceptId}`);
    for (const relation of claim.relations) if (!coveredRelations.has(`${relation.from}|${relation.type}|${relation.to}`)) fail(`claim ${claim.id} has no depicting edge for ${relation.from} -[${relation.type}]-> ${relation.to}`);
  }
  return failures.map(withFailureClass);
}

/**
 * B4 semantic fitness (Teaching Compiler V1 §6): B3 proves structure (one
 * span + one intent per claim, source-backed targets); B4 checks whether the
 * depiction has drawable geometry and visible relation endpoints. R10 is a
 * labelled box; only R11 is text-only. Similarity-selected assets remain
 * blocked until thresholds are calibrated or a curated mapping exists.
 */
export const SEMANTIC_FITNESS_GATE_VERSION = 'semantic-fitness/v4-visual-adapter-denominator';

/** Per-claim depiction summary shared by the B4 gate and Simi coverage metrics. */
export interface ClaimDepiction {
  claimId: string;
  hasIntent: boolean;
  /** Claim enters the last-resort denominator only when a validated per-claim visual intent exists. */
  visuallyRepresentable: boolean;
  elementTargets: number;
  drawnTargets: number;
  textTargets: number;
  edgeTargets: number;
  relationEndpointTargets: number;
  drawnRelationEndpoints: number;
  requiredRelations: number;
  depictedRelations: number;
  requiredStateChanges: number;
  depictedStateChanges: number;
  strategies: Array<string | undefined>;
  selectionBases: Array<ResolutionRecord['selectionBasis']>;
  encodedRelations: string[];
  diagramFirst: boolean;
  /** V2 accounting: the claim has a labelled box or text on the board. R10/R11 count here and nowhere stronger. */
  textSupported: boolean;
  /** V2 accounting: at least one depicting target is a real drawing (icon, semantic core, structured primitive), never an R10 box. */
  drawnCoverage: boolean;
  /** V2 accounting: at least one depicting target shows a mechanism (diagram, semantic core, topology, structured primitive). */
  mechanismCoverage: boolean;
  /** V2 accounting: the claim has a visual intent whose only depictions are R10 labelled boxes or plain text. */
  r10Only: boolean;
}

/** Procedural prims are drawings by construction (Simi-style labelled boxes included). */
/** Primitives that carry structure (not just a label): their geometry shows a relation, quantity or mechanism. */
const STRUCTURED_PRIMS = new Set(['tokenStrip', 'operator', 'meter', 'matrix', 'formula', 'container', 'cylinder', 'stack', 'axis', 'hill', 'plot', 'numberLine', 'shape', 'code', 'molecule', 'reaction']);
const MECHANISM_STRATEGIES = new Set(['R1-diagram', 'R2-semantic-core', 'R9-state-topology']);
const DRAWN_PRIMS = new Set(['box', 'pill', 'tokenStrip', 'operator', 'meter', 'matrix', 'formula', 'container', 'cylinder', 'stack', 'axis', 'hill', 'plot', 'numberLine', 'shape', 'code', 'molecule', 'reaction']);

export function depictClaims(scene: LaidOutScene, coverage: ClaimCoverageInput): ClaimDepiction[] {
  const intents = scene.boardIntent?.visualIntents ?? [];
  const byClaim = new Map<string, typeof intents>();
  for (const intent of intents) byClaim.set(intent.claimId, [...(byClaim.get(intent.claimId) ?? []), intent]);
  const resolutionByElement = new Map(scene.elements.map(({ id, resolution }) => [id, resolution]));
  const primByElement = new Map(scene.elements.map(({ id, element }) => [id, element.prim]));
  const isDrawn = (elementId: string): boolean => {
    const prim = primByElement.get(elementId);
    const resolution = resolutionByElement.get(elementId);
    // R10 is a geometric labelled box; only R11 is a pure text fallback.
    if (resolution?.strategy === 'R10-labelled-primitive') return true;
    // Explicit text stays text-only even if a stale resolution says an icon
    // rung. The primitive controls what the renderer can actually draw.
    if (prim === 'text') return false;
    if (DRAWN_PRIMS.has(prim ?? '')) return true;
    const rung = resolution?.rung;
    return rung !== undefined && rung !== 4;
  };
  return coverage.essentialClaims.map((claim) => {
    const links = byClaim.get(claim.id) ?? [];
    const elementTargets = links.flatMap((intent) => intent.targets.filter((t) => t.kind === 'element'));
    const edgeTargets = links.flatMap((intent) => intent.targets.filter((t) => t.kind === 'edge'));
    const relationEndpointIds = [...new Set(edgeTargets.flatMap((target) => target.kind === 'edge' ? [target.fromElementId, target.toElementId] : []))];
    const relationEndpointDrawn = relationEndpointIds.map(isDrawn);
    const depictionElementIds = [...new Set([...elementTargets.flatMap((target) => target.kind === 'element' ? [target.elementId] : []), ...relationEndpointIds])];
    const strategies = depictionElementIds.map((id) => resolutionByElement.get(id)?.strategy);
    const selectionBases = depictionElementIds.map((id) => resolutionByElement.get(id)?.selectionBasis);
    const drawnFlags = depictionElementIds.map(isDrawn);
    const encodedRelations = [...new Set(edgeTargets.flatMap((target) => {
      if (target.kind !== 'edge') return [];
      if (!isDrawn(target.fromElementId) || !isDrawn(target.toElementId)) return [];
      const relation = scene.edges.find((edge) => edge.from === target.fromElementId && edge.to === target.toElementId && edge.factualRelation?.type === target.relationType)?.factualRelation;
      if (!relation || !claim.relations.some((required) => required.from === relation.fromConceptId && required.to === relation.toConceptId && required.type === relation.type)) return [];
      return [`${relation.fromConceptId}|${relation.type}|${relation.toConceptId}`];
    }))];
    // The current contract has no separate state-change object; `transforms`
    // is its explicit typed relation for a state transition.
    const requiredStateChanges = claim.relations.filter((relation) => relation.type === 'transforms').length;
    const depictedStateChanges = claim.relations.filter((relation) => relation.type === 'transforms'
      && encodedRelations.includes(`${relation.from}|${relation.type}|${relation.to}`)).length;
    const drawnTargets = drawnFlags.filter(Boolean).length;
    // V2 truthful accounting: an R10 labelled box or plain text is text support, not drawing and not mechanism.
    const isMeaningful = (id: string): boolean => {
      const strategy = resolutionByElement.get(id)?.strategy;
      if (strategy === 'R10-labelled-primitive' || strategy === 'R11-minimal-text') return false;
      const prim = primByElement.get(id) ?? '';
      if (STRUCTURED_PRIMS.has(prim)) return true;
      const rung = resolutionByElement.get(id)?.rung;
      return prim === 'object' && rung !== undefined && rung !== 4;
    };
    const isMechanism = (id: string): boolean => {
      const strategy = resolutionByElement.get(id)?.strategy;
      return (strategy !== undefined && MECHANISM_STRATEGIES.has(strategy)) || (strategy !== 'R10-labelled-primitive' && STRUCTURED_PRIMS.has(primByElement.get(id) ?? ''));
    };
    const drawnCoverage = depictionElementIds.some(isMeaningful);
    const mechanismCoverage = depictionElementIds.some(isMechanism);
    const textTargets = depictionElementIds.filter((id) => primByElement.get(id) === 'text'
      || resolutionByElement.get(id)?.strategy === 'R11-minimal-text').length;
    return {
      claimId: claim.id,
      hasIntent: links.length > 0,
      visuallyRepresentable: claim.conceptIds.length > 0 && links.length > 0,
      elementTargets: elementTargets.length,
      drawnTargets,
      textTargets,
      edgeTargets: edgeTargets.length,
      relationEndpointTargets: relationEndpointIds.length,
      drawnRelationEndpoints: relationEndpointDrawn.filter(Boolean).length,
      requiredRelations: claim.relations.length,
      depictedRelations: encodedRelations.length,
      requiredStateChanges,
      depictedStateChanges,
      strategies,
      selectionBases,
      encodedRelations,
      diagramFirst: claim.conceptIds.some((cid) => bridgeConceptFor(cid)?.preferredStrategies[0] === 'diagram'),
      textSupported: depictionElementIds.length > 0,
      drawnCoverage,
      mechanismCoverage,
      r10Only: links.length > 0 && depictionElementIds.length > 0 && !drawnCoverage,
    };
  });
}

/** Simi release metrics (Teaching Compiler V1 §6/§24): coverage ratios over depicted claims. */
export function semanticCoverageMetrics(depictions: ClaimDepiction[], scenes: Array<{ laidOut: LaidOutScene; timeline: Timeline }>): Record<string, number> {
  const major = depictions.length;
  const depicted = depictions.filter((d) => d.drawnTargets > 0 && (d.elementTargets > 0 || d.edgeTargets > 0)).length;
  const visuallyRepresentable = depictions.filter((d) => d.visuallyRepresentable).length;
  const textFallback = depictions.filter((d) => d.visuallyRepresentable && d.textTargets > 0 && d.drawnTargets === 0).length;
  const requiredRelations = depictions.reduce((sum, d) => sum + d.requiredRelations, 0);
  const depictedRelations = depictions.reduce((sum, d) => sum + d.depictedRelations, 0);
  const requiredStateChanges = depictions.reduce((sum, d) => sum + d.requiredStateChanges, 0);
  const depictedStateChanges = depictions.reduce((sum, d) => sum + d.depictedStateChanges, 0);
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
    // V2 truthful accounting (plan Phase 0): R10 labelled boxes are text support, not meaningful or mechanism coverage.
    // The legacy keys below keep V1's definition so baseline runs stay comparable.
    'semantic.textSupportedClaims': depictions.filter((d) => d.textSupported).length,
    'semantic.meaningfulClaimCoverage': ratio(depictions.filter((d) => d.drawnCoverage).length),
    'semantic.mechanismClaimCoverage': ratio(depictions.filter((d) => d.mechanismCoverage).length),
    'semantic.r10OnlyMajorClaims': depictions.filter((d) => d.r10Only).length,
    'semantic.majorClaims': major,
    'semantic.depictedClaims': depicted,
    'semantic.majorClaimVisualCoverage': ratio(depicted),
    'semantic.textFallbackClaims': textFallback,
    'semantic.visuallyRepresentableClaims': visuallyRepresentable,
    'semantic.lastResortTextRate': visuallyRepresentable ? Math.round((textFallback / visuallyRepresentable) * 1000) / 1000 : 0,
    'semantic.requiredRelations': requiredRelations,
    'semantic.depictedRelations': depictedRelations,
    'semantic.requiredRelationCoverage': requiredRelations ? Math.round((depictedRelations / requiredRelations) * 1000) / 1000 : 1,
    'semantic.requiredStateChanges': requiredStateChanges,
    'semantic.depictedStateChanges': depictedStateChanges,
    'semantic.stateChangeCoverage': requiredStateChanges ? Math.round((depictedStateChanges / requiredStateChanges) * 1000) / 1000 : 1,
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
    if (depiction.selectionBases.includes('similarity')) {
      failures.push({ code: 'semantic-match-unverified', stage: 'resolve', message: `${scene.sceneId}: essential claim ${claim.id} uses an embedding-selected icon without a curated semantic mapping; similarity thresholds are uncalibrated`, hard: true });
    }
    // An edge proves its relation to B3, but B4 also checks whether both
    // endpoint concepts have visible depictions.
    if (!depiction.elementTargets && !depiction.edgeTargets) continue;
    if (depiction.edgeTargets && depiction.drawnRelationEndpoints !== depiction.relationEndpointTargets) {
      failures.push({ code: 'relation-endpoint-undepicted', stage: 'resolve', message: `${scene.sceneId}: essential relation claim ${claim.id} has text-only or missing endpoint depictions`, hard: true });
    }
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
    } else if (element && ['hierarchy_tree', 'decision_tree', 'timeline', 'rule_exception', 'claim_evidence'].includes(intent.layout)) {
      const expectedSlot = intent.layout === 'hierarchy_tree'
        ? ['root', 'branch', 'leaf'].includes(role.role) ? role.role : undefined
        : intent.layout === 'decision_tree'
          ? ['root', 'branch', 'outcome'].includes(role.role) ? role.role : undefined
          : intent.layout === 'timeline' ? role.role === 'event' ? 'event' : undefined
            : intent.layout === 'rule_exception' ? ['rule', 'exception', 'consequence'].includes(role.role) ? role.role : undefined
              : ['claim', 'evidence'].includes(role.role) ? role.role : undefined;
      if (!expectedSlot || element.element.slot !== expectedSlot) {
        failures.push({ code: 'board-role-misplaced', stage: 'planner', message: `${scene.sceneId}: ${intent.layout} ${role.role} role ${role.elementId} must occupy its matching semantic slot`, hard: true });
      }
    }
  }
  const layoutUsesTypedRoles = ['hierarchy_tree', 'decision_tree', 'timeline', 'rule_exception', 'claim_evidence'].includes(intent.layout);
  if (intent.visualKind === 'process' && !layoutUsesTypedRoles && !intent.roles.some(({ role, elementId }) => role === 'process' && ids.has(elementId))) {
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
  // A container is geometry, not a neutral element (toNeutralElements skips it), so its own draw event has no neutral element to point at.
  const containerIds = new Set(scene.elements.filter((element) => element.element.prim === 'container').map((element) => element.id));
  return timeline.events.filter((ev) => ev.track === 'edge' || !containerIds.has(ev.elementId)).map((ev) => {
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
 * §20). The shared `deterministicGates` (src/shared/evaluation.ts)
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

/** True when any segment of the polyline enters the interior of the box (sampled at 2px). */
export function polylineCrossesBox(points: ReadonlyArray<{ x: number; y: number }>, box: { x: number; y: number; w: number; h: number }): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!; const b = points[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
    for (let step = 0; step <= steps; step++) {
      const x = a.x + ((b.x - a.x) * step) / steps; const y = a.y + ((b.y - a.y) * step) / steps;
      if (x > box.x + 1 && x < box.x + box.w - 1 && y > box.y + 1 && y < box.y + box.h - 1) return true;
    }
  }
  return false;
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

  const sceneFamilies = new Set(scene.elements.flatMap((el) => (el.resolution?.houseFamily && !isExemptFamily(el.resolution.houseFamily) ? [el.resolution.houseFamily] : [])));
  if (sceneFamilies.size > 1) {
    failures.push({ code: 'family-mixed', stage: 'resolve', message: `${scene.sceneId}: icons mix ${sceneFamilies.size} visual families (${[...sceneFamilies].sort().join(', ')}); one primary family per scene (final_plan/02 §19)`, hard: true });
  }
  for (const el of scene.elements) {
    if (el.element.prim === 'object' && !el.resolution) {
      failures.push({ code: 'unresolved-object', stage: 'resolve', message: `${el.id} is an object element with no resolution record`, hard: true });
    }
    if (el.resolution && !licenseAllowed(el.resolution.license)) {
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
  const STRUCTURAL_PRIMS: string[] = ['formula', 'plot', 'matrix', 'numberLine', 'tokenStrip'];
  const STRUCTURAL_VISUAL_KINDS: string[] = ['formula', 'plot', 'matrix', 'number-line', 'worked-example', 'array', 'geometry'];
  const structured = scene.elements.some((el) => STRUCTURAL_PRIMS.includes(el.element.prim))
    || (scene.boardIntent ? STRUCTURAL_VISUAL_KINDS.includes(scene.boardIntent.visualKind) : false);
  const compare = (scene.boardIntent?.layout === 'compare') || scene.template === 'compare_2';
  if (!structured && !compare && scene.elements.length > 0 && (scene.occupancy < STYLE.occupancy.sparse || scene.elements.length < 2)) {
    const reason = scene.elements.length < 2
      ? `only ${scene.elements.length} element(s) (minimum 2)`
      : `board covers ${Math.round(scene.occupancy * 100)}% of the frame (< ${Math.round(STYLE.occupancy.sparse * 100)}%)`;
    failures.push({ code: 'board-too-sparse', stage: 'layout', message: `${reason}; it needs more or larger nodes`, hard: true });
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
  // Closure (Simi benchmark §11): the finished board must stay up long enough to consolidate.
  const lastReveal = Math.max(timeline.sceneStartMs, ...timeline.events.filter((event) => event.track !== 'hold' && event.track !== 'emphasis').map((event) => event.t1));
  const closingHoldMs = timeline.sceneEndMs - lastReveal;
  if (timeline.sceneEndMs - timeline.sceneStartMs >= 10_000 && closingHoldMs < CLOSING_FREEZE_MIN_MS) {
    warnings.push({ code: 'closing-freeze-short', stage: 'timeline', message: `${scene.sceneId}: the finished board is held ${Math.round(closingHoldMs)}ms; at least ${CLOSING_FREEZE_MIN_MS}ms is needed for consolidation`, hard: false });
  }
  failures.push(...timelineVisibilityFailures(scene, timeline));
  const compressed = compressedReveals(scene, timeline);
  if (compressed.count) {
    warnings.push({ code: 'timeline-compressed', stage: 'timeline', message: `${compressed.count} reveal(s) were sped up to fit the narration (fastest at ${Math.round(compressed.slowest * 100)}% of normal drawing time)`, hard: false });
  }
  // An arrow cutting through a node it does not connect reads as a false relation (final_plan/04 §21); reported as a DRAFT warning.
  const containerIds = new Set(scene.elements.filter((el) => el.element.prim === 'container').map((el) => el.id));
  for (const edge of scene.edges) {
    const hit = scene.elements.find((el) => el.id !== edge.from && el.id !== edge.to && !containerIds.has(el.id) && polylineCrossesBox(edge.points, el.bbox));
    if (hit) warnings.push({ code: 'edge-through-node', stage: 'layout', message: `${scene.sceneId}: arrow ${edge.from}->${edge.to} passes through ${hit.id}`, hard: false });
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
