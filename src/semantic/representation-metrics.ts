/** Representation-resolution telemetry (P5). Observation only: counts how each
 *  resolved concept landed on the representation ladder, so investment can be
 *  aimed at the tier that actually dominates a run. No decision depends on it. */
export const REPRESENTATION_TIERS = ['trusted-asset','substring-asset','composition','external','primitive-label','not-applicable'] as const;
export type RepresentationTier = typeof REPRESENTATION_TIERS[number];
export interface RepresentationTierCounts { [tier: string]: number }
/** Structural subset of an `assetCandidates` entry; extra fields are ignored. */
export interface RepresentationCandidateEntry {
  candidates: { id: string }[];
  representation?: { family: string };
  fallback: string | null;
}
export function classifyCandidate(entry: RepresentationCandidateEntry): RepresentationTier {
  if (entry.fallback === 'not-applicable') return 'not-applicable';
  if (entry.candidates.some(candidate => candidate.id.startsWith('external.'))) return 'external';
  if (entry.fallback === null && entry.candidates.length > 0) return 'trusted-asset';
  if (entry.fallback === 'asset') return 'substring-asset';
  if (entry.representation) return 'composition';
  return 'primitive-label';
}
export function representationTierCounts(entries: readonly RepresentationCandidateEntry[]): RepresentationTierCounts {
  const counts: RepresentationTierCounts = { total: 0 };
  for (const tier of REPRESENTATION_TIERS) counts[tier] = 0;
  for (const entry of entries) { counts[classifyCandidate(entry)]++; counts.total++; }
  return counts;
}
