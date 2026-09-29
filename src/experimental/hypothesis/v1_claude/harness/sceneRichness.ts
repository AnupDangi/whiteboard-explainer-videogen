import type { ResolvedScene, SceneSpec } from '../types.js';

/** Structural diagnostics only. They never establish teaching clarity, style, or Simi parity. */
export interface SceneRichness {
  sceneId: string;
  template: string;
  elementCount: number;
  primitiveKinds: string[];
  objectCount: number;
  objectShare: number;
  edgeCount: number;
  factualEdgeCount: number;
  isListScene: boolean;
  rungCounts: Record<'2' | '3' | '4', number>;
}

export interface RichnessSummary {
  scenes: number;
  meanElements: number;
  meanObjectShare: number;
  meanEdges: number;
  listSceneRate: number;
  templateDiversity: number;
  primitiveDiversity: number;
  textFallbackShare: number;
}

const NON_LIST_WITHOUT_EDGES = new Set(['title_card', 'compare_2', 'formula_focus', 'plot_focus', 'list_icon']);

export function sceneRichness(spec: SceneSpec, resolved?: ResolvedScene): SceneRichness {
  const elementCount = spec.elements.length;
  const objectCount = spec.elements.filter((element) => element.prim === 'object').length;
  const edgeCount = spec.edges.length;
  const rungCounts: Record<'2' | '3' | '4', number> = { '2': 0, '3': 0, '4': 0 };

  for (const element of resolved?.elements ?? []) {
    if (element.resolution) rungCounts[String(element.resolution.rung) as '2' | '3' | '4'] += 1;
  }

  return {
    sceneId: spec.sceneId,
    template: spec.template,
    elementCount,
    primitiveKinds: [...new Set(spec.elements.map((element) => element.prim))].sort(),
    objectCount,
    objectShare: elementCount ? objectCount / elementCount : 0,
    edgeCount,
    factualEdgeCount: spec.edges.filter((edge) => Boolean(edge.factualRelation)).length,
    isListScene: spec.template === 'list_icon' || (edgeCount === 0 && elementCount >= 3 && !NON_LIST_WITHOUT_EDGES.has(spec.template)),
    rungCounts,
  };
}

export function summarizeRichness(rows: SceneRichness[]): RichnessSummary {
  const count = rows.length;
  const mean = (pick: (row: SceneRichness) => number) => count ? rows.reduce((sum, row) => sum + pick(row), 0) / count : 0;
  const resolvedObjects = rows.reduce((sum, row) => sum + row.rungCounts['2'] + row.rungCounts['3'] + row.rungCounts['4'], 0);

  return {
    scenes: count,
    meanElements: mean((row) => row.elementCount),
    meanObjectShare: mean((row) => row.objectShare),
    meanEdges: mean((row) => row.edgeCount),
    listSceneRate: mean((row) => Number(row.isListScene)),
    templateDiversity: new Set(rows.map((row) => row.template)).size,
    primitiveDiversity: new Set(rows.flatMap((row) => row.primitiveKinds)).size,
    textFallbackShare: resolvedObjects ? rows.reduce((sum, row) => sum + row.rungCounts['4'], 0) / resolvedObjects : 0,
  };
}
