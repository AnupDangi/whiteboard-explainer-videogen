import { CONTAINER_KITS, type BoardOp, type ElementSpec, type Placement, type RegionId, type SceneTransition } from '../board-ops/types.js';
import { BoardOpError, type BoardEdge, type BoardEffect, type BoardElement, type BoardState, type Condition } from './types.js';
import { derivePrePost } from '../board-ops/validate.js';

export function emptyBoardState(): BoardState {
  return { elements: {}, edges: {}, regions: {}, containers: {}, nextSeq: 1 };
}

const clone = (state: BoardState): BoardState => structuredClone(state);
const isLive = (el: BoardElement | undefined): el is BoardElement => el !== undefined && el.lifecycle.removedAtBeat === undefined;
const isLiveEdge = (edge: BoardEdge | undefined): edge is BoardEdge => edge !== undefined && edge.lifecycle.removedAtBeat === undefined;

/** Ordered live child ids of a container. */
export const containerContents = (state: BoardState, containerId: string): string[] => [...(state.containers[containerId] ?? [])];

function touch(el: BoardElement, beatId: string): void {
  if (el.lifecycle.updatedAtBeat[el.lifecycle.updatedAtBeat.length - 1] !== beatId) el.lifecycle.updatedAtBeat.push(beatId);
}

/** The live element ids, so a message about a missing one tells the model what it can name instead. */
function liveIds(state: BoardState): string {
  const ids = Object.values(state.elements).filter((e) => isLive(e)).map((e) => e.id);
  return ids.length ? ` (elements on the board now: ${ids.slice(-14).join(', ')})` : ' (the board is empty at this point)';
}

function explain(condition: Condition, state: BoardState): string | undefined {
  const el = (id: string) => state.elements[id];
  switch (condition.kind) {
    case 'exists': return isLive(el(condition.id)) || isLiveEdge(state.edges[condition.id]) ? undefined : `${condition.id} does not exist${liveIds(state)}`;
    case 'absentEver': return el(condition.id) || state.edges[condition.id] ? `${condition.id} is already used; ids are never reused, pick a new id` : undefined;
    case 'removed': return isLive(el(condition.id)) || isLiveEdge(state.edges[condition.id]) ? `${condition.id} is still on the board` : undefined;
    case 'container': {
      const target = el(condition.id);
      if (!isLive(target)) return `${condition.id} does not exist${liveIds(state)}`;
      return target.spec.type === 'kit' && CONTAINER_KITS.has(target.spec.kit) ? undefined : `${condition.id} is not a container (only kits hold children)`;
    }
    case 'inContainer': return (state.containers[condition.container] ?? []).includes(condition.id) ? undefined : `${condition.id} is not in ${condition.container}`;
    case 'isValue': return isLive(el(condition.id)) && el(condition.id)!.spec.type === 'value' ? undefined : isLive(el(condition.id)) ? `${condition.id} is not a value element` : `${condition.id} does not exist${liveIds(state)}`;
    case 'isEquation': return isLive(el(condition.id)) && el(condition.id)!.spec.type === 'equation' ? undefined : isLive(el(condition.id)) ? `${condition.id} is not an equation element` : `${condition.id} does not exist${liveIds(state)}`;
  }
}

export function checkConditions(state: BoardState, conditions: readonly Condition[]): string | undefined {
  for (const condition of conditions) { const problem = explain(condition, state); if (problem) return problem; }
  return undefined;
}

function insertChild(state: BoardState, id: string, at: Placement): void {
  if (!at.container) return;
  const list = (state.containers[at.container] ??= []);
  const slot = at.slot ?? 'top';
  if (slot === 'top' || slot === 'end') list.push(id);
  else if (slot === 'bottom' || slot === 'start') list.unshift(id);
  else list.splice(Math.min(slot, list.length), 0, id);
}

function detachChild(state: BoardState, id: string, at: Placement): void {
  if (!at.container) return;
  const list = state.containers[at.container];
  if (!list) return;
  const index = list.indexOf(id);
  if (index >= 0) list.splice(index, 1);
}

