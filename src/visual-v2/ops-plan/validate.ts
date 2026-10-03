import type { ValidatorProblem } from '../../llm/structuredCall.js';
import type { TeachingBeat } from '../../teaching/beat-plan/types.js';
import type { BoardOp, ElementSpec } from '../board-ops/types.js';
import { validateBoardOps } from '../board-ops/validate.js';
import { applyOpAfter, startScene } from '../board-state/reducer.js';
import type { BoardState } from '../board-state/types.js';
import { createdBy } from '../board-ops/deps.js';
import type { Grounding } from '../provenance/ground.js';
import { diagnoseSceneGeometry, layoutScene, type GeometryDiagnostic, type PriorLayout } from '../layout/sceneLayout.js';
import type { SceneBoardDraft } from './types.js';

export interface BoardContext {
  sceneId: string;
  title: string;
  beats: TeachingBeat[];
  /** The scene's narration, sentence by sentence, per beat. Sentence indexes are what `cue` refers to. */
  narration: Array<{ beatId: string; sentences: string[] }>;
  concepts: Array<{ id: string; label: string; /** Source quotes available to cite for this concept. */ evidence?: Array<{ spanId: string; quote: string }> }>;
  /** The board the scene inherits (empty for the first scene). */
  initial: BoardState;
  /** The previous scene's geometry; retained objects keep their rectangles when possible. */
  prior?: PriorLayout;
  /** Resolves source citations; without it no equation may claim `source` provenance. */
  grounding?: Grounding;
  /** Test seam: replaces the layout solver check. */
  geometryCheck?: (states: BoardState[]) => GeometryDiagnostic[];
}

const MAX_LABEL_WORDS = 4;
const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
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

function opSpecs(op: BoardOp, at: string): Array<{ spec: ElementSpec; path: string }> {
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
  return problems;
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
    const hint = op.op === 'replace'
      ? `the replacement inherits ${op.target}'s slot in ${el.placement.container}; use a non-kit replacement or add the kit in its own region`
      : "give it its own region (a kit's slots only hold tokens, entities, values and short text)";
    return [{ path, message: `${id} is a kit and cannot be placed inside another kit; ${hint}` }];
  });
}

export function validateSceneBoard(draft: SceneBoardDraft, ctx: BoardContext): ValidatorProblem[] {
  const problems: ValidatorProblem[] = [];
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
    for (const { spec, path } of opSpecs(op, at)) problems.push(...labelProblems(spec, path));
    for (const { spec, path } of opSpecs(op, at)) problems.push(...bindingProblems(spec, path, ctx));
    if (op.op === 'connect') {
      const binding = op.bindings;
      if (!binding?.conceptIds.length) problems.push({ path: `${at}/bindings/conceptIds`, message: 'every factual edge needs explicit conceptIds bindings' });
      if (!binding?.claimIds.length) problems.push({ path: `${at}/bindings/claimIds`, message: 'every factual edge needs explicit claimIds bindings' });
      for (const id of binding?.conceptIds ?? []) if (!ctx.concepts.some((concept) => concept.id === id)) problems.push({ path: `${at}/bindings/conceptIds`, message: `unknown concept binding ${id}; use an exact concept id from this scene` });
      const claims = new Set(ctx.beats.flatMap((beat) => beat.claimIds));
      for (const id of binding?.claimIds ?? []) if (!claims.has(id)) problems.push({ path: `${at}/bindings/claimIds`, message: `unknown claim binding ${id}; use an exact claim id from this scene` });
    }
  });
  const initial = startScene(ctx.initial, draft.transition, ctx.sceneId);
  const beatOrder = ctx.beats.map((beat) => beat.beatId);
  const opProblems = validateBoardOps(draft.ops, initial, ctx.grounding, beatOrder);
  problems.push(...opProblems);

  for (const beat of ctx.beats) if (!beat.narrationOnly && !lastOpOfBeat.has(beat.beatId)) problems.push({ path: '/ops', message: `beat ${beat.beatId} shows a change (${beat.visualInvariant}), so it needs at least one op` });

  // Every concept a beat names must be on the board by the end of that beat (an element that shows it or carries its label).
  const states: BoardState[] = [initial];
  draft.ops.forEach((op, i) => {
    const before = states[states.length - 1]!;
    try {
      const after = applyOpAfter(before, op, draft.ops[i - 1]?.beatId, beatOrder).state;
      states.push(after);
      // Report the responsible placement once, rather than cascading over the same bad child in subsequent states.
      problems.push(...nestedKitProblems(op, after, `/ops/${i}`));
    } catch { states.push(before); }
  });
  const labelOf = new Map(ctx.concepts.map((c) => [c.id, c.label]));
  // Coverage is judged only on a board whose ops all applied; otherwise it just repeats the failed ops as missing concepts.
  for (const beat of opProblems.length > 0 ? [] : ctx.beats) {
    const at = lastOpOfBeat.get(beat.beatId);
    if (at === undefined) continue;
    const state = states[at + 1]!;
    const live = Object.values(state.elements).filter((el) => el.lifecycle.removedAtBeat === undefined);
    for (const entity of beat.entities) {
      const label = labelOf.get(entity.conceptId);
      const shown = live.some((el) => (el.spec.type === 'entity' && el.spec.conceptId === entity.conceptId)
        || (el.spec.bindings?.conceptIds.includes(entity.conceptId) ?? false));
      if (!shown) problems.push({ path: `/ops/${at + 1}`, message: `concept ${entity.conceptId}${label ? ` (${label})` : ''} is not bound to a live visual by the end of beat ${beat.beatId}; add a bound element with conceptIds:["${entity.conceptId}"] and its supporting claimIds` });
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
