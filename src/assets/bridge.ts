import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdir as mkdirAsync, readFile as readFileAsync, realpath as realpathAsync, readdir as readdirAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import path, { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableJson } from '../shared/artifacts.js';

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
  /** Normalized runtime visual family; distinct from the source library family. */
  houseFamily?: string;
  /** Scene families in which this asset is approved for use. */
  sceneFamilies?: string[];
  capability: 'hero' | 'support' | 'symbolic' | 'brand';
  animationMode: 'ink-fill' | 'stroke' | 'mask' | 'fade';
  localPath: string;
  contentHash: string;
  license: {
    spdx: string;
    status: string;
    trademark?: string;
    attributionRequired?: boolean;
    allowedUsageContexts?: string[];
  };
  attribution?: string;
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

export interface BridgeValidationOptions {
  /** Root against which each manifest localPath is resolved. */
  assetRoot?: string;
  /** Verify the bytes for every referenced asset, not only their metadata. */
  verifyAssetBytes?: boolean;
  /** Temporary migration mode for the existing bridge's duplicate concept IDs. */
  allowDuplicateConceptIds?: boolean;
  /** Enforce the export contract. Migration reads intentionally use a looser mode. */
  strictSnapshot?: boolean;
}

export interface VerifiedAssetBridgeSnapshot {
  bridge: AssetBridgeV2;
  assetRoot: string;
  digest: string;
  /** Returns a defensive byte copy for a verified ref; review-only assets remain present but are not approved for use. */
  bytesFor(ref: string): Uint8Array | undefined;
}

/** Content-address the full bridge graph, including every pinned asset byte hash. */
export function bridgeCatalogVersion(bridge: Pick<AssetBridgeV2, 'schemaVersion' | 'counts' | 'concepts' | 'assets' | 'diagrams'>): string {
  const payload = {
    schemaVersion: bridge.schemaVersion,
    counts: bridge.counts,
    concepts: [...bridge.concepts].sort((a, b) => a.conceptId.localeCompare(b.conceptId)),
    assets: [...bridge.assets].sort((a, b) => a.ref.localeCompare(b.ref)),
    diagrams: [...bridge.diagrams].sort((a, b) => a.ref.localeCompare(b.ref)),
  };
  return `sha256:${createHash('sha256').update(stableJson(payload), 'utf8').digest('hex')}`;
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
    // The checked-in migration snapshot still contains a duplicate `apple`
    // concept (physical object and brand). Keep it readable, but ambiguous
    // lookups below deliberately return no result until the snapshot is fixed.
    const problems = validateBridge(raw, { allowDuplicateConceptIds: true });
    if (problems.length) throw new Error(`Invalid AssetBridge v2: ${problems.join('; ')}`);
    cache = raw;
  }
  return cache;
}

