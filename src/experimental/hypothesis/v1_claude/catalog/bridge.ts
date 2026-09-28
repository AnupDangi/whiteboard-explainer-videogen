import { readFileSync } from 'node:fs';
import path, { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AssetBridge v2 reader (Teaching Compiler V1 §3). The pipeline consumes ONLY
 * this manifest — never provider IDs or Asset-Library internals. The manifest
 * is vendored at `catalog/data/asset-bridge-v2.json`; `catalogVersion` is
 * recorded in every resolution for provenance and cache identity.
 *
 * Deterministic: synchronous load, no network, no Date.now/Math.random.
 */

export interface BridgeConcept {
  conceptId: string;
  aliases: string[];
  domain: string;
  conceptType: string;
  preferredStrategies: string[];
  semanticRoles: string[];
  approvedAssetRefs: string[];
  diagramRefs: string[];
  inferred: boolean;
}

export interface BridgeAsset {
  ref: string;
  conceptId: string;
  family: string;
  capability: 'hero' | 'support' | 'symbolic' | 'brand';
  animationMode: 'ink-fill' | 'stroke' | 'mask' | 'fade';
  localPath: string;
  contentHash: string;
  license: { spdx: string; status: string; trademark?: string };
  provenance: { provider: string; providerId: string; collection?: string; sourceUrl?: string };
}

export interface BridgeDiagram {
  ref: string;
  conceptId: string;
  topology: string;
  primitives: string[];
  supportRefs: string[];
  status: string;
}

export interface AssetBridgeV2 {
  schemaVersion: 'asset-bridge/v2';
  catalogVersion: string;
  generatedAt: string;
  counts: { concepts: number; assets: number; diagrams: number };
  concepts: BridgeConcept[];
  assets: BridgeAsset[];
  diagrams: BridgeDiagram[];
}

const RAW_HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST_SRC = `${sep}dist${sep}src${sep}`;
let cacheDir = RAW_HERE.includes(DIST_SRC) ? RAW_HERE.replace(DIST_SRC, `${sep}src${sep}`) : RAW_HERE;
let cache: AssetBridgeV2 | undefined;

/** Override the catalog data dir (tests). Clears the load cache. */
export function setBridgeDataDir(dir: string): void {
  cacheDir = dir;
  cache = undefined;
}

/** Load (and cache) the vendored bridge manifest. Throws on schema mismatch. */
export function loadBridge(): AssetBridgeV2 {
  if (!cache) {
    const raw = JSON.parse(readFileSync(path.join(cacheDir, 'data', 'asset-bridge-v2.json'), 'utf8')) as AssetBridgeV2;
    if (raw.schemaVersion !== 'asset-bridge/v2') throw new Error(`Unsupported bridge schema ${String(raw.schemaVersion)}`);
    cache = raw;
  }
  return cache;
}

/** Find a concept by id or case-insensitive alias. */
export function bridgeConceptFor(conceptIdOrAlias: string): BridgeConcept | undefined {
  const bridge = loadBridge();
  const want = conceptIdOrAlias.trim().toLowerCase();
  return bridge.concepts.find(
    (c) => c.conceptId.toLowerCase() === want || c.aliases.some((a) => a.toLowerCase() === want),
  );
}

/** Approved asset entries backing a concept id (exact id match). */
export function bridgeAssetsForConcept(conceptId: string): BridgeAsset[] {
  const bridge = loadBridge();
  const refs = new Set(bridge.concepts.find((c) => c.conceptId === conceptId)?.approvedAssetRefs ?? []);
  return bridge.assets.filter((a) => refs.has(a.ref));
}

/** Diagram specs for a concept id (exact id match). */
export function bridgeDiagramsForConcept(conceptId: string): BridgeDiagram[] {
  const bridge = loadBridge();
  return bridge.diagrams.filter((d) => d.conceptId === conceptId);
}

/** True when ref names an asset in this bridge version (pin-validity check). */
export function bridgeHasAsset(ref: string): boolean {
  return loadBridge().assets.some((a) => a.ref === ref);
}

/** Concept type for an asset ref, via the asset's own concept. */
export function bridgeConceptTypeForAsset(ref: string): string | undefined {
  const bridge = loadBridge();
  const asset = bridge.assets.find((a) => a.ref === ref);
  return asset ? bridge.concepts.find((c) => c.conceptId === asset.conceptId)?.conceptType : undefined;
}
