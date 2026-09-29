import { createHash } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'harness/baselines/manifest.v1.json');
const frozenManifestSha256 = '80ccf98db088f5bd46b3d7005a6224392cf9dce7c54be6e0c143b5748a3b315b';
const evidenceManifestV2Sha256 = '53a574ee4d9d7eb7a14f1cab1890b07ee8f3eba717f651af83df3f40654d3851';
const fixtureFiles = [
  'src/experimental/hypothesis/shared/fixtures.ts',
  'src/experimental/hypothesis/v1_claude/fixtures/attentionScenes.ts',
  'src/experimental/hypothesis/v1_claude/fixtures/liveNarrationScripts.ts',
  'src/experimental/hypothesis/v1_claude/fixtures/mathLessons.ts',
  'src/experimental/hypothesis/v1_claude/fixtures/mathScenes.ts',
];

async function hashFile(relativePath) {
  const bytes = await readFile(join(root, relativePath));
  return createHash('sha256').update(bytes).digest('hex');
}

async function buildManifest() {
  const entries = [];
  for (const path of fixtureFiles) entries.push({ path, sha256: await hashFile(path), role: 'hand-authored-fixture-input' });
  const refs = 'harness/reference/lamina';
  const refNames = (await (await import('node:fs/promises')).readdir(join(root, refs)))
    .filter((name) => name.endsWith('.png') || name === 'index.json' || name === 'OBSERVATIONS.md')
    .sort();
  for (const name of refNames) {
    const path = `${refs}/${name}`;
    entries.push({ path, sha256: await hashFile(path), role: 'reference-only' });
  }
  return {
    schemaVersion: 'baseline-inventory/v1',
    baselineVersion: 1,
    frozenAt: new Date().toISOString(),
    immutable: true,
    entries,
    missingSets: [
      { id: 'G-10', status: 'partial', reason: 'This checkout has four shared live goldens and five math lessons, not the planned ten-lesson frozen corpus.' },
      { id: 'G-DOC', status: 'missing', reason: 'The five planned real-document inputs are not present in this checkout.' },
      { id: 'G-LONG', status: 'missing', reason: 'The four planned long-form input fixtures are not present in this checkout.' },
    ],
  };
}

async function main() {
  const freeze = process.argv.includes('--freeze');
  if (freeze) {
    try {
      await access(manifestPath);
      throw new Error(`${manifestPath} already exists; frozen manifests are never overwritten. Add a reviewed manifest.vN instead.`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const manifest = await buildManifest();
    await (await import('node:fs/promises')).mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    console.log(`froze ${manifest.entries.length} baseline files at ${manifestPath}`);
    return;
  }

  const manifestBytes = await readFile(manifestPath);
  const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
  if (manifestHash !== frozenManifestSha256) throw new Error('Frozen baseline manifest was edited; preserve v1 and add a reviewed version instead.');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.immutable !== true || !Array.isArray(manifest.entries)) throw new Error('Invalid frozen baseline manifest');
  const changed = [];
  for (const entry of manifest.entries) {
    try {
      if (await hashFile(entry.path) !== entry.sha256) changed.push(entry.path);
    } catch {
      changed.push(`${entry.path} (missing)`);
    }
  }
  if (changed.length) throw new Error(`Frozen baseline changed:\n${changed.join('\n')}`);
  const v2Bytes = await readFile(join(root, 'harness/baselines/manifest.v2.json'));
  if (createHash('sha256').update(v2Bytes).digest('hex') !== evidenceManifestV2Sha256) throw new Error('Frozen v2 evidence inventory was edited; add a reviewed v3 instead.');
  const v2 = JSON.parse(v2Bytes.toString('utf8'));
  if (v2.parentManifestSha256 !== frozenManifestSha256) throw new Error('V2 evidence inventory does not reference the frozen v1 manifest');
  for (const entry of v2.entries) {
    try { if (await hashFile(entry.path) !== entry.sha256) changed.push(entry.path); }
    catch { changed.push(`${entry.path} (missing)`); }
  }
  if (changed.length) throw new Error(`Frozen evidence changed:\n${changed.join('\n')}`);
  console.log(`verified ${manifest.entries.length} v1 and ${v2.entries.length} v2 evidence files; missing test sets: ${manifest.missingSets.map((x) => x.id).join(', ')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
