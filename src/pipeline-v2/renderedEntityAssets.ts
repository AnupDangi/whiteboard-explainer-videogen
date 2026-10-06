import { depictEntity, type ConceptInfo, type DepictionFamily } from '../visual-v2/resolver/typeGate.js';

export interface RenderedEntityAssetEvidence {
  elementId: string;
  conceptId: string;
  selectedAssetId: string | null;
  resolvedAssetId: string | null;
  depictionFamily: DepictionFamily;
  meaningful: boolean;
  pathCount: number;
  fillCount: number;
  embedCount: number;
  resolutionReason: string;
}

export interface RenderedEntityAssetAudit {
  evidence: RenderedEntityAssetEvidence[];
  problems: string[];
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;

/**
 * Resolve every entity that is live in at least one captured board state using the same type gate as the SVG renderer.
 * The result is pinned with the semantic execution record so a selected library id cannot silently stand in for a label.
 */
export function auditRenderedEntityAssets(
  states: readonly unknown[],
  rectsByState: readonly (readonly unknown[])[],
  conceptEntries: readonly (readonly [string, unknown])[],
): RenderedEntityAssetAudit {
  const problems: string[] = [];
  const concepts = new Map<string, ConceptInfo>();
  for (const [id, raw] of conceptEntries) {
    const value = record(raw);
    if (value && typeof value.id === 'string' && typeof value.label === 'string'
      && ['entity', 'process', 'quantity', 'formula', 'event', 'role', 'rule'].includes(String(value.kind))) {
      concepts.set(id, value as unknown as ConceptInfo);
    }
  }

  const rectByElementId = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const stateRects of rectsByState) {
    for (const raw of stateRects) {
      const placed = record(raw);
      const rect = record(placed?.rect);
      if (typeof placed?.id === 'string' && rect
        && [rect.x, rect.y, rect.w, rect.h].every((value) => typeof value === 'number' && Number.isFinite(value))) {
        rectByElementId.set(placed.id, rect as unknown as { x: number; y: number; w: number; h: number });
      }
    }
  }

  const liveEntities = new Map<string, { conceptId: string; label: string }>();
  for (const rawState of states) {
    const elements = record(record(rawState)?.elements);
    for (const [elementId, rawElement] of Object.entries(elements ?? {})) {
      const element = record(rawElement);
      const spec = record(element?.spec);
      const lifecycle = record(element?.lifecycle);
      if (spec?.type !== 'entity' || typeof spec.conceptId !== 'string' || typeof spec.label !== 'string' || lifecycle?.removedAtBeat !== undefined) continue;
      if (!liveEntities.has(elementId)) liveEntities.set(elementId, { conceptId: spec.conceptId, label: spec.label });
    }
  }

  const evidence = [...liveEntities].sort(([left], [right]) => left.localeCompare(right)).flatMap(([elementId, entity]) => {
    const rect = rectByElementId.get(elementId);
    if (!rect) {
      problems.push(`live entity ${elementId} has no captured layout rectangle`);
      return [];
    }
    const concept = concepts.get(entity.conceptId);
    const depiction = depictEntity(concept, entity.label, { ...rect, x: 0, y: 0 });
    const selectedAssetId = typeof concept?.validatedAssetId === 'string' ? concept.validatedAssetId : null;
    return [{
      elementId,
      conceptId: entity.conceptId,
      selectedAssetId,
      resolvedAssetId: depiction.assetId ?? null,
      depictionFamily: depiction.family,
      meaningful: depiction.meaningful,
      pathCount: depiction.visual.paths.length,
      fillCount: depiction.visual.fills.length,
      embedCount: depiction.visual.embeds?.length ?? 0,
      resolutionReason: depiction.reason,
    }];
  });
  return { evidence, problems };
}

export function unrenderedSelectedConceptIds(
  selectedAssetIds: Readonly<Record<string, string>>,
  renderedEntities: readonly RenderedEntityAssetEvidence[],
): string[] {
  const renderedConceptIds = new Set(renderedEntities.map((entity) => entity.conceptId));
  return Object.keys(selectedAssetIds).filter((conceptId) => !renderedConceptIds.has(conceptId)).sort();
}

export function selectedIconVisibilityProblems(renderedEntities: readonly RenderedEntityAssetEvidence[]): string[] {
  return renderedEntities.flatMap((entity) => {
    if (!entity.selectedAssetId) return [];
    const drawable = entity.pathCount + entity.fillCount + entity.embedCount > 0;
    if (entity.depictionFamily === 'pictorial' && entity.meaningful && drawable && entity.resolvedAssetId === entity.selectedAssetId) return [];
    return [`${entity.conceptId} (${entity.elementId}) selected ${entity.selectedAssetId} but resolved to ${entity.depictionFamily}${entity.resolvedAssetId ? `/${entity.resolvedAssetId}` : ''} with ${entity.pathCount} paths, ${entity.fillCount} fills, and ${entity.embedCount} embeds`];
  });
}
