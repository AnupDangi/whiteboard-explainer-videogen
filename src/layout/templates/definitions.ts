import type { BBox, TemplateId } from '../../shared/types.js';
import { STYLE } from '../../render/style.js';
import type { Rect } from '../geometry.js';
import { circleLayout, columnLayout, resolveAxisOverlap, rowLayout } from '../geometry.js';
import { assignSlots, type SlotAssignment } from './assign.js';
import { templateSlots } from './catalog.js';

export interface TemplateResult {
  boxes: Map<string, BBox>;
  /** Primary axis the solver should run its overlap-resolution pass along; 'none' skips it (radial templates resolve overlap via growing radius instead). */
  axis: 'x' | 'y' | 'none';
}

export type TemplateFn = (rect: Rect, elements: SlotAssignment[]) => TemplateResult;

const band = (rect: Rect, y0: number, y1: number): Rect => ({ x: rect.x, y: rect.y + rect.h * y0, w: rect.w, h: rect.h * (y1 - y0) });
const column = (rect: Rect, x0: number, x1: number): Rect => ({ x: rect.x + rect.w * x0, y: rect.y, w: rect.w * (x1 - x0), h: rect.h });

const GAP = STYLE.element.gap;

/** Scale a size down (never up) so it fits within maxW x maxH, keeping aspect ratio. */
const fitWithin = (sz: { w: number; h: number }, maxW: number, maxH: number) => {
  const k = Math.min(1, maxW / sz.w, maxH / sz.h);
  return { w: sz.w * k, h: sz.h * k };
};

function place(assignments: SlotAssignment[], boxes: BBox[]): Array<[string, BBox]> {
  return assignments.map((a, i) => [a.elementId, boxes[i]] as [string, BBox]);
}

/** Center many converging inputs in a data-sized grid so 3+ labelled icons do not collapse into a tiny column. */
function gridLayout(rect: Rect, items: SlotAssignment[], gap: number): BBox[] {
  if (items.length < 3) return columnLayout(rect, items.map((i) => i.intrinsic), gap);
  const cols = Math.ceil(Math.sqrt(items.length));
  const rows = Math.ceil(items.length / cols);
  const cellW = rect.w / cols;
  const cellH = rect.h / rows;
  return items.map((item, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const sz = fitWithin(item.intrinsic, cellW - gap / 2, cellH - gap / 2);
    return { x: rect.x + col * cellW + (cellW - sz.w) / 2, y: rect.y + row * cellH + (cellH - sz.h) / 2, w: sz.w, h: sz.h };
  });
}

/** Place ordered items in fixed-height rows, fitting each item to its row cell. */
function orderedRows(rect: Rect, rows: SlotAssignment[][], gap: number): Map<string, BBox> {
  const boxes = new Map<string, BBox>();
  const rowHeight = rect.h / Math.max(1, rows.length);
  rows.forEach((items, rowIndex) => {
    const rowRect = band(rect, rowIndex / rows.length, (rowIndex + 1) / rows.length);
    const cellW = rowRect.w / Math.max(1, items.length);
    const sizes = items.map((item) => fitWithin(item.intrinsic, cellW - gap / 2, rowHeight - gap / 2));
    place(items, rowLayout(rowRect, sizes, Math.min(gap, Math.max(0, (rowRect.w - sizes.reduce((sum, size) => sum + size.w, 0)) / Math.max(1, items.length - 1))))).forEach(([id, box]) => boxes.set(id, box));
  });
  return boxes;
}

/** Preserve order while wrapping a timeline when its intrinsic widths exceed one row. */
function timelineRows(events: SlotAssignment[], width: number, gap: number): SlotAssignment[][] {
  const rows: SlotAssignment[][] = [];
  let row: SlotAssignment[] = [];
  let used = 0;
  for (const event of events) {
    const eventWidth = Math.min(event.intrinsic.w, width);
    const next = used + (row.length ? gap : 0) + eventWidth;
    if (row.length && next > width) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(event);
    used += (row.length > 1 ? gap : 0) + eventWidth;
  }
  if (row.length) rows.push(row);
  return rows;
}

