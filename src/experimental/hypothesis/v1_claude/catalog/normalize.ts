import type { NormalizationLane } from '../types.js';
import type { CatalogEntry } from './catalog.js';

/**
 * CC-BY-4.0 (Streamline free sets) is allowed only because attribution is
 * written next to every rendered video (attribution.txt + run-manifest.json).
 */
export const LICENSE_ALLOWLIST = ['MIT', 'ISC', 'Apache-2.0', 'CC0-1.0', 'CC-BY-4.0', 'manual'];

export interface NormalizationResult {
  ok: boolean;
  lane: NormalizationLane;
  reasons: string[];
}

/**
 * Normalization gate (claude_pipeline.md §12 / hypothesis/v1_claude/01
 * §4.2): two separate lanes so rich illustrations are not damaged by the
 * aggressive flattening that is safe for simple stroke symbols.
 *
 *  - `simple-symbol` lane: <= 10 stroke paths, no accent fill required.
 *  - `rich-illustration` lane: up to 40 paths, may carry one accent fill.
 *
 * Real ingested SVGs (svgo/svgson cleanup) are out of scope this session —
 * see catalog/catalog.ts header — so this validates the procedurally
 * generated seed catalog against the same numeric limits the spec sets for
 * externally sourced assets, so swapping in real assets later doesn't
 * silently bypass the gate.
 */
export function normalizeCatalogEntry(entry: CatalogEntry): NormalizationResult {
  const reasons: string[] = [];
  if (!LICENSE_ALLOWLIST.includes(entry.license)) reasons.push(`license ${entry.license} not allowlisted`);
  if (entry.strokePaths > 40) reasons.push(`too many paths (${entry.strokePaths} > 40)`);
  // The declared lane is an authorial choice (which normalization treatment
  // an asset is meant to receive), not something this gate silently
  // reassigns — it only validates the declared lane's own path budget.
  if (entry.lane === 'simple-symbol' && entry.strokePaths > 10) reasons.push(`simple-symbol lane exceeds its path budget (${entry.strokePaths} > 10)`);
  return { ok: reasons.length === 0, lane: entry.lane, reasons };
}

/** Runs the normalization gate over the whole catalog; throws (build-time failure) if anything is unlicensed or malformed. */
export function assertCatalogNormalized(catalog: CatalogEntry[]): void {
  const failures = catalog.map((entry) => ({ entry, result: normalizeCatalogEntry(entry) })).filter((x) => !x.result.ok);
  if (failures.length > 0) {
    throw new Error(`Catalog normalization failed for: ${failures.map((f) => `${f.entry.id} (${f.result.reasons.join(', ')})`).join('; ')}`);
  }
}
