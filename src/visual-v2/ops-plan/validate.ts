import type { ValidatorProblem } from '../../llm/structuredCall.js';
import type { TeachingBeat } from '../../teaching/beat-plan/types.js';
import type { BoardOp, ElementSpec } from '../board-ops/types.js';
import { validateBoardOps } from '../board-ops/validate.js';
import { applyOpAfter, startScene } from '../board-state/reducer.js';
import type { BoardState } from '../board-state/types.js';
import { createdBy } from '../board-ops/deps.js';
import type { Grounding } from '../provenance/ground.js';
import { layoutScene, validateSceneGeometry, type PriorLayout } from '../layout/sceneLayout.js';
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
  geometryCheck?: (states: BoardState[]) => string[];
}

const MAX_LABEL_WORDS = 4;
const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
const norm = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
const stem = (text: string): string => norm(text).replace(/s$/, '');

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
  });
  const initial = startScene(ctx.initial, draft.transition, ctx.sceneId);
  const opProblems = validateBoardOps(draft.ops, initial, ctx.grounding);
  problems.push(...opProblems);

  for (const beat of ctx.beats) if (!beat.narrationOnly && !lastOpOfBeat.has(beat.beatId)) problems.push({ path: '/ops', message: `beat ${beat.beatId} shows a change (${beat.visualInvariant}), so it needs at least one op` });

  // Every concept a beat names must be on the board by the end of that beat (an element that shows it or carries its label).
  const states: BoardState[] = [initial];
  draft.ops.forEach((op, i) => {
    const before = states[states.length - 1]!;
    try {
      const after = applyOpAfter(before, op, draft.ops[i - 1]?.beatId).state;
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
        || (label !== undefined && specText(el.spec).some((text) => stem(text).includes(stem(label)) && stem(label).length > 0)));
      if (!shown) problems.push({ path: '/ops', message: `concept ${entity.conceptId}${label ? ` (${label})` : ''} is not on the board by the end of beat ${beat.beatId}; add an element that shows it` });
    }
  }
  // Geometry: the board must lay out inside the safe area without overlap or unreadable slots. These problems name no single op.
  if (problems.length === 0) {
    const check = ctx.geometryCheck ?? ((all: BoardState[]) => validateSceneGeometry(layoutScene(all, ctx.prior), all));
    const found = check(states);
    const creatorOf = new Map<string, number>();
    draft.ops.forEach((op, i) => { for (const id of createdBy(op)) if (!creatorOf.has(id)) creatorOf.set(id, i); });
    // One problem per element (the first), at most four, then one hint: a cascade of the same cause teaches the model nothing.
    const seen = new Set<string>();
    for (const message of found) {
      const subject = /(?:state \d+: )?([\w.-]+)/.exec(message)?.[1] ?? message;
      if (seen.has(subject) || seen.size >= 4) continue;
      seen.add(subject);
      // Name the op that drew the element, so the repair patches that op instead of regenerating the whole board.
      const opIndex = creatorOf.get(subject);
      problems.push(opIndex === undefined ? `layout: ${message}` : { path: `/ops/${opIndex}`, message: `layout: ${message}` });
    }
    // The hint rides on the first layout problem so the list stays pointer-addressed (a bare string would force a whole-document repair).
    const HINT = ' (hint: slots shrink as a kit holds more children and labels need about 14 characters per 200px; keep each kit to a handful of children, give separate mechanisms separate regions, never nest kits, and keep labels short)';
    const first = problems.findIndex((p) => (typeof p === 'string' ? p : p.message).startsWith('layout: '));
    if (found.length && first >= 0) { const p = problems[first]!; problems[first] = typeof p === 'string' ? `${p}${HINT}` : { ...p, message: `${p.message}${HINT}` }; }
  }
  return problems;
}