function createElement(id: string, spec: ElementSpec, at: Placement, beatId: string, persistence: BoardElement['persistence'], seq: number): BoardElement {
  const element: BoardElement = { id, spec, placement: at, emphasis: 'normal', props: {}, persistence, seq, lifecycle: { createdAtBeat: beatId, updatedAtBeat: [] } };
  if (spec.type === 'value') element.value = spec.value;
  if (spec.type === 'equation') { element.value = spec.latex; element.steps = [{ latex: spec.latex, rule: 'given', beatId }]; }
  return element;
}

/** Remove an element, its drawn children and the edges that touch any of them. Returns the removed ids. */
function removeCascade(state: BoardState, id: string, beatId: string, effects: BoardEffect[], opId: string): void {
  const el = state.elements[id];
  if (!isLive(el)) return;
  for (const child of [...(state.containers[id] ?? [])]) removeCascade(state, child, beatId, effects, opId);
  detachChild(state, id, el.placement);
  delete state.containers[id];
  el.lifecycle.removedAtBeat = beatId;
  effects.push({ kind: 'remove', opId, targetId: id, from: el.placement });
  for (const edge of Object.values(state.edges)) if (edge.lifecycle.removedAtBeat === undefined && (edge.from === id || edge.to === id)) edge.lifecycle.removedAtBeat = beatId;
}

function addElement(state: BoardState, id: string, spec: ElementSpec, at: Placement, beatId: string, opId: string, persistence: BoardElement['persistence'], effects: BoardEffect[]): void {
  state.elements[id] = createElement(id, spec, at, beatId, persistence, state.nextSeq);
  state.nextSeq += 1;
  insertChild(state, id, at);
  if (spec.type === 'kit') state.containers[id] ??= [];
  effects.push({ kind: 'add', opId, targetId: id, to: at });
}

/** The first id that occurs twice, if any. */
export const duplicateId = (ids: readonly string[]): string | undefined => ids.find((id, i) => ids.indexOf(id) !== i);

