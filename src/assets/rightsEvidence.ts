import type { CatalogEntry } from './catalog.js';
import type { BridgeAsset } from './bridge.js';
import { createHash } from 'node:crypto';
import { stableJson } from '../shared/artifacts.js';

export interface RightsDepiction {
  assetId: string;
  license?: string;
  releaseClean?: boolean;
  attributionRequired?: boolean;
  ownerApproved?: boolean;
}

export interface AssetRightsEvidence {
  assetId: string;
  author: string | null;
  source: { catalog: string | null; provider: string | null; providerId: string | null; collection: string | null; url: string | null };
  license: { identifier: string; status: string | null };
  attribution: { required: boolean; text: string | null };
  approval: { approved: boolean; authority: string; date: string; decision: string } | null;
  hashes: { catalogueAsset: string | null; sourceAsset: string | null };
  releaseEligible: boolean;
  missingRequiredEvidence: string[];
}

export interface AssetRightsFailure {
  code: 'v2-asset-rights-evidence' | 'v2-asset-license';
  stage: 'assets';
  message: string;
  hard: boolean;
}

/** The user-authorized Flaticon decision recorded in the V2 policy on 2026-10-03. */
const FLATICON_APPROVAL = {
  authority: 'project owner',
  date: '2026-10-03',
  decision: 'i give you all the permission use flaticons this is sudo permission for flaticon',
} as const;

function providerSlug(value: string): string {
  return value.toLowerCase().replace(/[/. ]/g, '-').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

/** Match an ingested Flaticon catalogue ID to its source bridge record where possible. */
export function bridgeRecordForCatalogEntry(entry: CatalogEntry, assets: readonly BridgeAsset[]): BridgeAsset | undefined {
  const marker = '-flaticon-local-';
  const suffix = entry.id.includes(marker) ? entry.id.split(marker).at(-1) : undefined;
  if (!suffix) return undefined;
  const wanted = providerSlug(suffix);
  return assets.find((asset) => {
    if (asset.family !== 'flaticon-local') return false;
    const provider = providerSlug(asset.provenance.providerId);
    const collectionAndProvider = asset.provenance.collection
      ? providerSlug(`${asset.provenance.collection}/${asset.provenance.providerId}`)
      : provider;
    return wanted === provider || wanted === collectionAndProvider;
  });
}

/** Build export evidence without treating missing metadata as a clean rights result. */
export function buildAssetRightsEvidence(
  depiction: RightsDepiction,
  entry?: CatalogEntry,
  sourceAsset?: BridgeAsset,
): AssetRightsEvidence {
  const license = depiction.license?.trim() ?? '';
  const attributionText = sourceAsset?.attribution?.trim() || entry?.attribution?.trim() || null;
  const attributionRequired = depiction.attributionRequired === true || sourceAsset?.license.attributionRequired === true;
  const ownerApproved = depiction.ownerApproved === true;
  const approval = ownerApproved
    ? { approved: true, ...FLATICON_APPROVAL }
    : null;
  const missingRequiredEvidence: string[] = [];
  if (!license) missingRequiredEvidence.push('license identifier');
  if (attributionRequired && !attributionText) missingRequiredEvidence.push('required attribution text');
  if ((ownerApproved || license === 'Flaticon-review') && !approval) missingRequiredEvidence.push('owner approval record');
  if (!entry?.source?.trim() && !sourceAsset?.provenance.provider?.trim()) missingRequiredEvidence.push('asset source');
  const externallySourced = Boolean(sourceAsset || (entry?.source && entry.source !== 'generated'));
  if (externallySourced && !entry?.contentHash && !sourceAsset?.contentHash) missingRequiredEvidence.push('asset hash');
  const releaseEligible = depiction.releaseClean === true && missingRequiredEvidence.length === 0;

  return {
    assetId: depiction.assetId,
    author: entry?.author?.trim() || null,
    source: {
      catalog: entry?.source ?? null,
      provider: sourceAsset?.provenance.provider ?? null,
      providerId: sourceAsset?.provenance.providerId ?? entry?.providerId ?? null,
      collection: sourceAsset?.provenance.collection ?? null,
      url: sourceAsset?.provenance.sourceUrl ?? entry?.sourceUrl ?? null,
    },
    license: { identifier: license || 'unknown', status: sourceAsset?.license.status ?? null },
    attribution: { required: attributionRequired, text: attributionText },
    approval,
    hashes: {
      catalogueAsset: entry?.contentHash ?? (entry?.source === 'generated'
        ? createHash('sha256').update(stableJson(entry.render({ w: 128, h: 128 })), 'utf8').digest('hex')
        : null),
      sourceAsset: sourceAsset?.contentHash ?? null,
    },
    releaseEligible,
    missingRequiredEvidence,
  };
}

export function rightsEvidenceFailure(evidence: AssetRightsEvidence): AssetRightsFailure | undefined {
  if (evidence.releaseEligible) return undefined;
  const missing = evidence.missingRequiredEvidence;
  const detail = missing.length ? `; missing ${missing.join(', ')}` : '';
  return {
    code: missing.length ? 'v2-asset-rights-evidence' : 'v2-asset-license',
    stage: 'assets',
    message: `asset ${evidence.assetId} has licence ${evidence.license.identifier}${detail}; draft only`,
    hard: missing.length > 0,
  };
}