// ---------------------------------------------------------------------------
// 1. title_card — "WHY ATTENTION / The cat sat on the mat"
// ---------------------------------------------------------------------------
const titleCard: TemplateFn = (rect, elements) => {
  const plan = templateSlots('title_card');
  const groups = assignSlots(elements, plan);
  const boxes = new Map<string, BBox>();
  for (const [id, b] of place(groups.get('title')!, rowLayout(band(rect, 0, 0.32), groups.get('title')!.map((a) => a.intrinsic), GAP))) boxes.set(id, b);
  for (const [id, b] of place(groups.get('subtitle')!, rowLayout(band(rect, 0.36, 0.6), groups.get('subtitle')!.map((a) => a.intrinsic), GAP))) boxes.set(id, b);
  for (const [id, b] of place(groups.get('strip')!, rowLayout(band(rect, 0.62, 1), groups.get('strip')!.map((a) => a.intrinsic), GAP))) boxes.set(id, b);
  return { boxes, axis: 'x' };
};

// ---------------------------------------------------------------------------
// 2. hub_spoke — robot -> arrows -> {math, bug, experts}
// ---------------------------------------------------------------------------
const hubSpokeWithGap = (radialGap: number): TemplateFn => (rect, elements) => {
  const plan = templateSlots('hub_spoke');
  const groups = assignSlots(elements, plan);
  const hub = groups.get('hub')!;
  const spokes = groups.get('spoke')!;
  const { center, ring } = circleLayout(rect, spokes.map((s) => s.intrinsic), { center: hub[0]?.intrinsic, radialGap });
  const boxes = new Map<string, BBox>();
  if (hub[0] && center) boxes.set(hub[0].elementId, center);
  spokes.forEach((s, i) => boxes.set(s.elementId, ring[i]));
  return { boxes, axis: 'none' };
};
const hubSpoke = hubSpokeWithGap(24);
/**
 * Dense hub_spoke: the same radial board with the ring pulled in to the
 * exact no-overlap bound, so a dense ring of tall icon+label objects fits at
 * native size instead of taking the solver's shrink-to-fit fallback just
 * below the readability floor. Zero only removes the extra padding — the
 * radius loop still grows until nothing overlaps, so ring boxes never cover
 * each other or the hub. The roomy default above keeps its clearance whenever
 * it fits and is always tried first.
 */
const hubSpokeDense = hubSpokeWithGap(0);

// ---------------------------------------------------------------------------
// 3. chain — ID verified -> reset password -> STOP
// ---------------------------------------------------------------------------
const chain: TemplateFn = (rect, elements) => {
  const plan = templateSlots('chain');
  const groups = assignSlots(elements, plan);
  const nodes = groups.get('node')!;
  const totalWidth = (items: SlotAssignment[]) => items.reduce((sum, item) => sum + item.intrinsic.w, 0) + GAP * Math.max(0, items.length - 1);
  let rowCount = 1;
  // Preserve the one-line chain while it fits. Long sequences wrap in
  // source order instead of shrinking every label to fit a single row.
  while (rowCount < nodes.length) {
    const rows: SlotAssignment[][] = Array.from({ length: rowCount }, () => []);
    nodes.forEach((node, i) => rows[Math.floor(i * rowCount / nodes.length)].push(node));
    if (rows.every((row) => totalWidth(row) <= rect.w)) break;
    rowCount++;
  }
  const boxes = new Map<string, BBox>();
  if (rowCount === 1) {
    for (const [id, box] of place(nodes, rowLayout(rect, nodes.map((n) => n.intrinsic), GAP))) boxes.set(id, box);
  } else {
    for (let row = 0; row < rowCount; row++) {
      const rowNodes = nodes.filter((_, i) => Math.floor(i * rowCount / nodes.length) === row);
      const rowRect = band(rect, row / rowCount, (row + 1) / rowCount);
      for (const [id, box] of place(rowNodes, rowLayout(rowRect, rowNodes.map((node) => node.intrinsic), GAP))) boxes.set(id, box);
    }
  }
  return { boxes, axis: 'x' };
};