/** Apply one op to an immutable state. Preconditions are checked first and fail with a BoardOpError naming the op. */
export function applyOp(input: BoardState, op: BoardOp): { state: BoardState; effects: BoardEffect[] } {
  const { pre } = derivePrePost(op);
  const failed = checkConditions(input, pre);
  if (failed) throw new BoardOpError(op.opId, failed);
  // The wire field `target` is intentionally shared by element and edge operations,
  // but the operation itself determines the target type. Check it here, at the
  // reducer boundary, so direct callers and every simulator get the same result.
  const elementOnly = op.op === 'move' || op.op === 'transform' || op.op === 'replace'
    || op.op === 'updateValue' || op.op === 'split' || op.op === 'merge' || op.op === 'equationStep';
  if (elementOnly) {
    const ids = op.op === 'merge' ? op.targets : [op.target];
    for (const id of ids) if (!isLive(input.elements[id])) {
      throw new BoardOpError(op.opId, `${id} is an edge; ${op.op} requires an element`);
    }
  }
  if (op.op === 'connect') for (const id of [op.from, op.to]) {
    const edge = input.edges[id];
    if (edge && edge.lifecycle.removedAtBeat === undefined && !isLive(input.elements[id])) throw new BoardOpError(op.opId, `${id} is an edge; connect endpoints must be elements`);
  }
  if (op.op === 'split') { const dup = duplicateId(op.into.map((part) => part.id)); if (dup) throw new BoardOpError(op.opId, `split parts must have distinct ids; ${dup} is repeated`); }
  if (op.op === 'merge') {
    const dup = duplicateId(op.targets);
    if (dup) throw new BoardOpError(op.opId, `merge targets must be distinct; ${dup} is repeated`);
  }
  // A split/merge destination is a new visual, not a way to place children into
  // an element created by the same operation. Requiring an existing live kit
  // prevents partial container state and orphaned child IDs.
  const destinations = op.op === 'split' ? op.into : op.op === 'merge' ? [op.into] : [];
  const removedByOp = new Set<string>();
  const collectRemoved = (id: string): void => {
    if (removedByOp.has(id)) return;
    removedByOp.add(id);
    for (const child of input.containers[id] ?? []) collectRemoved(child);
  };
  if (op.op === 'split') collectRemoved(op.target);
  if (op.op === 'merge') for (const id of op.targets) collectRemoved(id);
  for (const part of destinations) if (part.at.container) {
    const container = input.elements[part.at.container];
    if (removedByOp.has(part.at.container)) throw new BoardOpError(op.opId, `${part.at.container} is removed by this op and cannot hold a destination`);
    if (!isLive(container)) throw new BoardOpError(op.opId, `${part.at.container} is not a live destination container`);
    if (container.spec.type !== 'kit' || !CONTAINER_KITS.has(container.spec.kit)) throw new BoardOpError(op.opId, `${part.at.container} is not a container`);
  }
  const state = clone(input);
  const effects: BoardEffect[] = [];
  const beat = op.beatId;
  switch (op.op) {
    case 'add': addElement(state, op.id, op.element, op.at, beat, op.opId, op.persistence ?? 'scene', effects); break;
    case 'connect': {
      const edge: BoardEdge = { id: op.id, from: op.from, to: op.to, relation: op.relation, ...(op.label ? { label: op.label } : {}), ...(op.weight !== undefined ? { weight: op.weight } : {}), ...(op.bindings ? { bindings: op.bindings } : {}), lifecycle: { createdAtBeat: beat, updatedAtBeat: [] } };
      state.edges[op.id] = edge;
      effects.push({ kind: 'connect', opId: op.opId, targetId: op.id, from: op.from, to: op.to });
      break;
    }
    case 'move': {
      const el = state.elements[op.target]!;
      const from = el.placement;
      detachChild(state, el.id, from);
      el.placement = op.to;
      insertChild(state, el.id, op.to);
      touch(el, beat);
      effects.push({ kind: 'move', opId: op.opId, targetId: el.id, from, to: op.to });
      break;
    }
    case 'transform': {
      const el = state.elements[op.target]!;
      for (const change of op.changes) el.props[change.key] = change.value;
      touch(el, beat);
      effects.push({ kind: 'transform', opId: op.opId, targetId: el.id, changes: op.changes });
      break;
    }
    case 'replace': {
      const old = state.elements[op.target]!;
      const at = old.placement;
      const persistence = old.persistence;
      const index = at.container ? (state.containers[at.container] ?? []).indexOf(old.id) : -1;
      removeCascade(state, old.id, beat, effects, op.opId);
      addElement(state, op.id, op.element, { ...at, ...(index >= 0 ? { slot: index } : {}) }, beat, op.opId, persistence, effects);
      break;
    }
    case 'remove': {
      const edge = state.edges[op.target];
      if (!state.elements[op.target] && isLiveEdge(edge)) { edge.lifecycle.removedAtBeat = beat; effects.push({ kind: 'remove', opId: op.opId, targetId: edge.id, from: { region: 'center' } }); } else removeCascade(state, op.target, beat, effects, op.opId);
      break;
    }
    case 'highlight': case 'deemphasize': case 'strike': {
      const edge = state.edges[op.target];
      if (!state.elements[op.target] && isLiveEdge(edge)) {
        edge.emphasis = op.op === 'highlight' ? 'highlight' : op.op === 'strike' ? 'struck' : 'dim';
        edge.lifecycle.updatedAtBeat.push(beat);
        effects.push({ kind: 'emphasize', opId: op.opId, targetId: edge.id, emphasis: edge.emphasis === 'struck' ? 'struck' : edge.emphasis === 'highlight' ? 'highlight' : 'dim' });
        break;
      }
      const el = state.elements[op.target]!;
      el.emphasis = op.op === 'highlight' ? 'highlight' : op.op === 'strike' ? 'struck' : 'dim';
      touch(el, beat);
      effects.push({ kind: 'emphasize', opId: op.opId, targetId: el.id, emphasis: el.emphasis });
      break;
    }
    case 'updateValue': {
      const el = state.elements[op.target]!;
      const from = el.value;
      el.value = op.value;
      touch(el, beat);
      effects.push({ kind: 'valueChange', opId: op.opId, targetId: el.id, from, to: op.value });
      break;
    }
    case 'split': {
      const old = state.elements[op.target]!;
      const persistence = old.persistence;
      removeCascade(state, old.id, beat, effects, op.opId);
      for (const part of op.into) addElement(state, part.id, part.element, part.at, beat, op.opId, persistence, effects);
      break;
    }
    case 'merge': {
      const persistence = state.elements[op.targets[0]!]!.persistence;
      for (const target of op.targets) removeCascade(state, target, beat, effects, op.opId);
      addElement(state, op.into.id, op.into.element, op.into.at, beat, op.opId, persistence, effects);
      break;
    }
    case 'equationStep': {
      const el = state.elements[op.target]!;
      (el.steps ??= []).push({ latex: op.latex, rule: op.rule, beatId: beat });
      el.value = op.latex;
      touch(el, beat);
      effects.push({ kind: 'equationStep', opId: op.opId, targetId: el.id, latex: op.latex, rule: op.rule });
      break;
    }
    case 'revealRegion': state.regions[op.region] = { visible: true }; effects.push({ kind: 'reveal', opId: op.opId, region: op.region }); break;
    case 'clearRegion': {
      for (const el of Object.values(state.elements)) if (isLive(el) && el.placement.region === op.region && el.persistence !== 'lesson' && !(el.placement.container && isLive(state.elements[el.placement.container]) && state.elements[el.placement.container]!.placement.region === op.region)) removeCascade(state, el.id, beat, effects, op.opId);
      effects.push({ kind: 'clear', opId: op.opId, region: op.region });
      break;
    }
  }
  return { state, effects };
}

