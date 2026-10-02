/**
 * One primary icon family per scene (final_plan/02 §19). Families are the normalised
 * `houseFamily` values from AssetBridge. Procedural/semantic-core drawings and technical
 * brand marks are exempt; every other asset in a scene must share one family.
 */
export const FAMILY_ORDER = [
  'simi-house-v1/general-drawon',
  'simi-house-v1/domain-outline',
  'simi-house-v1/technical-brand',
] as const;

export const isExemptFamily = (family: string | undefined): boolean => !family || family.endsWith('/technical-brand') || family.endsWith('/procedural');

/** Family covering the most icon elements; ties go to the earlier FAMILY_ORDER entry, then alphabetical. */
export function chooseSceneFamily(families: ReadonlyArray<string | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const family of families) if (!isExemptFamily(family)) counts.set(family!, (counts.get(family!) ?? 0) + 1);
  const rank = (family: string): number => { const index = (FAMILY_ORDER as readonly string[]).indexOf(family); return index < 0 ? FAMILY_ORDER.length : index; };
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))[0]?.[0];
}