// ---------------------------------------------------------------------------
// 4. convergence — keys + query -> x -> softmax -> meter
// ---------------------------------------------------------------------------
const convergence: TemplateFn = (rect, elements) => {
  const plan = templateSlots('convergence');
  const groups = assignSlots(elements, plan);
  const inputs = groups.get('input')!;
  const operator = groups.get('operator')!;
  const outputs = groups.get('output')!;
  // 3+ inputs form a compact visual cluster; a tall single-file column forces the solver
  // to shrink icon labels below the hard readability floor on a 16:9 frame.
  const inRect = column(rect, 0.02, 0.44);
  const opRect = column(rect, 0.47, 0.64);
  const outRect = column(rect, 0.69, 1);
  const boxes = new Map<string, BBox>();
  for (const [id, b] of place(inputs, gridLayout(inRect, inputs, GAP))) boxes.set(id, b);
  for (const [id, b] of place(operator, rowLayout(opRect, operator.map((o) => o.intrinsic), GAP))) boxes.set(id, b);
  for (const [id, b] of place(outputs, columnLayout(outRect, outputs.map((o) => o.intrinsic), GAP))) boxes.set(id, b);
  return { boxes, axis: 'x' };
};

// ---------------------------------------------------------------------------
// 5. fan_out — CAT -> three arrows
// ---------------------------------------------------------------------------
const fanOut: TemplateFn = (rect, elements) => {
  const plan = templateSlots('fan_out');
  const groups = assignSlots(elements, plan);
  const source = groups.get('source')!;
  const targets = groups.get('target')!;
  const srcRect = column(rect, 0, 0.28);
  const tgtRect = column(rect, 0.42, 1);
  const boxes = new Map<string, BBox>();
  for (const [id, b] of place(source, rowLayout(srcRect, source.map((s) => s.intrinsic), GAP))) boxes.set(id, b);
  for (const [id, b] of place(targets, columnLayout(tgtRect, targets.map((t) => t.intrinsic), GAP))) boxes.set(id, b);
  return { boxes, axis: 'y' };
};

/**
 * Dense fan_out: the source sits at the centre and targets are spaced on an
 * elliptical ring, so every straight source->target arrow is a separate ray
 * and no target column has to be shrunk below readable text size. The solver
 * tries this only when the column layout cannot fit at native size.
 */
const fanOutDense: TemplateFn = (rect, elements) => {
  const plan = templateSlots('fan_out');
  const groups = assignSlots(elements, plan);
  const source = groups.get('source')!;
  const targets = groups.get('target')!;
  const { center, ring } = circleLayout(rect, targets.map((t) => t.intrinsic), { center: source[0]?.intrinsic });
  const boxes = new Map<string, BBox>();
  if (source[0] && center) boxes.set(source[0].elementId, center);
  targets.forEach((t, i) => boxes.set(t.elementId, ring[i]));
  return { boxes, axis: 'none' };
};