/** Validate the versioned bridge graph before the resolver consumes it. */
export function validateBridge(value: unknown, options: BridgeValidationOptions = {}): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['manifest must be an object'];
  const bridge = value as Partial<AssetBridgeV2>;
  if (bridge.schemaVersion !== 'asset-bridge/v2') return [`unsupported schema ${String(bridge.schemaVersion)}`];
  if (typeof bridge.catalogVersion !== 'string' || !bridge.catalogVersion.trim()) return ['catalogVersion is missing'];
  if (!Array.isArray(bridge.concepts) || !Array.isArray(bridge.assets) || !Array.isArray(bridge.diagrams)) return ['concepts, assets and diagrams must be arrays'];
  const problems: string[] = [];
  const strict = options.strictSnapshot === true;
  if (strict && (typeof bridge.generatedAt !== 'string' || !Number.isFinite(Date.parse(bridge.generatedAt)) || new Date(bridge.generatedAt).toISOString() !== bridge.generatedAt)) {
    problems.push('generatedAt must be a canonical ISO timestamp');
  }
  if (!bridge.counts || bridge.counts.concepts !== bridge.concepts.length || bridge.counts.assets !== bridge.assets.length || bridge.counts.diagrams !== bridge.diagrams.length) {
    problems.push('declared counts do not match manifest entries');
  }
  if (strict && bridge.counts && Array.isArray(bridge.concepts) && Array.isArray(bridge.assets) && Array.isArray(bridge.diagrams)) {
    try {
      const expectedVersion = bridgeCatalogVersion(bridge as AssetBridgeV2);
      if (bridge.catalogVersion !== expectedVersion) problems.push(`catalogVersion must content-address bridge metadata and asset hashes (${expectedVersion})`);
    } catch { problems.push('catalogVersion cannot be verified against bridge metadata'); }
  }

  const concepts = new Map<string, BridgeConcept>();
  for (const [index, concept] of bridge.concepts.entries()) {
    if (!concept || typeof concept.conceptId !== 'string' || !concept.conceptId.trim()) { problems.push(`concept[${index}] has no conceptId`); continue; }
    if (typeof concept.conceptType !== 'string' || !concept.conceptType.trim()) problems.push(`concept ${concept.conceptId} lacks a conceptType`);
    else if (strict && !BRIDGE_CONCEPT_TYPES.has(concept.conceptType)) problems.push(`concept ${concept.conceptId} has unknown conceptType ${concept.conceptType}`);
    if (typeof concept.inferred !== 'boolean') problems.push(`concept ${concept.conceptId} lacks an inferred-type marker`);
    if (typeof concept.domain !== 'string' || !concept.domain.trim()) problems.push(`concept ${concept.conceptId} lacks a domain`);
    for (const [field, entries] of [['aliases', concept.aliases], ['approvedAssetRefs', concept.approvedAssetRefs], ['diagramRefs', concept.diagramRefs], ['preferredStrategies', concept.preferredStrategies], ['semanticRoles', concept.semanticRoles]] as const) {
      if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string' || !entry.trim())) problems.push(`concept ${concept.conceptId} has invalid ${field}`);
      else if (new Set(entries).size !== entries.length) problems.push(`concept ${concept.conceptId} has duplicate ${field}`);
    }
    if (concepts.has(concept.conceptId) && !options.allowDuplicateConceptIds) problems.push(`duplicate conceptId ${concept.conceptId}`);
    concepts.set(concept.conceptId, concept);
  }
  const assets = new Map<string, BridgeAsset>();
  for (const [index, asset] of bridge.assets.entries()) {
    if (!asset || typeof asset.ref !== 'string' || !asset.ref.trim()) { problems.push(`asset[${index}] has no ref`); continue; }
    if (assets.has(asset.ref)) problems.push(`duplicate asset ref ${asset.ref}`);
    assets.set(asset.ref, asset);
    if (!concepts.has(asset.conceptId)) problems.push(`asset ${asset.ref} names unknown concept ${asset.conceptId}`);
    if (typeof asset.localPath !== 'string' || !isSafeRelativePath(asset.localPath)) problems.push(`asset ${asset.ref} has unsafe localPath`);
    if (typeof asset.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(asset.contentHash)) problems.push(`asset ${asset.ref} has invalid contentHash`);
    if (strict) {
      if (typeof asset.family !== 'string' || !asset.family.trim()) problems.push(`asset ${asset.ref} lacks a source family`);
      if (typeof asset.houseFamily !== 'string' || !asset.houseFamily.trim()) problems.push(`asset ${asset.ref} lacks a normalized houseFamily`);
      if (!Array.isArray(asset.sceneFamilies) || !asset.sceneFamilies.length || asset.sceneFamilies.some((family) => typeof family !== 'string' || !family.trim()) || new Set(asset.sceneFamilies).size !== asset.sceneFamilies.length) {
        problems.push(`asset ${asset.ref} has invalid or missing sceneFamilies`);
      }
      if (typeof asset.attribution !== 'string' || !asset.attribution.trim()) problems.push(`asset ${asset.ref} lacks attribution metadata`);
    }
    const license = asset.license;
    if (!license || typeof license !== 'object' || typeof license.spdx !== 'string' || !license.spdx.trim() || !['allowed', 'review'].includes(license.status)) problems.push(`asset ${asset.ref} has unresolved license/approval status`);
    else {
      if (license.trademark !== undefined && typeof license.trademark !== 'string') problems.push(`asset ${asset.ref} has invalid trademark metadata`);
      if (strict && license.status === 'allowed' && !/^(?:[A-Za-z0-9][A-Za-z0-9.+-]*|LicenseRef-[A-Za-z0-9.-]+)$/.test(license.spdx)) problems.push(`asset ${asset.ref} has a non-SPDX identifier marked allowed`);
      if (strict && typeof license.attributionRequired !== 'boolean') problems.push(`asset ${asset.ref} lacks attributionRequired license policy`);
      if (strict && (!Array.isArray(license.allowedUsageContexts)
        || (license.status === 'allowed' && !license.allowedUsageContexts.length)
        || license.allowedUsageContexts.some((context) => typeof context !== 'string' || !context.trim()))) {
        problems.push(`asset ${asset.ref} lacks allowedUsageContexts license policy`);
      }
    }
    const provenance = asset.provenance;
    if (!provenance || typeof provenance !== 'object' || typeof provenance.provider !== 'string' || !provenance.provider.trim() || typeof provenance.providerId !== 'string' || !provenance.providerId.trim()) problems.push(`asset ${asset.ref} lacks provenance`);
    else {
      if (provenance.collection !== undefined && typeof provenance.collection !== 'string') problems.push(`asset ${asset.ref} has invalid provenance collection`);
      if (provenance.sourceUrl !== undefined && (typeof provenance.sourceUrl !== 'string' || !isHttpUrl(provenance.sourceUrl))) problems.push(`asset ${asset.ref} has invalid provenance sourceUrl`);
      if (strict && !(typeof provenance.collection === 'string' && provenance.collection.trim()) && !(typeof provenance.sourceUrl === 'string' && isHttpUrl(provenance.sourceUrl))) {
        problems.push(`asset ${asset.ref} provenance needs a collection or sourceUrl`);
      }
    }
    if (!['hero', 'support', 'symbolic', 'brand'].includes(asset.capability)) problems.push(`asset ${asset.ref} has invalid capability`);
    if (!['ink-fill', 'stroke', 'mask', 'fade'].includes(asset.animationMode)) problems.push(`asset ${asset.ref} has invalid animation mode`);
    const ownerApprovals = concepts.get(asset.conceptId)?.approvedAssetRefs;
    if (strict && asset.license?.status === 'allowed' && (!Array.isArray(ownerApprovals) || !ownerApprovals.includes(asset.ref))) problems.push(`asset ${asset.ref} is not reciprocally approved by concept ${asset.conceptId}`);
  }
  for (const concept of bridge.concepts) {
    for (const ref of Array.isArray(concept?.approvedAssetRefs) ? concept.approvedAssetRefs : []) {
      const asset = assets.get(ref);
      if (!asset) problems.push(`concept ${concept.conceptId} has dangling asset ref ${ref}`);
      else if (asset.conceptId !== concept.conceptId) problems.push(`concept ${concept.conceptId} approves asset ${ref} owned by ${asset.conceptId}`);
    }
  }
  const diagramRefs = new Map<string, BridgeDiagram>();
  for (const [index, diagram] of bridge.diagrams.entries()) {
    if (!diagram || typeof diagram.ref !== 'string' || !diagram.ref.trim()) { problems.push(`diagram[${index}] has no ref`); continue; }
    if (diagramRefs.has(diagram.ref)) problems.push(`duplicate diagram ref ${diagram.ref}`);
    diagramRefs.set(diagram.ref, diagram);
    if (!concepts.has(diagram.conceptId)) problems.push(`diagram ${diagram.ref} names unknown concept ${diagram.conceptId}`);
    if (typeof diagram.topology !== 'string' || !diagram.topology.trim() || typeof diagram.status !== 'string' || !diagram.status.trim()) problems.push(`diagram ${diagram.ref} has invalid topology/status`);
    if (!Array.isArray(diagram.primitives) || diagram.primitives.some((item) => typeof item !== 'string' || !item.trim())) problems.push(`diagram ${diagram.ref} has invalid primitives`);
    if (!Array.isArray(diagram.supportRefs) || diagram.supportRefs.some((item) => typeof item !== 'string' || !item.trim())) problems.push(`diagram ${diagram.ref} has invalid supportRefs`);
    else for (const ref of diagram.supportRefs) if (!assets.has(ref)) problems.push(`diagram ${diagram.ref} has dangling support ref ${ref}`);
  }
  for (const concept of bridge.concepts) for (const ref of Array.isArray(concept?.diagramRefs) ? concept.diagramRefs : []) {
    const diagram = diagramRefs.get(ref);
    if (!diagram) problems.push(`concept ${concept.conceptId} has dangling diagram ref ${ref}`);
    else if (diagram.conceptId !== concept.conceptId) problems.push(`concept ${concept.conceptId} references diagram ${ref} owned by ${diagram.conceptId}`);
  }
  if (options.verifyAssetBytes) {
    if (!options.assetRoot) problems.push('assetRoot is required when verifying asset bytes');
    else for (const asset of bridge.assets) {
      try {
        const root = realpathSync(options.assetRoot);
        const candidate = path.resolve(root, asset.localPath);
        if (!candidate.startsWith(`${root}${path.sep}`)) { problems.push(`asset ${asset.ref} escapes assetRoot`); continue; }
        const file = realpathSync(candidate);
        if (!file.startsWith(`${root}${path.sep}`)) { problems.push(`asset ${asset.ref} escapes assetRoot through a symlink`); continue; }
        const bytes = readFileSync(file);
        const actual = createHash('sha256').update(bytes).digest('hex');
        if (actual !== asset.contentHash.toLowerCase()) problems.push(`asset ${asset.ref} content hash mismatch`);
        if (typeof asset.localPath === 'string' && asset.localPath.toLowerCase().endsWith('.svg') && !isSafeSvg(bytes.toString('utf8'))) problems.push(`asset ${asset.ref} contains unsafe or invalid SVG content`);
      } catch {
        problems.push(`asset ${asset.ref} content is unavailable`);
      }
    }
  }
  return problems;
}

