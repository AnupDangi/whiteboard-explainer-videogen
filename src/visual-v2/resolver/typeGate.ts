import type { PrimitiveVisual, ResolutionRecord } from '../../shared/types.js';
import { resolveObject } from '../../assets/ladder.js';
import { chooseSceneFamily } from '../../assets/sceneFamily.js';
import { isSemanticRole, normalizeRole, renderSemanticRole } from '../../render/semanticCore.js';
import { shiftVisual, type Rect } from '../kits/geometry.js';

/**
 * Type-first depiction (V2 plan Phase 7). The kind of a concept decides what may depict it BEFORE any similarity ranking: a concrete
 * entity may get a picture; a process, event, rule or quantity never gets a noun icon (it is shown by kits, state changes and
 * values); a role may take a semantic-core shape. A picture chosen only by similarity is refused. What is refused becomes a
 * labelled box that does not count as meaningful depiction.
 */
export type ConceptKind = 'entity' | 'process' | 'quantity' | 'formula' | 'event' | 'role' | 'rule';
/** `domain` is the lesson domain (S3 lessonBible.domain); matching-domain pictures rank first and a different specific domain excludes fuzzy picks. */
export interface ConceptInfo { id: string; label: string; kind: ConceptKind; domain?: string; /** Selected illustration style for all pictorial entities in this scene. */ houseFamily?: string }
export type DepictionFamily = 'pictorial' | 'role-shape' | 'labelled';

export interface EntityResolution { visual: PrimitiveVisual; resolution: ResolutionRecord }
export type EntityResolver = (label: string, size: { w: number; h: number }, conceptId: string | undefined, lessonDomain?: string, sceneFamily?: string) => EntityResolution;

export interface SceneEntityRequest { concept?: ConceptInfo; label: string }

export interface EntityDepiction {
  family: DepictionFamily;
  /** A real depiction (picture or semantic-core shape), not a labelled box. */
  meaningful: boolean;
  reason: string;
  assetId?: string;
  /** Licence of the picture, and whether it may ship without further review (see `licensePolicy`). */
  license?: string;
  releaseClean?: boolean;
  attributionRequired?: boolean;
  ownerApproved?: boolean;
  visual: PrimitiveVisual;
}

/**
 * Release licence policy. Permissive licences ship as they are; attribution licences ship only with attribution recorded;
 * `OWNER_APPROVED` licences ship on a recorded decision by the project owner. Anything else (review-pending, local-dev, mixed,
 * unknown) may appear in a draft but never counts as release-clean.
 *
 * Owner decision, 2026-10-03, verbatim: "i give you all the permission use flaticons this is sudo permission for flaticon".
 * It covers the catalogue's `Flaticon-review` assets. Flaticon's own terms require attribution, so those assets are
 * release-clean only with attribution recorded (`attributionRequired`). Other review-pending licences stay draft-only.
 */
const PERMISSIVE = new Set(['MIT', 'ISC', 'Apache-2.0', 'CC0-1.0', 'manual']);
const ATTRIBUTION = new Set(['CC-BY-4.0']);
const OWNER_APPROVED_ATTRIBUTION = new Set(['Flaticon-review']);
export function licensePolicy(license: string): { releaseClean: boolean; attributionRequired: boolean; ownerApproved: boolean } {
  const ownerApproved = OWNER_APPROVED_ATTRIBUTION.has(license);
  return { releaseClean: PERMISSIVE.has(license) || ATTRIBUTION.has(license) || ownerApproved, attributionRequired: ATTRIBUTION.has(license) || ownerApproved, ownerApproved };
}

export function depictionFamily(kind: ConceptKind | undefined): DepictionFamily {
  if (kind === 'entity') return 'pictorial';
  if (kind === 'role') return 'role-shape';
  return 'labelled';
}

const defaultResolver: EntityResolver = (label, size, conceptId, lessonDomain, sceneFamily) => {
  const res = resolveObject(label, { label, size, ...(conceptId ? { conceptId } : {}), ...(lessonDomain ? { lessonDomain } : {}), ...(sceneFamily ? { sceneFamily } : {}), visualStrategy: 'literal' });
  return { visual: res.visual, resolution: res.resolution };
};

const EMPTY: PrimitiveVisual = { paths: [], fills: [], texts: [] };

/** Probe only exact, approved pictures, then use the same deterministic majority rule as the V1 scene resolver. */
export function chooseEntitySceneFamily(entities: readonly SceneEntityRequest[], resolver: EntityResolver = defaultResolver): string | undefined {
  const families = entities.filter(({ concept }) => depictionFamily(concept?.kind) === 'pictorial').map(({ concept, label }) => {
    const { resolution } = resolver(label, { w: 240, h: 210 }, concept?.id, concept?.domain);
    if (resolution.rung === 4 || !resolution.assetId || (resolution.selectionBasis !== 'exact' && resolution.selectionBasis !== 'curated')) return undefined;
    return resolution.houseFamily;
  });
  return chooseSceneFamily(families);
}

export function depictEntity(concept: ConceptInfo | undefined, label: string, rect: Rect, resolver: EntityResolver = defaultResolver): EntityDepiction {
  const family = depictionFamily(concept?.kind);
  if (family === 'pictorial') {
    const { visual, resolution } = resolver(label, { w: rect.w, h: rect.h }, concept?.id, concept?.domain, concept?.houseFamily);
    if (resolution.rung === 4 || resolution.assetId === null) return { family: 'labelled', meaningful: false, reason: 'no approved picture for this concept', visual: EMPTY };
    if (resolution.selectionBasis !== 'exact' && resolution.selectionBasis !== 'curated') return { family: 'labelled', meaningful: false, reason: `the picture was chosen by similarity (${resolution.selectionBasis ?? 'unknown'}); a wrong picture is worse than a label`, visual: EMPTY };
    return { family: 'pictorial', meaningful: true, reason: 'exact approved picture', assetId: resolution.assetId, license: resolution.license, ...licensePolicy(resolution.license), visual: shiftVisual(visual, rect.x, rect.y) };
  }
  if (family === 'role-shape') {
    const role = normalizeRole(label);
    const drawn = isSemanticRole(role) ? renderSemanticRole(role, Math.min(rect.w, rect.h)) : undefined;
    if (drawn) return { family: 'role-shape', meaningful: true, reason: `semantic-core role ${role}`, visual: shiftVisual(drawn, rect.x + (rect.w - Math.min(rect.w, rect.h)) / 2, rect.y) };
  }
  return { family: 'labelled', meaningful: false, reason: concept ? `a ${concept.kind} concept is shown by structure, not a noun picture` : 'unknown concept kind', visual: EMPTY };
}