// ---------------------------------------------------------------------------
// 6. list_icon — quickly / reliably / cheaply
// ---------------------------------------------------------------------------
const listIcon: TemplateFn = (rect, elements) => {
  const plan = templateSlots('list_icon');
  const groups = assignSlots(elements, plan);
  const items = groups.get('item')!;
  const sizes = items.map((i) => i.intrinsic);
  const totalH = sizes.reduce((s, z) => s + z.h, 0) + GAP * Math.max(0, sizes.length - 1);
  // A single column when it fits; otherwise a grid of rows (reference frames lay long lists out as rows of icons).
  if (totalH <= rect.h || items.length <= 2) return { boxes: new Map<string, BBox>(place(items, columnLayout(rect, sizes, GAP))), axis: 'y' };
  const perRow = Math.min(4, Math.ceil(Math.sqrt(items.length * (rect.w / rect.h))));
  const rows = Math.ceil(items.length / perRow);
  const boxes = new Map<string, BBox>();
  for (let r = 0; r < rows; r++) {
    const slice = items.slice(r * perRow, (r + 1) * perRow);
    for (const [id, b] of place(slice, rowLayout(band(rect, r / rows, (r + 1) / rows), slice.map((i) => i.intrinsic), GAP))) boxes.set(id, b);
  }
  return { boxes, axis: 'x' };
};

// ---------------------------------------------------------------------------
// 7. compare_2 — smartest model vs cheap system
// ---------------------------------------------------------------------------
const compare2: TemplateFn = (rect, elements) => {
  const plan = templateSlots('compare_2');
  const groups = assignSlots(elements, plan);
  const left = groups.get('left')!;
  const right = groups.get('right')!;
  const verdict = groups.get('verdict')!;
  const topRect = band(rect, 0, 0.72);
  const bottomRect = band(rect, 0.8, 1);
  const leftRect = column(topRect, 0, 0.48);
  const rightRect = column(topRect, 0.52, 1);
  const boxes = new Map<string, BBox>();
  for (const [id, b] of place(left, rowLayout(leftRect, left.map((l) => l.intrinsic), GAP))) boxes.set(id, b);
  for (const [id, b] of place(right, rowLayout(rightRect, right.map((r) => r.intrinsic), GAP))) boxes.set(id, b);
  for (const [id, b] of place(verdict, rowLayout(bottomRect, verdict.map((v) => v.intrinsic), GAP))) boxes.set(id, b);
  return { boxes, axis: 'x' };
};

// ---------------------------------------------------------------------------
// 8. threshold — task -> intelligence threshold bar
// ---------------------------------------------------------------------------
const threshold: TemplateFn = (rect, elements) => {
  const plan = templateSlots('threshold');
  const groups = assignSlots(elements, plan);
  const subject = groups.get('subject')!;
  const bar = groups.get('bar')!;
  const marker = groups.get('marker')!;
  const boxes = new Map<string, BBox>();
  const stackRect = band(rect, 0.2, 1);
  const stacked = columnLayout(stackRect, [...subject, ...bar].map((a) => a.intrinsic), GAP);
  [...subject, ...bar].forEach((a, i) => boxes.set(a.elementId, stacked[i]));
  if (marker[0]) {
    const barBox = bar[0] ? boxes.get(bar[0].elementId)! : { x: rect.x, y: rect.y, w: rect.w, h: 0 };
    const m = marker[0].intrinsic;
    boxes.set(marker[0].elementId, { x: barBox.x + barBox.w * 0.7 - m.w / 2, y: barBox.y - m.h - GAP / 4, w: m.w, h: m.h });
  }
  return { boxes, axis: 'y' };
};

