import type { PrimitiveVisual } from '../../shared/types.js';
import type { CatalogEntry } from '../../assets/catalog.js';
import { allCatalogEntries } from '../../assets/semantic.js';
import { resolveObject } from '../../assets/ladder.js';
import { referentOf } from '../../assets/referent.js';
import { chooseSceneFamily, isExemptFamily } from '../../assets/sceneFamily.js';
import { loadBadgeReview, reviewKey, type BadgeReview } from '../../assets/badgeReview.js';
import { licensePolicy, type ConceptInfo } from './typeGate.js';

/**
 * Icon badges: a small picture on a labelled card when the card's own label names one concrete thing that the catalog has
 * under that exact primary name. The label stays; the picture never replaces it. Process/event/rule/quantity concepts keep
 * their type-gate rule (no noun picture for the concept itself). One house family per scene (chooseSceneFamily), no asset
 * drawn for two referents, reviewed rejections honoured. Topic-free: nothing here knows any subject.
 */
export interface BadgeRequest { elementId: string; label: string; concept?: ConceptInfo }
export interface ReferentBadge {
  elementId: string; referent: string; assetId: string; houseFamily?: string;
  license: string; releaseClean: boolean; attributionRequired: boolean; ownerApproved: boolean;
  review: 'accepted' | 'unreviewed';
}
export interface PlacedBadge extends ReferentBadge { draw(side: number): PrimitiveVisual }
export interface BadgeRefusal { elementId: string; label: string; reason: string }
export interface SceneBadgePlan { family?: string; badges: ReferentBadge[]; refusals: BadgeRefusal[] }
export interface BadgeOptions {
  lessonDomain?: string;
  catalog?: readonly CatalogEntry[];
  review?: BadgeReview;
  /** Families of pictures already drawn in the scene (entity pictures); they vote for the scene family. */
  extraFamilies?: readonly (string | undefined)[];
  /** asset id -> referent already drawn in the scene (entity pictures). */
  reservedAssets?: ReadonlyMap<string, string>;
}

const MAX_REFERENT_WORDS = 3;

export function badgeEligibility(request: BadgeRequest): string | undefined {
  const referent = referentOf(request.label);
  if (!referent) return 'label has no nameable referent';
  if (/\d/.test(referent)) return 'label carries a number, not a thing';
  if (referent.split(' ').length > MAX_REFERENT_WORDS) return 'label is a phrase, not one depictable thing';
  const concept = request.concept;
  if (concept && concept.kind !== 'entity' && referentOf(concept.label) === referent) return `label names the ${concept.kind} concept itself; a ${concept.kind} is shown by structure, not a noun picture`;
  return undefined;
}

type Probe = { entry: CatalogEntry; houseFamily?: string } | { reason: string };

function probe(referent: string, catalog: CatalogEntry[], lessonDomain: string | undefined, sceneFamily: string | undefined): Probe {
  const { resolution } = resolveObject(referent, { label: referent, size: { w: 240, h: 240 }, visualStrategy: 'literal', ...(lessonDomain ? { lessonDomain } : {}), ...(sceneFamily ? { sceneFamily } : {}) }, catalog);
  if (resolution.rung === 4 || !resolution.assetId) return { reason: 'no exact catalog picture' };
  if (resolution.selectionBasis !== 'exact' && resolution.selectionBasis !== 'curated') return { reason: `picture chosen by ${resolution.selectionBasis ?? 'unknown'}; only exact names may badge` };
  const entry = catalog.find((candidate) => candidate.id === resolution.assetId);
  if (!entry) return { reason: `resolved asset ${resolution.assetId} is not in the catalog` };
  if (referentOf(entry.names[0] ?? '') !== referent) return { reason: `matched a synonym of "${entry.names[0] ?? ''}"; badges require the asset's primary name` };
  return { entry, ...(resolution.houseFamily ? { houseFamily: resolution.houseFamily } : {}) };
}

export function planSceneBadges(requests: readonly BadgeRequest[], options: BadgeOptions = {}): SceneBadgePlan {
  const catalog = [...(options.catalog ?? allCatalogEntries())];
  const review = options.review ?? loadBadgeReview();
  const refusals: BadgeRefusal[] = [];
  const candidates: Array<{ request: BadgeRequest; referent: string }> = [];
  for (const request of requests) {
    const reason = badgeEligibility(request);
    if (reason) refusals.push({ elementId: request.elementId, label: request.label, reason });
    else candidates.push({ request, referent: referentOf(request.label) });
  }
  const unlocked = new Map<string, Probe>();
  for (const { referent } of candidates) if (!unlocked.has(referent)) unlocked.set(referent, probe(referent, catalog, options.lessonDomain, undefined));
  // Pictures already drawn in the scene fix its family; badges never outvote them (one family per scene).
  const pictureFamily = (options.extraFamilies ?? []).some((candidate) => !isExemptFamily(candidate)) ? chooseSceneFamily(options.extraFamilies ?? []) : undefined;
  const family = pictureFamily ?? chooseSceneFamily(candidates.map(({ referent }) => { const hit = unlocked.get(referent)!; return 'entry' in hit ? hit.houseFamily : undefined; }));
  const locked = new Map<string, Probe>();
  const owners = new Map<string, string>(options.reservedAssets ?? []);
  const badges: ReferentBadge[] = [];
  for (const { request, referent } of candidates) {
    if (!locked.has(referent)) locked.set(referent, probe(referent, catalog, options.lessonDomain, family));
    const hit = locked.get(referent)!;
    const refuse = (reason: string): void => { refusals.push({ elementId: request.elementId, label: request.label, reason }); };
    if (!('entry' in hit)) { refuse(hit.reason); continue; }
    const key = reviewKey(hit.entry.id, referent);
    if (review.rejected.has(key)) { refuse(`reviewed as a wrong picture for "${referent}"`); continue; }
    const owner = owners.get(hit.entry.id);
    if (owner !== undefined && owner !== referent) { refuse(`asset ${hit.entry.id} already depicts "${owner}" in this scene`); continue; }
    owners.set(hit.entry.id, referent);
    badges.push({
      elementId: request.elementId, referent, assetId: hit.entry.id, ...(hit.houseFamily ? { houseFamily: hit.houseFamily } : {}),
      license: hit.entry.license, ...licensePolicy(hit.entry.license), review: review.accepted.has(key) ? 'accepted' : 'unreviewed',
    });
  }
  return { ...(family ? { family } : {}), badges, refusals };
}

export function placeBadges(plan: SceneBadgePlan, catalog: readonly CatalogEntry[] = allCatalogEntries()): Map<string, PlacedBadge> {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const placed = new Map<string, PlacedBadge>();
  for (const badge of plan.badges) {
    const entry = byId.get(badge.assetId);
    if (entry) placed.set(badge.elementId, { ...badge, draw: (side: number) => entry.render({ w: side, h: side }) });
  }
  return placed;
}
