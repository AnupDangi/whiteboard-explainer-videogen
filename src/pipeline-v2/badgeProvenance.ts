import type { CatalogEntry } from '../assets/catalog.js';
import { bridgeRecordForCatalogEntry, buildAssetRightsEvidence, type AssetRightsEvidence } from '../assets/rightsEvidence.js';
import type { CompiledScene } from '../visual-v2/renderer/frame.js';

type BridgeAssets = Parameters<typeof bridgeRecordForCatalogEntry>[1];

/** One rights record per distinct badge asset drawn anywhere in the lesson (same builder as entity pictures). */
export function badgeRightsEvidence(scenes: readonly CompiledScene[], catalogue: ReadonlyMap<string, CatalogEntry>, bridgeAssets: BridgeAssets): AssetRightsEvidence[] {
  const seen = new Set<string>();
  const out: AssetRightsEvidence[] = [];
  for (const scene of scenes) for (const badge of scene.badges?.values() ?? []) {
    if (seen.has(badge.assetId)) continue;
    seen.add(badge.assetId);
    const entry = catalogue.get(badge.assetId);
    out.push(buildAssetRightsEvidence(
      { assetId: badge.assetId, license: badge.license, releaseClean: badge.releaseClean, attributionRequired: badge.attributionRequired, ownerApproved: badge.ownerApproved },
      entry, entry ? bridgeRecordForCatalogEntry(entry, bridgeAssets) : undefined,
    ));
  }
  return out;
}
