import type { ValidatorProblem } from '../../llm/structuredCall.js';
import type { TeachingBeat } from '../../teaching/beat-plan/types.js';
import type { BoardOp, ElementSpec } from '../board-ops/types.js';
import { validateBoardOps } from '../board-ops/validate.js';
import { applyOpAfter, startScene } from '../board-state/reducer.js';
import type { BoardState } from '../board-state/types.js';
import { createdBy } from '../board-ops/deps.js';
import type { Grounding } from '../provenance/ground.js';
import { sourceClaimSemanticProblem } from '../provenance/ground.js';
import type { ClaimVerificationStatus, EpistemicType } from '../../evidence/ledger.js';
import { diagnoseSceneGeometry, layoutScene, type GeometryDiagnostic, type PriorLayout } from '../layout/sceneLayout.js';
import type { SceneBoardDraft } from './types.js';
import type { VisualVocabulary } from '../../planner/visualDiscovery.js';

export interface BoardContext {
  sceneId: string;
  title: string;
  beats: TeachingBeat[];
  /** Canonical source-backed claims linked from this scene's beats. */
  claims?: Array<{
    id: string;
    statement: string;
    /** Canonical concept identity linked to this claim. */
    conceptIds?: string[];
    /** Canonical directed relations linked to this claim. */
    relations?: Array<{ from: string; to: string; type: string }>;
    epistemicType?: EpistemicType;
    verificationStatus?: ClaimVerificationStatus;
  }>;
  /** The scene's narration, sentence by sentence, per beat. Sentence indexes are what `cue` refers to. */
  narration: Array<{ beatId: string; sentences: string[] }>;
  concepts: Array<{ id: string; label: string; kind?: string; /** Source quotes available to cite for this concept. */ evidence?: Array<{ spanId: string; quote: string }> }>;
  /** The S3b depiction choice that S6 must use when planning this scene. */
  visualVocabulary?: VisualVocabulary;
  /** The board the scene inherits (empty for the first scene). */
  initial: BoardState;
  /** The previous scene's geometry; retained objects keep their rectangles when possible. */
  prior?: PriorLayout;
  /** Resolves source citations; without it no equation may claim `source` provenance. */
  grounding?: Grounding;
  /** Test seam: replaces the layout solver check. */
  geometryCheck?: (states: BoardState[]) => GeometryDiagnostic[];
}

export const MAX_LABEL_WORDS = 4;
export const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
function specText(spec: ElementSpec): string[] {
  switch (spec.type) {
    case 'entity': return [spec.label];
    case 'kit': return spec.label ? [spec.label] : [];
    case 'token': return [spec.text];
    case 'text': return [spec.text];
    case 'value': return [spec.label];
    case 'equation': return [];
  }
}

function labelProblems(spec: ElementSpec, path: string): ValidatorProblem[] {
  const field = spec.type === 'text' || spec.type === 'token' ? 'text' : 'label';
  return specText(spec).flatMap((text) => (words(text) > MAX_LABEL_WORDS ? [{ path: `${path}/${field}`, message: `a board label is at most ${MAX_LABEL_WORDS} words (this has ${words(text)}); the speech carries the explanation` }] : []));
}

/** Catch an explicit visual label that names another canonical graph concept. */
function entityLabelIdentityProblems(spec: ElementSpec, path: string, ctx: BoardContext): ValidatorProblem[] {
  if (spec.type !== 'entity') return [];
  const normalized = (label: string) => label.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
  const other = ctx.concepts.find((concept) => concept.id !== spec.conceptId && normalized(concept.label) === normalized(spec.label));
  return other ? [{ path: `${path}/label`, message: `label ${JSON.stringify(spec.label)} names concept ${other.id}, but this entity is bound to ${spec.conceptId}` }] : [];
}

export function opSpecs(op: BoardOp, at: string): Array<{ spec: ElementSpec; path: string }> {
  switch (op.op) {
    case 'add': case 'replace': return [{ spec: op.element, path: `${at}/element` }];
    case 'split': return op.into.map((part, j) => ({ spec: part.element, path: `${at}/into/${j}/element` }));
    case 'merge': return [{ spec: op.into.element, path: `${at}/into/element` }];
    default: return [];
  }
}

