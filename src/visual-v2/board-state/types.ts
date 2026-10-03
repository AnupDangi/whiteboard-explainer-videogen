import type { ElementSpec, Placement, RegionId } from '../board-ops/types.js';

export interface Lifecycle { createdAtBeat: string; updatedAtBeat: string[]; removedAtBeat?: string }

export interface ElementStep { latex: string; rule: string; beatId: string }

export interface BoardElement {
  id: string;
  spec: ElementSpec;
  placement: Placement;
  emphasis: 'normal' | 'highlight' | 'dim' | 'struck';
  /** Kit-specific named properties set by transform ops. */
  props: Record<string, string | number>;
  /** Current value of a value element, or the current expression of an equation. */
  value?: string | number;
  /** Equation history, in order (first entry is the given expression). */
  steps?: ElementStep[];
  persistence: 'beat' | 'scene' | 'lesson';
  /** Creation order across the board; layout reads it so positions are reproducible. */
  seq: number;
  lifecycle: Lifecycle;
}

export interface BoardEdge { id: string; from: string; to: string; relation: string; label?: string; weight?: number; bindings?: { conceptIds: string[]; claimIds: string[] }; /** An arrow can be emphasised, dimmed or struck out like an element. */ emphasis?: 'highlight' | 'dim' | 'struck'; lifecycle: Lifecycle }

/**
 * The persistent semantic board (V2 plan Phase 5). Elements keep their id for the whole lesson: a removed id stays in the
 * map (with removedAtBeat) so it can never be reused, and every container keeps its ordered child ids.
 */
export interface BoardState {
  elements: Record<string, BoardElement>;
  edges: Record<string, BoardEdge>;
  regions: Partial<Record<RegionId, { visible: boolean }>>;
  containers: Record<string, string[]>;
  scene?: { id: string; camera?: RegionId };
  /** Next element sequence number. */
  nextSeq: number;
}

export type BoardEffect =
  | { kind: 'add'; opId: string; targetId: string; to: Placement }
  | { kind: 'remove'; opId: string; targetId: string; from: Placement }
  | { kind: 'move'; opId: string; targetId: string; from: Placement; to: Placement }
  | { kind: 'emphasize'; opId: string; targetId: string; emphasis: BoardElement['emphasis'] }
  | { kind: 'valueChange'; opId: string; targetId: string; from: string | number | undefined; to: string | number }
  | { kind: 'transform'; opId: string; targetId: string; changes: Array<{ key: string; value: string | number }> }
  | { kind: 'connect'; opId: string; targetId: string; from: string; to: string }
  | { kind: 'equationStep'; opId: string; targetId: string; latex: string; rule: string }
  | { kind: 'reveal'; opId: string; region: RegionId }
  | { kind: 'clear'; opId: string; region: RegionId };

export type Condition =
  | { kind: 'exists'; id: string }
  | { kind: 'absentEver'; id: string }
  | { kind: 'removed'; id: string }
  | { kind: 'container'; id: string }
  | { kind: 'inContainer'; id: string; container: string }
  | { kind: 'isValue'; id: string }
  | { kind: 'isEquation'; id: string };

export class BoardOpError extends Error {
  constructor(readonly opId: string, message: string) { super(`${opId}: ${message}`); this.name = 'BoardOpError'; }
}