export function applyOps(input: BoardState, ops: readonly BoardOp[]): { state: BoardState; effects: BoardEffect[] } {
  let state = input;
  const effects: BoardEffect[] = [];
  for (const op of ops) { const result = applyOp(state, op); state = result.state; effects.push(...result.effects); }
  return { state, effects };
}

/**
 * The first moment of a scene: keep the whole board, keep chosen regions, or clean it. Elements are marked removed (never
 * recreated), lesson-persistent ones always stay, and the scene marker records the camera.
 */
export function startScene(input: BoardState, transition: SceneTransition, sceneId: string): BoardState {
  const state = clone(input);
  const marker = `${sceneId}:scene-start`;
  const keepRegions = new Set<RegionId>(transition.regions ?? []);
  const drop = (el: BoardElement): boolean => {
    if (!isLive(el) || el.persistence === 'lesson') return false;
    if (transition.mode === 'retain-all') return false;
    if (transition.mode === 'clean') return true;
    return !keepRegions.has(el.placement.region);
  };
  const doomed = new Set(Object.values(state.elements).filter(drop).map((el) => el.id));
  const sink: BoardEffect[] = [];
  for (const id of doomed) removeCascade(state, id, marker, sink, marker);
  state.scene = { id: sceneId, ...(transition.camera ? { camera: transition.camera } : {}) };
  return state;
}

/** Elements that live only for their beat leave when the beat ends. */
export function endBeat(input: BoardState, beatId: string): BoardState {
  const state = clone(input);
  const sink: BoardEffect[] = [];
  for (const el of Object.values(state.elements)) if (isLive(el) && el.persistence === 'beat' && el.lifecycle.createdAtBeat === beatId) removeCascade(state, el.id, `${beatId}:beat-end`, sink, `${beatId}:beat-end`);
  return state;
}

/**
 * Apply `op` after the op before it: when the beat changes, the previous beat's beat-only elements leave first, so every
 * simulation (validation, timeline, plan checks) sees the same board.
 */
export function applyOpAfter(input: BoardState, op: BoardOp, previousBeatId: string | undefined, beatOrder?: readonly string[]): { state: BoardState; effects: BoardEffect[] } {
  let board = input;
  if (previousBeatId !== undefined && previousBeatId !== op.beatId) {
    const previousIndex = beatOrder?.indexOf(previousBeatId) ?? -1;
    const currentIndex = beatOrder?.indexOf(op.beatId) ?? -1;
    const completed = previousIndex >= 0 && currentIndex > previousIndex
      ? beatOrder!.slice(previousIndex, currentIndex)
      : [previousBeatId];
    for (const beatId of completed) board = endBeat(board, beatId);
  }
  return applyOp(board, op);
}