// ---------------------------------------------------------------------------
// 9. weighted_blend — chests + weights -> weighted sum -> new vector
//    Reference layout (Lamina "Blending the Values"): inputs stacked in a left
//    column, each weight tag beside its input, arrows converging on the
//    combiner in the middle, result on the right.
// ---------------------------------------------------------------------------
const weightedBlend: TemplateFn = (rect, elements) => {
  const plan = templateSlots('weighted_blend');
  const groups = assignSlots(elements, plan);
  const inputs = groups.get('input')!;
  const weights = groups.get('weight')!;
  const combiner = groups.get('combiner')!;
  const result = groups.get('result')!;
  const boxes = new Map<string, BBox>();
  // Give the stacked rows enough vertical rhythm to occupy the board after
  // labels and weight tags are added. The former half-gap left a large empty
  // band in common three-input scenes and triggered the occupancy warning.
  const rowGap = GAP * 1.25;
  const inBoxes = columnLayout(column(rect, 0, 0.26), inputs.map((i) => i.intrinsic), rowGap);
  inputs.forEach((a, i) => boxes.set(a.elementId, inBoxes[i]));
  // Weight i sits level with input i (falls back to its own column slot if there are more weights than inputs).
  const wCol = column(rect, 0.27, 0.4);
  const wFallback = columnLayout(wCol, weights.map((w) => w.intrinsic), rowGap);
  weights.forEach((a, i) => {
    const anchor = inBoxes[i];
    // Sit just ABOVE the input's outgoing arrow line (a tag on the arrow), never on it.
    const b = anchor ? { x: wCol.x + (wCol.w - a.intrinsic.w) / 2, y: anchor.y + anchor.h / 2 - a.intrinsic.h - 10, w: a.intrinsic.w, h: a.intrinsic.h } : wFallback[i];
    boxes.set(a.elementId, b);
  });
  for (const [id, b] of place(combiner, rowLayout(column(rect, 0.5, 0.68), combiner.map((c) => c.intrinsic), GAP))) boxes.set(id, b);
  for (const [id, b] of place(result, rowLayout(column(rect, 0.76, 1), result.map((r) => r.intrinsic), GAP))) boxes.set(id, b);
  return { boxes, axis: 'none' };
};

// ---------------------------------------------------------------------------
// 10. layered_stack — network layers / OSI stack
// ---------------------------------------------------------------------------
const stackWithGap = (layerGap: number): TemplateFn => (rect, elements) => {
  const plan = templateSlots('layered_stack');
  const groups = assignSlots(elements, plan);
  const layers = groups.get('layer')!;
  const wideRect = { x: rect.x + rect.w * 0.1, y: rect.y, w: rect.w * 0.8, h: rect.h };
  const sizes = layers.map((l) => ({ w: wideRect.w, h: l.intrinsic.h }));
  const boxes = new Map<string, BBox>(place(layers, columnLayout(wideRect, sizes, layerGap)));
  // columnLayout never overlaps; the solver's axis pass would re-space layers at the full GAP.
  return { boxes, axis: 'none' };
};
const layeredStack = stackWithGap(GAP / 2);
/** Dense stack: layers nearly touch, like a stacked-plates diagram. */
const layeredStackDense = stackWithGap(8);

// ---------------------------------------------------------------------------
// 11. cycle — photosynthesis / immune loop
// ---------------------------------------------------------------------------
const cycle: TemplateFn = (rect, elements) => {
  const plan = templateSlots('cycle');
  const groups = assignSlots(elements, plan);
  const nodes = groups.get('node')!;
  const { ring } = circleLayout(rect, nodes.map((n) => n.intrinsic));
  const boxes = new Map<string, BBox>();
  nodes.forEach((n, i) => boxes.set(n.elementId, ring[i]));
  return { boxes, axis: 'none' };
};