function bindingProblems(spec: ElementSpec, path: string, ctx: BoardContext): ValidatorProblem[] {
  const knownConcepts = new Set(ctx.concepts.map((concept) => concept.id));
  const knownClaims = new Set(ctx.beats.flatMap((beat) => beat.claimIds));
  const conceptIds = [...new Set([...(spec.type === 'entity' ? [spec.conceptId] : []), ...(spec.bindings?.conceptIds ?? [])])];
  const claimIds = spec.bindings?.claimIds ?? [];
  const problems: ValidatorProblem[] = [];
  if (conceptIds.length === 0) problems.push({ path: `${path}/bindings/conceptIds`, message: 'every visual needs explicit conceptIds bindings; labels are not semantic evidence' });
  if (claimIds.length === 0) problems.push({ path: `${path}/bindings/claimIds`, message: 'every visual needs explicit claimIds bindings to claims it supports' });
  for (const id of conceptIds) if (!knownConcepts.has(id)) problems.push({ path: `${path}/bindings/conceptIds`, message: `unknown concept binding ${id}; use an exact concept id from this scene` });
  for (const id of claimIds) if (!knownClaims.has(id)) problems.push({ path: `${path}/bindings/claimIds`, message: `unknown claim binding ${id}; use an exact claim id from this scene` });
  problems.push(...claimConceptBindingProblems(conceptIds, claimIds, `${path}/bindings/conceptIds`, ctx));
  return problems;
}

/** Enforce claim→concept membership only when every linked claim has its canonical concept list. */
function claimConceptBindingProblems(conceptIds: string[], claimIds: string[], path: string, ctx: BoardContext): ValidatorProblem[] {
  if (!ctx.claims?.length || !claimIds.length || !conceptIds.length) return [];
  const claims = new Map(ctx.claims.map((claim) => [claim.id, claim]));
  const linked = claimIds.map((id) => claims.get(id));
  // Older cached plans can have claim text but no concept/relation identity. Leave those unresolved rather than
  // guessing that a concept is unrelated; newly constructed BoardContexts carry these canonical fields.
  if (linked.some((claim) => !claim?.conceptIds)) return [];
  const allowed = new Set(linked.flatMap((claim) => claim?.conceptIds ?? []));
  return [...new Set(conceptIds)].filter((conceptId) => !allowed.has(conceptId)).map((conceptId) => ({
    path,
    message: `concept ${conceptId} is not linked to any canonical claim bound here; visual concept bindings must be contained in the linked claims' conceptIds`,
  }));
}

function endpointConceptIds(spec: ElementSpec | undefined): string[] {
  if (!spec) return [];
  // Entity identity is explicit and singular, even if a broad containing claim was also attached as metadata.
  if (spec.type === 'entity') return [spec.conceptId];
  return [...new Set(spec.bindings?.conceptIds ?? [])];
}