/** Taxonomy shared by S6 visual intents and strict AssetBridge exports. */
const BRIDGE_CONCEPT_TYPES = new Set([
  'entity', 'state', 'process', 'cause', 'condition', 'sequence', 'comparison',
  'hierarchy', 'quantity', 'evidence', 'argument', 'system', 'math',
]);

/**
 * Accept a self-contained bridge snapshot only after strict graph and local-byte
 * checks. Unlike the migration loader, this rejects duplicate concept IDs and
 * hashes the bytes actually read from the immutable snapshot root.
 */
export function verifyBridgeSnapshot(value: unknown, assetRoot: string): VerifiedAssetBridgeSnapshot {
  const root = realpathSync(assetRoot);
  const problems = validateBridge(value, { assetRoot: root, strictSnapshot: true });
  if (problems.length) throw new Error(`AssetBridge snapshot rejected: ${problems.join('; ')}`);
  const bridge = deepFreeze(JSON.parse(JSON.stringify(value)) as AssetBridgeV2);
  const bytesByRef = new Map<string, Uint8Array>();
  for (const asset of bridge.assets) {
    const candidate = path.resolve(root, asset.localPath);
    if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error(`AssetBridge snapshot rejected: asset ${asset.ref} escapes assetRoot`);
    const file = realpathSync(candidate);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`AssetBridge snapshot rejected: asset ${asset.ref} escapes assetRoot through a symlink`);
    // Read once, then validate and retain these exact bytes. A second read
    // after hash validation would allow a file replacement to cross the
    // verification boundary while the lock still records the old digest.
    const bytes = new Uint8Array(readFileSync(file));
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash.toLowerCase() !== asset.contentHash.toLowerCase()) {
      throw new Error(`AssetBridge snapshot rejected: asset ${asset.ref} content hash mismatch (expected ${asset.contentHash}, got ${actualHash})`);
    }
    if (!isSafeSvg(Buffer.from(bytes).toString('utf8'))) throw new Error(`AssetBridge snapshot rejected: asset ${asset.ref} contains unsafe or invalid SVG`);
    bytesByRef.set(asset.ref, bytes);
  }
  const eligibleRefs = new Set(bridge.assets.filter((asset) => asset.license.status === 'allowed'
    && bridge.concepts.some((concept) => concept.conceptId === asset.conceptId && concept.approvedAssetRefs.includes(asset.ref))).map((asset) => asset.ref));
  // Strict validation ties this catalog version to all metadata and declared
  // byte hashes; the hashes above were checked against the captured bytes.
  const digest = bridgeCatalogVersion(bridge).slice('sha256:'.length);
  return Object.freeze({
    bridge,
    assetRoot: root,
    digest,
    bytesFor(ref: string): Uint8Array | undefined {
      if (!eligibleRefs.has(ref)) return undefined;
      const bytes = bytesByRef.get(ref);
      if (!bytes) return undefined;
      return new Uint8Array(bytes);
    },
  });
}

