import type { BoardEdge, BoardElement, BoardState } from '../visual-v2/board-state/types.js';
import { isExemptFamily } from '../assets/sceneFamily.js';

/**
 * Structural richness of V2 boards (offline, deterministic). It counts what is drawn; it never establishes teaching
 * quality. Names mirror V1 `RichnessSummary` where the meaning matches; V1 rung counts (resolutionMetrics.ts) do not apply to V2.
 */
export interface IconUse { elementId: string; referent: string; assetId: string; houseFamily?: string; sidePx: number; kind: 'entity-picture' | 'badge' }
export interface V2SceneRichnessInput { sceneId: string; states: readonly BoardState[]; icons: readonly IconUse[] }
export interface V2SceneRichness {
  sceneId: string;
  elementCount: number;
  entityCount: number;
  tokenCount: number;
  edgeCount: number;
  /** Entities and tokens: the elements drawn as labelled boxes unless they carry a picture. */
  depictableCount: number;
  iconBearingCount: number;
  labelOnlyEntityCount: number;
  distinctAssetIds: string[];
  iconFamilies: string[];
  familyMix: boolean;
  /** Assets drawn for more than one referent in this scene (target 0). */
  assetReuseConflicts: number;
  minIconSidePx: number | null;
  textChars: number;
  wordsOnBoard: number;
  elementVariety: string[];
}
export interface V2RichnessSummary {
  scenes: number;
  iconBearingShare: number | null;
  labelOnlyEntityRatio: number | null;
  distinctAssetIds: number;
  familyMixScenes: number;
  assetReuseConflicts: number;
  minIconSidePx: number | null;
  meanTextChars: number;
  meanWordsOnBoard: number;
  meanElementVariety: number;
}

function textOf(el: BoardElement): string {
  const spec = el.spec;
  switch (spec.type) {
    case 'entity': return spec.label;
    case 'token': return spec.text;
    case 'text': return spec.text;
    case 'value': return `${spec.label} ${String(el.value ?? spec.value)}${spec.unit ? ` ${spec.unit}` : ''}`;
    case 'kit': return spec.label ?? '';
    case 'equation': return '';
  }
}
const wordCount = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

export function measureV2Scene(input: V2SceneRichnessInput): V2SceneRichness {
  const live = new Map<string, BoardElement>();
  const edges = new Map<string, BoardEdge>();
  for (const state of input.states) {
    for (const el of Object.values(state.elements)) if (el.lifecycle.removedAtBeat === undefined && !live.has(el.id)) live.set(el.id, el);
    for (const edge of Object.values(state.edges)) if (edge.lifecycle.removedAtBeat === undefined && !edges.has(edge.id)) edges.set(edge.id, edge);
  }
  const elements = [...live.values()];
  const icons = input.icons.filter((icon) => live.has(icon.elementId));
  const withIcon = new Set(icons.map((icon) => icon.elementId));
  const depictable = elements.filter((el) => el.spec.type === 'entity' || el.spec.type === 'token');
  const entities = elements.filter((el) => el.spec.type === 'entity');
  const referentsByAsset = new Map<string, Set<string>>();
  for (const icon of icons) referentsByAsset.set(icon.assetId, (referentsByAsset.get(icon.assetId) ?? new Set<string>()).add(icon.referent));
  const iconFamilies = [...new Set(icons.map((icon) => icon.houseFamily).filter((family): family is string => !isExemptFamily(family)))].sort();
  const texts = [...elements.map(textOf), ...[...edges.values()].map((edge) => edge.label ?? '')];
  return {
    sceneId: input.sceneId,
    elementCount: elements.length,
    entityCount: entities.length,
    tokenCount: depictable.length - entities.length,
    edgeCount: edges.size,
    depictableCount: depictable.length,
    iconBearingCount: depictable.filter((el) => withIcon.has(el.id)).length,
    labelOnlyEntityCount: entities.filter((el) => !withIcon.has(el.id)).length,
    distinctAssetIds: [...referentsByAsset.keys()].sort(),
    iconFamilies,
    familyMix: iconFamilies.length > 1,
    assetReuseConflicts: [...referentsByAsset.values()].filter((referents) => referents.size > 1).length,
    minIconSidePx: icons.length ? Math.min(...icons.map((icon) => icon.sidePx)) : null,
    textChars: texts.reduce((sum, text) => sum + text.length, 0),
    wordsOnBoard: texts.reduce((sum, text) => sum + wordCount(text), 0),
    elementVariety: [...new Set(elements.map((el) => (el.spec.type === 'kit' ? `kit:${el.spec.kit}` : el.spec.type)))].sort(),
  };
}

export function summarizeV2Richness(rows: readonly V2SceneRichness[]): V2RichnessSummary {
  const sum = (pick: (row: V2SceneRichness) => number): number => rows.reduce((total, row) => total + pick(row), 0);
  const mean = (pick: (row: V2SceneRichness) => number): number => (rows.length ? sum(pick) / rows.length : 0);
  const depictable = sum((row) => row.depictableCount);
  const entities = sum((row) => row.entityCount);
  const sides = rows.flatMap((row) => (row.minIconSidePx === null ? [] : [row.minIconSidePx]));
  return {
    scenes: rows.length,
    iconBearingShare: depictable ? sum((row) => row.iconBearingCount) / depictable : null,
    labelOnlyEntityRatio: entities ? sum((row) => row.labelOnlyEntityCount) / entities : null,
    distinctAssetIds: new Set(rows.flatMap((row) => row.distinctAssetIds)).size,
    familyMixScenes: rows.filter((row) => row.familyMix).length,
    assetReuseConflicts: sum((row) => row.assetReuseConflicts),
    minIconSidePx: sides.length ? Math.min(...sides) : null,
    meanTextChars: mean((row) => row.textChars),
    meanWordsOnBoard: mean((row) => row.wordsOnBoard),
    meanElementVariety: mean((row) => row.elementVariety.length),
  };
}