// ---------------------------------------------------------------------------
// 12. formula_focus — derivation with annotated parts
// ---------------------------------------------------------------------------
const formulaFocus: TemplateFn = (rect, elements) => {
  // Up to 4 stacked formula lines (a derivation, one step per line), callouts underneath.
  const plan = templateSlots('formula_focus');
  const groups = assignSlots(elements, plan);
  const formula = groups.get('formula')!;
  const callouts = groups.get('callout')!;
  const boxes = new Map<string, BBox>();
  // Callouts that cannot share one row wrap into several. The callout band takes the height its rows need (icons are
  // tall), bounded so the formula lines keep room; the formula gets the rest.
  const calloutRows = timelineRows(callouts, rect.w, GAP);
  const wrapped = calloutRows.length > 1;
  const calloutNeed = calloutRows.length * (Math.max(0, ...callouts.map((c) => c.intrinsic.h)) + GAP);
  const formulaNeed = formula.reduce((sum, f) => sum + f.intrinsic.h + GAP / 2, 0);
  const calloutShare = callouts.length ? Math.min(0.8, Math.max(wrapped ? 0.5 : 0.3, calloutNeed / Math.max(1, calloutNeed + formulaNeed))) : 0;
  const top = callouts.length ? band(rect, 0, 1 - calloutShare - 0.04) : rect;
  const lineH = (top.h - (GAP / 2) * Math.max(0, formula.length - 1)) / Math.max(1, formula.length);
  for (const [id, b] of place(formula, columnLayout(top, formula.map((f) => fitWithin(f.intrinsic, top.w, lineH)), GAP / 2))) boxes.set(id, b);
  // Callouts keep narrated order and wrap into rows when one row cannot hold them at readable size.
  const calloutRect = band(rect, 1 - calloutShare, 1);
  if (!wrapped) {
    for (const [id, b] of place(callouts, rowLayout(calloutRect, callouts.map((c) => c.intrinsic), GAP))) boxes.set(id, b);
  } else {
    for (const [id, b] of orderedRows(calloutRect, calloutRows, GAP)) boxes.set(id, b);
  }
  return { boxes, axis: 'x' };
};

// ---------------------------------------------------------------------------
// 13. plot_focus — a graph that IS the explanation (slope, tangent, descent
//     steps), with its formula and callouts beside it.
// ---------------------------------------------------------------------------
const plotFocus: TemplateFn = (rect, elements) => {
  const plan = templateSlots('plot_focus');
  const groups = assignSlots(elements, plan);
  const plot = groups.get('plot')!;
  const formula = groups.get('formula')!;
  const callouts = groups.get('callout')!;
  const boxes = new Map<string, BBox>();
  const side = column(rect, 0.6, 1);
  const plotRect = column(rect, 0, 0.56);
  const formulaRect = band(side, 0, callouts.length ? 0.45 : 1);
  const calloutRect = band(side, 0.5, 1);
  // Each item is fitted to its own column so a long formula never forces the plot to shrink.
  for (const [id, b] of place(plot, rowLayout(plotRect, plot.map((p) => fitWithin(p.intrinsic, plotRect.w, plotRect.h)), GAP))) boxes.set(id, b);
  for (const [id, b] of place(formula, columnLayout(formulaRect, formula.map((f) => fitWithin(f.intrinsic, formulaRect.w, formulaRect.h / Math.max(1, formula.length) - GAP / 2)), GAP / 2))) boxes.set(id, b);
  for (const [id, b] of place(callouts, columnLayout(calloutRect, callouts.map((c) => fitWithin(c.intrinsic, calloutRect.w, calloutRect.h)), GAP / 2))) boxes.set(id, b);
  return { boxes, axis: 'none' };
};

// ---------------------------------------------------------------------------
// 14. hierarchy_tree — ordered levels from whole to subparts
// ---------------------------------------------------------------------------
const hierarchyTree: TemplateFn = (rect, elements) => {
  const groups = assignSlots(elements, templateSlots('hierarchy_tree'));
  const rows = ['root', 'branch', 'leaf'].map((slot) => groups.get(slot)!).filter((row) => row.length > 0);
  return { boxes: orderedRows(rect, rows, GAP), axis: 'none' };
};

// ---------------------------------------------------------------------------
// 15. decision_tree — condition branches and their outcomes
// ---------------------------------------------------------------------------
const decisionTree: TemplateFn = (rect, elements) => {
  const groups = assignSlots(elements, templateSlots('decision_tree'));
  const rows = ['root', 'branch', 'outcome'].map((slot) => groups.get(slot)!).filter((row) => row.length > 0);
  return { boxes: orderedRows(rect, rows, GAP), axis: 'none' };
};

