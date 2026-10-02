import { canonicalHash } from '../../harness/replayDeterminism.js';
import type { BoardState } from './types.js';

/**
 * Hash of everything that changes what the board shows. Beat bookkeeping (created/updated/removed beats, step beat ids) is
 * excluded, so the same picture hashes the same whichever beat built it. Removed elements no longer affect the picture.
 */
export function hashBoardState(state: BoardState): string {
  const elements = Object.values(state.elements)
    .filter((element) => element.lifecycle.removedAtBeat === undefined)
    .map((element) => ({ id: element.id, spec: element.spec, placement: element.placement, emphasis: element.emphasis, props: element.props, value: element.value ?? null, steps: (element.steps ?? []).map(({ latex, rule }) => ({ latex, rule })) }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const edges = Object.values(state.edges)
    .filter((edge) => edge.lifecycle.removedAtBeat === undefined)
    .map(({ id, from, to, relation, label, weight }) => ({ id, from, to, relation, label: label ?? null, weight: weight ?? null }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const containers = Object.fromEntries(Object.entries(state.containers).filter(([, ids]) => ids.length).sort(([a], [b]) => (a < b ? -1 : 1)));
  return canonicalHash({ elements, edges, containers, regions: state.regions, camera: state.scene?.camera ?? null });
}
