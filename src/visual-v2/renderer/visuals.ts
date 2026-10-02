import type { PrimitiveVisual, StrokePath } from '../../shared/types.js';
import { STYLE } from '../../render/style.js';
import { fitFont, fitText, lineBaselines } from '../layout/textFit.js';
import { typesetTex } from '../../render/math.js';
import type { BoardEdge, BoardElement } from '../board-state/types.js';
import type { SceneGeometry } from '../layout/sceneLayout.js';
import { arrowPaths, borderPoint, boxPath, center, emptyVisual, fillOf, linePath, textRun, upper, type Rect } from '../kits/geometry.js';
import { canonicalHash } from '../../harness/replayDeterminism.js';
import { depictEntity, type ConceptInfo, type EntityResolver } from '../resolver/typeGate.js';

const PROVENANCE_FILL: Record<string, string> = { source: STYLE.palette.blue, derived: STYLE.palette.green, illustrative: STYLE.palette.yellow, metaphorical: STYLE.palette.purple };
const ENTITY_FILLS = [STYLE.palette.blue, STYLE.palette.green, STYLE.palette.orange, STYLE.palette.purple, STYLE.palette.yellow];
/** A `color` transform names a palette token; anything else is ignored here and refused by validation. */
const toneOf = (el: BoardElement, fallback: string): string => { const name = el.props.color; return typeof name === 'string' && name !== 'none' && name in STYLE.palette ? STYLE.palette[name as keyof typeof STYLE.palette] : fallback; };

export const entityFill = (conceptId: string): string => ENTITY_FILLS[Number.parseInt(canonicalHash(conceptId).slice(0, 4), 16) % ENTITY_FILLS.length]!;

export { fitFont };

/** A label centred in its rectangle, wrapped onto up to three lines when one line would be too small to read. */
function fittedRuns(rect: Rect, text: string, width: number, base?: number) {
  const fitted = fitText(text, width, rect.h - 8, base);
  const ys = lineBaselines(rect.y + rect.h / 2, fitted);
  return fitted.lines.map((line, i) => textRun(rect.x + rect.w / 2, ys[i]!, line, fitted.size));
}

function labelledBox(rect: Rect, label: string, fill: string): PrimitiveVisual {
  const path = boxPath(rect, 18);
  return { paths: [path], fills: [fillOf(path, fill)], texts: fittedRuns(rect, label, rect.w - 16) };
}

/** An element's drawing at full reveal, in canvas coordinates. Pictures for entities come from the resolver; this is the typed fallback. */
export type ConceptIndex = ReadonlyMap<string, ConceptInfo>;

export function elementVisual(el: BoardElement, rect: Rect, geometry: SceneGeometry, concepts?: ConceptIndex, resolver?: EntityResolver): PrimitiveVisual {
  const spec = el.spec;
  switch (spec.type) {
    case 'kit': return geometry.kitGeometry(el.id)?.frame ?? emptyVisual();
    case 'token': return labelledBox(rect, spec.text, toneOf(el, PROVENANCE_FILL[spec.provenance] ?? STYLE.palette.grey));
    case 'entity': {
      // Type first: only a concrete entity with an exact approved picture is drawn as a picture; everything else is a labelled box.
      const depiction = depictEntity(concepts?.get(spec.conceptId), spec.label, rect, resolver);
      return depiction.meaningful ? depiction.visual : labelledBox(rect, spec.label, toneOf(el, entityFill(spec.conceptId)));
    }
    case 'value': {
      const path = boxPath(rect, rect.h / 2);
      const text = `${spec.label}: ${String(el.value ?? spec.value)}${spec.unit ? ` ${spec.unit}` : ''}`;
      return { paths: [path], fills: [fillOf(path, toneOf(el, PROVENANCE_FILL[spec.provenance] ?? STYLE.palette.grey))], texts: fittedRuns(rect, text, rect.w - 40) };
    }
    case 'text': {
      const base = spec.role === 'title' ? STYLE.font.sizes.title : spec.role === 'label' ? STYLE.font.sizes.label : 30;
      return { paths: [], fills: [], texts: fittedRuns(rect, spec.text, rect.w, base) };
    }
    case 'equation': {
      // The whole derivation: every step on its own line, earlier lines dimmed, the rule that produced each line beside it.
      const steps = el.steps && el.steps.length ? el.steps : [{ latex: String(el.value ?? spec.latex), rule: 'given', beatId: '' }];
      const rowH = rect.h / steps.length;
      const captionW = steps.length > 1 ? Math.min(380, rect.w * 0.34) : 0;
      const out: PrimitiveVisual = { paths: [], fills: [], texts: [], embeds: [] };
      steps.forEach((step, i) => {
        const row: Rect = { x: rect.x, y: rect.y + i * rowH, w: rect.w - captionW, h: rowH };
        const typeset = typesetTex(step.latex);
        const latest = i === steps.length - 1;
        if (typeset) {
          const h0 = Math.min(row.h * 0.78, 150);
          const w = Math.min(row.w - 20, h0 * typeset.aspect);
          const h = w / typeset.aspect;
          const body = latest ? typeset.body : `<g opacity="0.45">${typeset.body}</g>`;
          out.embeds!.push({ x: row.x + (row.w - w) / 2, y: row.y + (row.h - h) / 2, w, h, viewBox: typeset.viewBox, body });
        } else out.texts.push(textRun(row.x + row.w / 2, row.y + row.h / 2, step.latex, 40));
        if (captionW && i > 0) out.texts.push(textRun(rect.x + rect.w - captionW + 12, row.y + row.h / 2 + 10, step.rule, fitFont(step.rule, captionW - 12, 28), 'start'));
      });
      return out;
    }
  }
}

/** A marker ring around an element (highlight). */
export function ringVisual(rect: Rect): PrimitiveVisual {
  const outer: Rect = { x: rect.x - 12, y: rect.y - 12, w: rect.w + 24, h: rect.h + 24 };
  return { paths: [{ ...boxPath(outer, 24), width: 6, color: STYLE.palette.orange }], fills: [], texts: [] };
}

/** A strike-through across an element. */
export function strikeVisual(rect: Rect): PrimitiveVisual {
  const path: StrokePath = { ...linePath(rect.x + 8, rect.y + rect.h - 8, rect.x + rect.w - 8, rect.y + 8), width: 7, color: STYLE.palette.red };
  return { paths: [path], fills: [], texts: [] };
}

/** An arrow between two element rects, from border to border; weight thickens it. */
export function edgeVisual(edge: BoardEdge, from: Rect, to: Rect): PrimitiveVisual {
  const a = borderPoint(from, center(to), 8);
  const b = borderPoint(to, center(from), 8);
  const width = 3 + 7 * (edge.weight ?? 0.3);
  const paths = arrowPaths(a.x, a.y, b.x, b.y, 22).map((p) => ({ ...p, width }));
  const texts = edge.label ? [textRun((a.x + b.x) / 2, (a.y + b.y) / 2 - 16, edge.label, STYLE.font.sizes.note)] : [];
  return { paths, fills: [], texts };
}

export { upper };