// ---------------------------------------------------------------------------
// 16. timeline — ordered events, wrapped without changing source order
// ---------------------------------------------------------------------------
const timeline: TemplateFn = (rect, elements) => {
  const groups = assignSlots(elements, templateSlots('timeline'));
  const rows = timelineRows(groups.get('event')!, rect.w, GAP);
  return { boxes: orderedRows(rect, rows, GAP), axis: 'none' };
};

// ---------------------------------------------------------------------------
// 17. rule_exception — general case, exception, and consequence
// ---------------------------------------------------------------------------
const ruleException: TemplateFn = (rect, elements) => {
  const groups = assignSlots(elements, templateSlots('rule_exception'));
  const boxes = new Map<string, BBox>();
  const active = (['rule', 'exception', 'consequence'] as const).map((slot) => ({ slot, items: groups.get(slot)! })).filter(({ items }) => items.length > 0);
  active.forEach(({ slot, items }, index) => {
    const start = index / active.length;
    const end = (index + 1) / active.length;
    const band = column(rect, start + (index ? 0.02 : 0), end - (index + 1 < active.length ? 0.02 : 0));
    place(items, rowLayout(band, items.map((item) => fitWithin(item.intrinsic, band.w, band.h)), GAP)).forEach(([id, box]) => boxes.set(id, box));
  });
  return { boxes, axis: 'none' };
};

// ---------------------------------------------------------------------------
// 18. claim_evidence — one claim linked to its supporting evidence
// ---------------------------------------------------------------------------
const claimEvidence: TemplateFn = (rect, elements) => {
  const groups = assignSlots(elements, templateSlots('claim_evidence'));
  const claim = groups.get('claim')!;
  const evidence = groups.get('evidence')!;
  const boxes = new Map<string, BBox>();
  const claimRect = column(rect, 0, 0.36);
  const evidenceRect = column(rect, 0.42, 1);
  place(claim, rowLayout(claimRect, claim.map((item) => fitWithin(item.intrinsic, claimRect.w, claimRect.h)), GAP)).forEach(([id, box]) => boxes.set(id, box));
  const evidenceBoxes = evidence.length > 2
    ? gridLayout(evidenceRect, evidence, GAP)
    : columnLayout(evidenceRect, evidence.map((item) => fitWithin(item.intrinsic, evidenceRect.w, evidenceRect.h / Math.max(1, evidence.length))), GAP);
  place(evidence, evidenceBoxes).forEach(([id, box]) => boxes.set(id, box));
  return { boxes, axis: 'none' };
};

export const TEMPLATES: Record<TemplateId, TemplateFn> = {
  title_card: titleCard,
  hub_spoke: hubSpoke,
  chain,
  convergence,
  fan_out: fanOut,
  list_icon: listIcon,
  compare_2: compare2,
  threshold,
  weighted_blend: weightedBlend,
  layered_stack: layeredStack,
  cycle,
  formula_focus: formulaFocus,
  plot_focus: plotFocus,
  hierarchy_tree: hierarchyTree,
  decision_tree: decisionTree,
  timeline,
  rule_exception: ruleException,
  claim_evidence: claimEvidence,
};

/**
 * Alternate geometry for boards whose default template only fits by shrinking
 * (growth factor < 1, which drops text below the readability floor). Same
 * slots and semantics; only placement differs.
 */
export const DENSE_TEMPLATES: Partial<Record<TemplateId, TemplateFn>> = {
  fan_out: fanOutDense,
  layered_stack: layeredStackDense,
  hub_spoke: hubSpokeDense,
};

export function applyAxisOverlapFix(boxes: Map<string, BBox>, axis: 'x' | 'y' | 'none', gap: number): Map<string, BBox> {
  if (axis === 'none') return boxes;
  const ids = [...boxes.keys()];
  const fixed = resolveAxisOverlap(ids.map((id) => boxes.get(id)!), axis, gap);
  return new Map(ids.map((id, i) => [id, fixed[i]]));
}