/** Check a factual edge against linked source relations when both endpoint identities are resolvable. */
function connectRelationProblems(op: Extract<BoardOp, { op: 'connect' }>, path: string, state: BoardState, ctx: BoardContext): ValidatorProblem[] {
  const binding = op.bindings;
  if (!ctx.claims?.length || !binding?.claimIds.length) return [];
  const claimsById = new Map(ctx.claims.map((claim) => [claim.id, claim]));
  const linkedClaims = binding.claimIds.map((id) => claimsById.get(id));
  if (linkedClaims.some((claim) => !claim?.relations)) return [];
  const relations = [...new Map(linkedClaims.flatMap((claim) => claim?.relations ?? []).map((relation) => [
    `${relation.from}|${relation.type}|${relation.to}`, relation,
  ])).values()];
  if (relations.length === 0) return [{ path: `${path}/bindings/claimIds`, message: 'a factual edge must cite a claim with a canonical directed relation' }];

  const fromConcepts = endpointConceptIds(state.elements[op.from]?.spec);
  const toConcepts = endpointConceptIds(state.elements[op.to]?.spec);
  if (!fromConcepts.length || !toConcepts.length) return [];
  const predicate = op.relation.trim().toLocaleLowerCase('en-US');
  const forward = relations.filter((relation) => fromConcepts.includes(relation.from) && toConcepts.includes(relation.to));
  const aligned = forward.filter((relation) => predicate === relation.type.trim().toLocaleLowerCase('en-US'));
  if (aligned.length) return [];

  // Without one stable concept on both element endpoints, a possible relation match is not enough to claim
  // that the aggregate actually denotes that endpoint. Preserve the edge and leave this case unresolved.
  if (fromConcepts.length !== 1 || toConcepts.length !== 1) return [];

  const reversed = relations.filter((relation) => fromConcepts.includes(relation.to) && toConcepts.includes(relation.from)
    && predicate === relation.type.trim().toLocaleLowerCase('en-US'));
  if (reversed.length) {
    const relation = reversed[0]!;
    return [{ path: `${path}/from`, message: `edge ${op.from} -> ${op.to} reverses claim relation ${relation.from} -${relation.type}-> ${relation.to}` }];
  }
  if (forward.length) {
    const expected = [...new Set(forward.map((relation) => relation.type))].join(', ');
    return [{ path: `${path}/relation`, message: `predicate ${JSON.stringify(op.relation)} does not match the claim relation for these endpoints; expected ${expected}` }];
  }

  const available = relations.map((relation) => `${relation.from} -${relation.type}-> ${relation.to}`).join('; ');
  return [{ path: `${path}/from`, message: `endpoint concepts ${fromConcepts[0]} -> ${toConcepts[0]} do not match a linked claim relation (${available})` }];
}

function claimSemanticProblems(spec: ElementSpec, path: string, ctx: BoardContext): ValidatorProblem[] {
  if (!ctx.claims?.length) return [];
  const text = spec.type === 'entity' || spec.type === 'value' || spec.type === 'kit' ? spec.label
    : spec.type === 'text' || spec.type === 'token' ? spec.text : undefined;
  const claims = new Map(ctx.claims.map((claim) => [claim.id, claim]));
  const field = spec.type === 'text' || spec.type === 'token' ? 'text' : 'label';
  const claimIds = spec.bindings?.claimIds ?? [];
  const unverifiedBindings = claimIds.flatMap((claimId) => {
    const claim = claims.get(claimId);
    return claim && (claim.epistemicType === 'unverified_explanation' || claim.verificationStatus === 'unverified')
      ? [{ path: `${path}/bindings/claimIds`, message: `visuals cannot be bound to unverified explanation claim ${claimId}` }]
      : [];
  });
  if (!text) return unverifiedBindings;
  return [...unverifiedBindings, ...claimIds.flatMap((claimId) => {
    const claim = claims.get(claimId);
    if (!claim) return [];
    const mismatch = sourceClaimSemanticProblem(claim.statement, text);
    return mismatch ? [{ path: `${path}/${field}`, message: `visual text bound to claim ${claimId} contradicts its canonical wording: ${mismatch}` }] : [];
  })];
}

/** Inspect the actual post-op placement; replacements inherit it and moves may target kits created in this scene. */
function nestedKitProblems(op: BoardOp, state: BoardState, at: string): ValidatorProblem[] {
  let placed: Array<{ id: string; path: string }>;
  switch (op.op) {
    case 'add': placed = [{ id: op.id, path: `${at}/at/container` }]; break;
    case 'move': placed = [{ id: op.target, path: `${at}/to/container` }]; break;
    // There is no placement field to patch on replace: its new type makes the inherited slot invalid.
    case 'replace': placed = [{ id: op.id, path: `${at}/element/type` }]; break;
    case 'split': placed = op.into.map((part, j) => ({ id: part.id, path: `${at}/into/${j}/at/container` })); break;
    case 'merge': placed = [{ id: op.into.id, path: `${at}/into/at/container` }]; break;
    default: return [];
  }
  return placed.flatMap(({ id, path }) => {
    const el = state.elements[id];
    if (!el || el.lifecycle.removedAtBeat !== undefined || el.spec.type !== 'kit' || !el.placement.container) return [];
    const parent = state.elements[el.placement.container];
    if (el.spec.kit === 'graph' && parent?.spec.type === 'kit' && parent.spec.kit === 'graph') {
      try {
        if (JSON.parse(el.spec.paramsJson)?.layout === 'compound' && JSON.parse(parent.spec.paramsJson)?.layout === 'compound') return [];
      } catch { /* invalid params are reported by the BoardOp schema validator */ }
    }
    const hint = op.op === 'replace'
      ? `the replacement inherits ${op.target}'s slot in ${el.placement.container}; use a non-kit replacement or add the kit in its own region`
      : "give it its own region (a kit's slots only hold tokens, entities, values and short text)";
    return [{ path, message: `${id} is a kit and cannot be placed inside another kit; ${hint}` }];
  });
}

