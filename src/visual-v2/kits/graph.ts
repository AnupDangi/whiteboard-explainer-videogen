import { z } from 'zod';
import { emptyVisual, gridCells, textRun, type Rect } from './geometry.js';
import type { KitDef, KitLayoutInput } from './types.js';

export const GraphParamsSchema = z.object({ nodes: z.number().int().min(2).max(9).optional(), layout: z.enum(['ring', 'grid', 'compound']).optional() }).strict();
type P = z.infer<typeof GraphParamsSchema>;
const slotsFor = (p: P, capacity: number): number => Math.min(9, Math.max(p.nodes ?? 0, capacity, 2));

type GraphInput = NonNullable<KitLayoutInput<P>['graph']>;
/** Fixed layout options. Input order, edge order, and ties are normalized before any coordinates are computed. */
export const COMPOUND_GRAPH_OPTIONS = Object.freeze({ direction: 'right', nodeGap: 44, layerGap: 72, maxNodeWidth: 340, maxNodeHeight: 240 });

export function layoutCompoundGraph(area: Rect, graph: GraphInput): Map<string, Rect> {
  const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const nodes = [...graph.nodes].sort((a, b) => a.seq - b.seq || compareId(a.id, b.id));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = [...graph.edges].filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to).sort((a, b) => compareId(a.id, b.id));
  const waiting = new Set(nodes.map((node) => node.id));
  const ranks = new Map<string, number>();
  // Kahn ordering; a cycle is broken at the lowest stable node. Back edges are still rendered and validated.
  while (waiting.size) {
    const next = nodes.find((node) => waiting.has(node.id) && !edges.some((edge) => edge.to === node.id && waiting.has(edge.from)))
      ?? nodes.find((node) => waiting.has(node.id))!;
    const predecessors = edges.filter((edge) => edge.to === next.id).map((edge) => ranks.get(edge.from)).filter((rank): rank is number => rank !== undefined);
    ranks.set(next.id, predecessors.length ? Math.max(...predecessors) + 1 : 0);
    waiting.delete(next.id);
  }
  const layers = new Map<number, typeof nodes>();
  for (const node of nodes) { const rank = ranks.get(node.id)!; layers.set(rank, [...(layers.get(rank) ?? []), node]); }
  const ordered = [...layers.entries()].sort(([a], [b]) => a - b).map(([, layer]) => layer);
  const size = (node: typeof nodes[number]) => ({ w: Math.max(120, Math.min(COMPOUND_GRAPH_OPTIONS.maxNodeWidth, node.preferred.w)), h: Math.max(96, Math.min(COMPOUND_GRAPH_OPTIONS.maxNodeHeight, node.preferred.h)) });
  const widths = ordered.map((layer) => Math.max(...layer.map((node) => size(node).w)));
  const heights = ordered.map((layer) => layer.reduce((total, node) => total + size(node).h, 0) + COMPOUND_GRAPH_OPTIONS.nodeGap * (layer.length - 1));
  const rawWidth = widths.reduce((a, b) => a + b, 0) + COMPOUND_GRAPH_OPTIONS.layerGap * Math.max(0, ordered.length - 1);
  const rawHeight = Math.max(0, ...heights);
  const scale = Math.min(1, area.w / Math.max(1, rawWidth), area.h / Math.max(1, rawHeight));
  const totalWidth = rawWidth * scale;
  let x = area.x + (area.w - totalWidth) / 2;
  const slots = new Map<string, Rect>();
  ordered.forEach((layer, layerIndex) => {
    const layerHeight = heights[layerIndex]! * scale;
    let y = area.y + (area.h - layerHeight) / 2;
    for (const node of layer) {
      const nodeSize = size(node); const w = nodeSize.w * scale; const h = nodeSize.h * scale;
      slots.set(node.id, { x: x + (widths[layerIndex]! * scale - w) / 2, y, w, h });
      y += h + COMPOUND_GRAPH_OPTIONS.nodeGap * scale;
    }
    x += (widths[layerIndex]! + COMPOUND_GRAPH_OPTIONS.layerGap) * scale;
  });
  return slots;
}

/** Node slots only; the relations between nodes are connect ops drawn as arrows between the nodes that hold them. */
export const graphKit: KitDef<P> = {
  name: 'graph',
  paramsSchema: GraphParamsSchema,
  zones: () => [],
  preferredSize: (p, capacity) => ({ w: 900, h: slotsFor(p, capacity) > 4 ? 640 : 480 }),
  layout({ params, label, rect, capacity, graph }) {
    const n = slotsFor(params, capacity);
    const labelH = label ? 54 : 0;
    const area: Rect = { x: rect.x + 10, y: rect.y + labelH, w: rect.w - 20, h: rect.h - labelH - 10 };
    let slots: Rect[];
    let slotsById: Map<string, Rect> | undefined;
    if (params.layout === 'compound') {
      const provided = graph?.nodes ?? [];
      const nodes = provided.length ? provided : Array.from({ length: n }, (_, i) => ({ id: `slot-${i}`, seq: i, preferred: { w: 150, h: 120 } }));
      slotsById = layoutCompoundGraph(area, { nodes, edges: graph?.edges ?? [] });
      slots = [...slotsById.values()];
    } else if (params.layout === 'grid') slots = gridCells(area, n, 150, 70);
    else {
      const cx = area.x + area.w / 2;
      const cy = area.y + area.h / 2;
      const size = Math.min(150, Math.min(area.w, area.h) * 0.3);
      const rx = area.w / 2 - size / 2;
      const ry = area.h / 2 - size / 2;
      slots = Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return { x: cx + rx * Math.cos(a) - size / 2, y: cy + ry * Math.sin(a) - size / 2, w: size, h: size }; });
    }
    const frame = emptyVisual();
    if (label) frame.texts.push(textRun(rect.x + rect.w / 2, rect.y + 40, label, 32));
    return { frame, slotRect: (_zone, index) => slots[Math.min(index, slots.length - 1)]!, slotCount: () => slots.length,
      ...(slotsById ? { slotRectForChild: (id: string) => slotsById.get(id) } : {}) };
  },
};
