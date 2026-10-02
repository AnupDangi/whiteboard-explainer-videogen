import type { LaidOutScene, ResolvedScene } from '../shared/types.js';
import type { CatalogEntry } from '../assets/catalog.js';
import { referentKeys } from '../assets/referent.js';

/**
 * Icon/representation audit over a finished run (final_plan/02 §22, §25; Simi benchmark §§6, 53).
 * Pure: reads resolved scenes only. Reports how much of the board is pictorial versus role/label, and
 * flags bindings a reviewer should look at first. It never changes a run and never claims semantic
 * correctness: "suspect" means "a person should check", not "wrong".
 */
export type RepresentationClass = 'pictorial' | 'diagram' | 'role' | 'label' | 'text';

export interface AuditedElement {
  sceneId: string;
  elementId: string;
  concept: string;
  strategy: string;
  representation: RepresentationClass;
  assetId: string | null;
  houseFamily?: string;
}

export interface IconAudit {
  elements: AuditedElement[];
  summary: {
    objectElements: number;
    /** Every concept-bearing node (objects plus labelled boxes/shapes): the denominator a viewer actually sees. */
    conceptNodes: number;
    /** Share of all concept nodes drawn as a real picture or diagram (labelled boxes count against it). */
    pictureShareOfConceptNodes: number;
    /** Distinct library entries drawn across the lesson. */
    distinctPictures: number;
    pictorialShare: number;
    diagramShare: number;
    roleShare: number;
    labelledShare: number;
    familiesPerScene: Record<string, string[]>;
    wrongBindingSuspects: Array<{ sceneId: string; elementId: string; reason: string }>;
  };
}

const classify = (strategy: string | undefined): RepresentationClass => {
  if (!strategy) return 'label';
  if (/^R(0)-/.test(strategy)) return 'pictorial';
  if (/^R(3|4|6|7|8)-/.test(strategy)) return 'pictorial';
  if (/^R1-/.test(strategy)) return 'diagram';
  if (/^R(2|5|9)-/.test(strategy)) return 'role';
  if (/^R11-/.test(strategy)) return 'text';
  return 'label';
};

const tokens = (value: string): Set<string> => new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2) ?? []);

export function auditResolvedScenes(scenes: ReadonlyArray<ResolvedScene | LaidOutScene>, catalog: ReadonlyArray<CatalogEntry> = []): IconAudit {
  const exactNames = new Set(catalog.flatMap((entry) => entry.names.map((name) => name.trim().toLowerCase())));
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const elements: AuditedElement[] = [];
  const suspects: IconAudit['summary']['wrongBindingSuspects'] = [];
  const familiesPerScene: Record<string, string[]> = {};
  let conceptBoxes = 0;
  for (const scene of scenes) {
    const families = new Set<string>();
    for (const el of scene.elements) {
      if ((el.element.prim === 'box' || el.element.prim === 'shape') && el.element.conceptIds?.length) conceptBoxes += 1;
      if (el.element.prim !== 'object') continue;
      const resolution = el.resolution;
      const concept = el.element.concept ?? '';
      const representation = classify(resolution?.strategy);
      elements.push({ sceneId: scene.sceneId, elementId: el.element.id, concept, strategy: resolution?.strategy ?? 'unresolved', representation, assetId: resolution?.assetId ?? null, ...(resolution?.houseFamily ? { houseFamily: resolution.houseFamily } : {}) });
      if (resolution?.houseFamily) families.add(resolution.houseFamily);
      if (representation === 'role' && exactNames.has(referentKeys(concept)[0] ?? concept.toLowerCase())) {
        suspects.push({ sceneId: scene.sceneId, elementId: el.element.id, reason: `role glyph used although "${concept}" has an exact literal icon` });
      }
      if (representation === 'pictorial' && resolution?.selectionBasis === 'curated' && resolution.assetId) {
        const entry = byId.get(resolution.assetId);
        const label = tokens(`${concept} ${el.element.label ?? ''}`);
        const named = tokens(entry?.names.join(' ') ?? '');
        if (entry && ![...named].some((token) => label.has(token))) suspects.push({ sceneId: scene.sceneId, elementId: el.element.id, reason: `validated icon "${entry.names[0]}" shares no word with "${concept}"; confirm by eye` });
      }
    }
    familiesPerScene[scene.sceneId] = [...families].sort();
    if (families.size > 1) suspects.push({ sceneId: scene.sceneId, elementId: '*', reason: `scene mixes families ${[...families].sort().join(', ')}` });
  }
  const share = (kind: RepresentationClass) => (elements.length ? elements.filter((element) => element.representation === kind).length / elements.length : 0);
  const pictures = elements.filter((element) => element.representation === 'pictorial' || element.representation === 'diagram');
  const conceptNodes = elements.length + conceptBoxes;
  return {
    elements,
    summary: {
      objectElements: elements.length,
      conceptNodes,
      pictureShareOfConceptNodes: conceptNodes ? pictures.length / conceptNodes : 0,
      distinctPictures: new Set(pictures.map((element) => element.assetId).filter(Boolean)).size,
      pictorialShare: share('pictorial'), diagramShare: share('diagram'), roleShare: share('role'),
      labelledShare: elements.length ? elements.filter((element) => element.representation === 'label' || element.representation === 'text').length / elements.length : 0,
      familiesPerScene, wrongBindingSuspects: suspects,
    },
  };
}
