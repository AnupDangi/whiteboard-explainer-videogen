import type { BridgeDiagram } from './bridge.js';

/**
 * R1 diagram adapters (final_plan/02 §16 R1, §6). A bridge diagram recipe names a structural
 * TOPOLOGY, not content: its supportRefs are generic primitives shared across a whole domain.
 * The adapter therefore compiles only the structure — a labelled mini diagram of the recipe's
 * topology — and never invents nodes, relations or numbers for the concept. Concrete instances
 * still come from the lesson's own relation graph via board layouts (chain/cycle/hub/tree/...).
 *
 * Recipes whose form needs an exact renderer or a drawn scene are rejected explicitly with a reason
 * code; nothing is silently dropped.
 */
export type DiagramAdapterDecision =
  | { status: 'compiled'; topology: string }
  | { status: 'rejected'; reasonCode: 'SPEC_ONLY_NOT_INSTANTIATED' | 'USE_EXACT_RENDERER' | 'UNSUPPORTED_TOPOLOGY'; reason: string; missingFields: string[] };

/** Recipe topology -> procedural topology drawing (semantic core). */
export const DIAGRAM_TOPOLOGY_MAP: Readonly<Record<string, string>> = {
  flow: 'chain',
  cycle: 'cycle',
  tree: 'tree',
  'network-graph': 'hub_spoke',
};

const EXACT_RENDERER_TOPOLOGIES = new Set(['plot', 'chart', 'molecule-graph']);

export function classifyDiagramAdapter(diagram: Pick<BridgeDiagram, 'ref' | 'topology'>): DiagramAdapterDecision {
  const topology = DIAGRAM_TOPOLOGY_MAP[diagram.topology];
  if (topology) return { status: 'compiled', topology };
  if (EXACT_RENDERER_TOPOLOGIES.has(diagram.topology)) {
    return { status: 'rejected', reasonCode: 'USE_EXACT_RENDERER', reason: `diagram "${diagram.ref}" (${diagram.topology}) needs the exact plot/chart/chemistry renderer, not an icon-level drawing`, missingFields: ['exact-renderer-binding'] };
  }
  return { status: 'rejected', reasonCode: 'UNSUPPORTED_TOPOLOGY', reason: `diagram "${diagram.ref}" (${diagram.topology}) has no structural adapter; it needs a drawn scene`, missingFields: ['scene-art'] };
}