export function validateSceneBoard(draft: SceneBoardDraft, ctx: BoardContext): ValidatorProblem[] {
  const problems: ValidatorProblem[] = [];
  const conceptById = new Map(ctx.concepts.map((concept) => [concept.id, concept]));
  const vocabularyIds = new Set<string>();
  for (const [index, vocabularyConcept] of (ctx.visualVocabulary?.concepts ?? []).entries()) {
    const path = `/visualVocabulary/concepts/${index}`;
    const canonical = conceptById.get(vocabularyConcept.conceptId);
    if (!canonical) problems.push({ path: `${path}/conceptId`, message: `unknown visual vocabulary concept ${vocabularyConcept.conceptId}` });
    if (vocabularyIds.has(vocabularyConcept.conceptId)) problems.push({ path: `${path}/conceptId`, message: `duplicate visual vocabulary concept ${vocabularyConcept.conceptId}` });
    vocabularyIds.add(vocabularyConcept.conceptId);
    if (canonical && canonical.label !== vocabularyConcept.label) problems.push({ path: `${path}/label`, message: `visual vocabulary label does not match canonical concept ${canonical.id}` });
    if (canonical?.kind && canonical.kind !== vocabularyConcept.conceptKind) problems.push({ path: `${path}/conceptKind`, message: `visual vocabulary kind ${vocabularyConcept.conceptKind} does not match canonical kind ${canonical.kind} for ${canonical.id}` });
    if (canonical?.kind !== undefined && canonical.kind !== 'entity' && vocabularyConcept.depiction.kind === 'icon') problems.push({ path: `${path}/depiction`, message: `only a canonical entity concept can use a noun icon; ${canonical.id} is ${canonical.kind}` });
  }
  if (draft.transition.mode === 'retain-regions' && !draft.transition.regions?.length) problems.push({ path: '/transition/regions', message: 'retain-regions needs the regions to keep' });
  const order = new Map(ctx.beats.map((beat, index) => [beat.beatId, index]));
  let furthest = -1;
  const lastOpOfBeat = new Map<string, number>();
  draft.ops.forEach((op, i) => {
    const at = `/ops/${i}`;
    const position = order.get(op.beatId);
    if (position === undefined) problems.push({ path: `${at}/beatId`, message: `unknown beat ${op.beatId}; use one of: ${ctx.beats.map((b) => b.beatId).join(', ')}` });
    else if (position < furthest) problems.push({ path: `${at}/beatId`, message: `out of order: beat ${op.beatId} is earlier in the lesson than the beat of the op before; list ops beat by beat` });
    else { furthest = position; lastOpOfBeat.set(op.beatId, i); }
    const beat = ctx.beats.find((candidate) => candidate.beatId === op.beatId);
    const claimsById = new Map((ctx.claims ?? []).map((claim) => [claim.id, claim]));
    if (beat?.claimIds.some((claimId) => {
      const claim = claimsById.get(claimId);
      return claim?.epistemicType === 'unverified_explanation' || claim?.verificationStatus === 'unverified';
    })) problems.push({ path: `${at}/beatId`, message: `unverified explanation beat ${op.beatId} is narration-only and cannot contain BoardOps` });
    for (const { spec, path } of opSpecs(op, at)) {
      problems.push(...labelProblems(spec, path));
      problems.push(...entityLabelIdentityProblems(spec, path, ctx));
      problems.push(...bindingProblems(spec, path, ctx));
      problems.push(...claimSemanticProblems(spec, path, ctx));
    }
    if (op.op === 'connect') {
      const binding = op.bindings;
      if (!binding?.conceptIds.length) problems.push({ path: `${at}/bindings/conceptIds`, message: 'every factual edge needs explicit conceptIds bindings' });
      if (!binding?.claimIds.length) problems.push({ path: `${at}/bindings/claimIds`, message: 'every factual edge needs explicit claimIds bindings' });
      for (const id of binding?.conceptIds ?? []) if (!ctx.concepts.some((concept) => concept.id === id)) problems.push({ path: `${at}/bindings/conceptIds`, message: `unknown concept binding ${id}; use an exact concept id from this scene` });
      const claims = new Set(ctx.beats.flatMap((beat) => beat.claimIds));
      for (const id of binding?.claimIds ?? []) if (!claims.has(id)) problems.push({ path: `${at}/bindings/claimIds`, message: `unknown claim binding ${id}; use an exact claim id from this scene` });
      const claimsById = new Map((ctx.claims ?? []).map((claim) => [claim.id, claim]));
      for (const id of binding?.claimIds ?? []) {
        const claim = claimsById.get(id);
        if (claim?.epistemicType === 'unverified_explanation' || claim?.verificationStatus === 'unverified') problems.push({ path: `${at}/bindings/claimIds`, message: `factual edges cannot be bound to unverified explanation claim ${id}` });
      }
      problems.push(...claimConceptBindingProblems(binding?.conceptIds ?? [], binding?.claimIds ?? [], `${at}/bindings/conceptIds`, ctx));
    }
  });
  const initial = startScene(ctx.initial, draft.transition, ctx.sceneId);
  const beatOrder = ctx.beats.map((beat) => beat.beatId);
  const opProblems = validateBoardOps(draft.ops, initial, ctx.grounding, beatOrder);
  // A repair can only cite a formula it is shown: name the scene's quotes that state one.
  const formulaQuotes = [...new Set(ctx.concepts.flatMap((concept) => (concept.evidence ?? []).map((e) => e.quote)).filter((quote) => quote.includes('=')))].slice(0, 2);
  const formulaHint = formulaQuotes.length ? ` Source quotes that state a formula (copy one verbatim as evidence and write the equation exactly as it appears there): ${formulaQuotes.map((q) => JSON.stringify(q)).join(' | ')}` : '';
  problems.push(...opProblems.map((problem) => (formulaHint && typeof problem !== 'string' && /equation/i.test(problem.message) ? { ...problem, message: `${problem.message}${formulaHint}` } : problem)));

  for (const beat of ctx.beats) if (!beat.narrationOnly && !lastOpOfBeat.has(beat.beatId)) problems.push({ path: '/ops', message: `beat ${beat.beatId} shows a change (${beat.visualInvariant}), so it needs at least one op` });

  // Every concept must be visible at beat end, or as the exact live input immediately before its declared consumption.
  const states: BoardState[] = [initial];
  draft.ops.forEach((op, i) => {
    const before = states[states.length - 1]!;
    if (op.op === 'connect') problems.push(...connectRelationProblems(op, `/ops/${i}`, before, ctx));
    try {
      const after = applyOpAfter(before, op, draft.ops[i - 1]?.beatId, beatOrder).state;
      states.push(after);
      // Report the responsible placement once, rather than cascading over the same bad child in subsequent states.
      problems.push(...nestedKitProblems(op, after, `/ops/${i}`));
    } catch { states.push(before); }
  });
  const labelOf = new Map(ctx.concepts.map((c) => [c.id, c.label]));
  const iconConcepts = new Set((ctx.visualVocabulary?.concepts ?? [])
    .filter((item) => item.conceptKind === 'entity' && item.depiction.kind === 'icon' && conceptById.get(item.conceptId)?.kind === 'entity')
    .map((item) => item.conceptId));
  // Coverage is judged only on a board whose ops all applied; otherwise it just repeats the failed ops as missing concepts.
  for (const beat of opProblems.length > 0 ? [] : ctx.beats) {
    const at = lastOpOfBeat.get(beat.beatId);
    if (at === undefined) continue;
    const state = states[at + 1]!;
    const live = Object.values(state.elements).filter((el) => el.lifecycle.removedAtBeat === undefined);
    for (const entity of beat.entities) {
      const label = labelOf.get(entity.conceptId);
      const consumedAt = draft.ops.findIndex((op) => op.beatId === beat.beatId && (beat.requiredSemanticChanges ?? []).some((change) => {
        if (op.op === 'merge' && change.kind === 'merge') {
          const inputIds = change.mergeInputEntityIds ?? [];
          return op.into.id === change.entityId && inputIds.includes(entity.entityId)
            && op.targets.length === inputIds.length && op.targets.every((id, index) => id === inputIds[index]);
        }
        if (op.op === 'split' && change.kind === 'separate' && change.entityId === entity.entityId && op.target === entity.entityId) {
          const resultIds = beat.semanticRevealOrder.filter((id) => id !== entity.entityId);
          return op.into.length === resultIds.length && op.into.every((result, index) => result.id === resultIds[index]);
        }
        return false;
      }));
      const consumed = consumedAt < 0 ? undefined : states[consumedAt]?.elements[entity.entityId];
      const shownBeforeConsumption = consumed?.lifecycle.removedAtBeat === undefined && consumed?.spec.type === 'entity' && consumed.spec.conceptId === entity.conceptId;
      const shown = shownBeforeConsumption || live.some((el) => (el.spec.type === 'entity' && el.spec.conceptId === entity.conceptId)
        || (el.spec.bindings?.conceptIds.includes(entity.conceptId) ?? false));
      if (!shown) problems.push({ path: `/ops/${at + 1}`, message: `concept ${entity.conceptId}${label ? ` (${label})` : ''} is not bound to a live visual by the end of beat ${beat.beatId}; add a bound element with conceptIds:["${entity.conceptId}"] and its supporting claimIds` });
      if (iconConcepts.has(entity.conceptId) && !shownBeforeConsumption && !live.some((el) => el.spec.type === 'entity' && el.spec.conceptId === entity.conceptId)) {
        problems.push({ path: `/ops/${at + 1}`, message: `S3b selected a library icon for ${entity.conceptId}${label ? ` (${label})` : ''}; a live entity element bound to that concept is required by the end of beat ${beat.beatId}` });
      }
    }
  }
  // Geometry: the board must lay out inside the safe area without overlap or unreadable slots. These problems name no single op.
  if (problems.length === 0) {
    const found = ctx.geometryCheck
      ? ctx.geometryCheck(states)
      : diagnoseSceneGeometry(layoutScene(states, ctx.prior), states);
    const creatorOf = new Map<string, number>();
    draft.ops.forEach((op, i) => { for (const id of createdBy(op)) if (!creatorOf.has(id)) creatorOf.set(id, i); });
    // Report structured failures keyed by their stable IDs, never by parsing
    // human-readable diagnostic wording. Keep every unique defect for repair.
    const seen = new Set<string>();
    for (const diagnostic of found) {
      const subject = `${diagnostic.code}|${[...diagnostic.elementIds].sort().join(',')}|${diagnostic.edgeId ?? ''}`;
      if (seen.has(subject)) continue;
      seen.add(subject);
      const message = `layout[${diagnostic.code}]: ${diagnostic.message}`;
      const opIndexes = new Set<number>();
      if (diagnostic.edgeId !== undefined) { const index = creatorOf.get(diagnostic.edgeId); if (index !== undefined) opIndexes.add(index); }
      for (const id of diagnostic.elementIds) { const index = creatorOf.get(id); if (index !== undefined) opIndexes.add(index); }
      if (opIndexes.size === 0) problems.push({ path: '/transition', message });
      else for (const index of opIndexes) problems.push({ path: `/ops/${index}`, message });
    }
    const HINT = ' (keep text readable, shorten labels before changing layout, and preserve the board meaning)';
    for (let i = problems.length - 1; i >= 0; i--) {
      const problem = problems[i];
      if (problem && typeof problem !== 'string' && problem.message.startsWith('layout[')) problems[i] = { ...problem, message: `${problem.message}${HINT}` };
    }
  }
  return problems;
}