/**
 * Freeze reviewed Asset Lab output into a self-contained, content-addressed
 * snapshot. Call only on an explicitly reviewed export; this function does
 * not infer licensing, provenance, concept mappings, or approval.
 */
export async function freezeBridgeSnapshot(
  reviewedBridge: AssetBridgeV2,
  sourceAssetRoot: string,
  destinationRoot: string,
  generatedAt: string,
): Promise<VerifiedAssetBridgeSnapshot> {
  const sourceLexicalRoot = path.resolve(sourceAssetRoot);
  const destinationLexicalRoot = path.resolve(destinationRoot);
  const sourceRoot = await realpathAsync(sourceAssetRoot);
  // Resolve through nearest existing ancestor: path.resolve alone keeps the
  // unresolved /tmp symlink on macOS, so a destination nested in the source
  // would compare /var/... against /private/var/... and miss the overlap.
  let destination: string | undefined;
  let existingAncestor = path.resolve(destinationRoot);
  while (destination === undefined) {
    try {
      const resolved = await realpathAsync(existingAncestor);
      const remainder = path.relative(existingAncestor, path.resolve(destinationRoot));
      destination = remainder ? path.join(resolved, remainder) : resolved;
    } catch { existingAncestor = path.dirname(existingAncestor); }
  }
  const isWithin = (root: string, candidate: string): boolean => {
    const relative = path.relative(root, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  // Check both lexical paths and canonical paths. On macOS, /var may resolve
  // to /private/var; checking the caller paths catches nested destinations
  // before that alias can obscure their relationship.
  if (
    isWithin(sourceLexicalRoot, destinationLexicalRoot)
    || isWithin(destinationLexicalRoot, sourceLexicalRoot)
    || isWithin(sourceRoot, destination)
    || isWithin(destination, sourceRoot)
  ) {
    throw new Error('AssetBridge export destination and source asset root must not overlap');
  }
  const frozen = structuredClone(reviewedBridge);
  frozen.generatedAt = generatedAt;
  await mkdirAsync(destination, { recursive: true });
  const manifestPath = path.join(destination, 'asset-bridge-v2.json');
  if ((await readdirAsync(destination)).length > 0) throw new Error(`AssetBridge destination is not empty: ${destination}`);
  await mkdirAsync(path.join(destination, 'assets'), { recursive: true });
  for (const asset of frozen.assets) {
    if (!isSafeRelativePath(asset.localPath)) throw new Error(`AssetBridge export rejected: asset ${asset.ref} has an unsafe path`);
    const candidate = path.resolve(sourceRoot, asset.localPath);
    if (!candidate.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`AssetBridge export rejected: asset ${asset.ref} escapes its source root`);
    const sourceFile = await realpathAsync(candidate);
    if (!sourceFile.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`AssetBridge export rejected: asset ${asset.ref} escapes its source root through a symlink`);
    const bytes = await readFileAsync(sourceFile);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== asset.contentHash.toLowerCase()) throw new Error(`AssetBridge export rejected: asset ${asset.ref} content hash mismatch`);
    if (!sourceFile.toLowerCase().endsWith('.svg') || !isSafeSvg(bytes.toString('utf8'))) throw new Error(`AssetBridge export rejected: asset ${asset.ref} is not a safe local SVG`);
    asset.contentHash = digest;
    asset.localPath = `assets/${digest}.svg`;
    const frozenPath = path.join(destination, asset.localPath);
    try {
      const existingBytes = await readFileAsync(frozenPath);
      if (!existingBytes.equals(bytes)) throw new Error(`AssetBridge export rejected: destination asset hash collision at ${asset.localPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await writeFileAsync(frozenPath, bytes, { flag: 'wx' });
    }
  }
  frozen.catalogVersion = bridgeCatalogVersion(frozen);
  const problems = validateBridge(frozen, { assetRoot: destination, verifyAssetBytes: true, strictSnapshot: true });
  if (problems.length) throw new Error(`AssetBridge export rejected: ${problems.join('; ')}`);
  await writeFileAsync(manifestPath, `${stableJson(frozen)}\n`, { encoding: 'utf8', flag: 'wx' });
  return verifyBridgeSnapshot(frozen, destination);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isSafeSvg(svg: string): boolean {
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(svg)
    || /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|animate|animateTransform|animateMotion|set|discard)\b|javascript:|@import\b|\bxml:base\s*=/i.test(svg)
    || /\son[a-z][\w:-]*\s*=/i.test(svg)) return false;

  // AssetBridge bytes are rendered offline. Permit only local SVG fragments
  // for href and CSS url references; relative paths and data URIs are also
  // external dependencies and would make rendering environment-dependent.
  const hrefPattern = /\b(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of svg.matchAll(hrefPattern)) {
    if (!/^#[A-Za-z_][\w:.-]*$/.test(match[2] ?? '')) return false;
  }
  if (/\b(?:href|xlink:href)\s*=|\bsrc\s*=/i.test(svg.replace(hrefPattern, ''))) return false;

  const urlPattern = /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi;
  for (const match of svg.matchAll(urlPattern)) {
    const reference = (match[2] ?? match[3] ?? '').trim();
    if (!/^#[A-Za-z_][\w:.-]*$/.test(reference)) return false;
  }
  if (/url\s*\(/i.test(svg.replace(urlPattern, ''))) return false;
  // CSS escapes can spell the `url` function without its literal token. Reject
  // escapes in CSS-bearing regions rather than trying to emulate a CSS parser.
  const styleBlock = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  for (const match of svg.matchAll(styleBlock)) if ((match[1] ?? '').includes('\\')) return false;
  const styleAttribute = /\bstyle\s*=\s*(["'])(.*?)\1/gi;
  for (const match of svg.matchAll(styleAttribute)) if ((match[2] ?? '').includes('\\')) return false;
  return true;
}

/** Stable digest over all bridge metadata and asset byte hashes (generatedAt is informational). */
export function bridgeSnapshotDigest(): string {
  const bridge = loadBridge();
  const snapshot = {
    schemaVersion: bridge.schemaVersion,
    catalogVersion: bridge.catalogVersion,
    counts: bridge.counts,
    concepts: [...bridge.concepts].sort((a, b) => a.conceptId.localeCompare(b.conceptId)),
    assets: [...bridge.assets].sort((a, b) => a.ref.localeCompare(b.ref)),
    diagrams: [...bridge.diagrams].sort((a, b) => a.ref.localeCompare(b.ref)),
  };
  return createHash('sha256').update(stableJson(snapshot), 'utf8').digest('hex');
}

function isSafeRelativePath(value: string): boolean {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value) || value.includes('\\')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Find a concept by id or case-insensitive alias. */
export function bridgeConceptFor(conceptIdOrAlias: string): BridgeConcept | undefined {
  const bridge = loadBridge();
  const want = conceptIdOrAlias.trim().toLowerCase();
  const matches = bridge.concepts.filter(
    (c) => c.conceptId.toLowerCase() === want || c.aliases.some((a) => a.toLowerCase() === want),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Approved asset entries backing a concept id (exact id match). */
export function bridgeAssetsForConcept(conceptId: string): BridgeAsset[] {
  const bridge = loadBridge();
  const refs = new Set(bridge.concepts.find((c) => c.conceptId === conceptId)?.approvedAssetRefs ?? []);
  return bridge.assets.filter((a) => refs.has(a.ref) && a.license.status === 'allowed');
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
  const matchingConcepts = asset ? bridge.concepts.filter((c) => c.conceptId === asset.conceptId) : [];
  return matchingConcepts.length === 1 ? matchingConcepts[0]?.conceptType : undefined;
}
