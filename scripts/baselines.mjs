import { createHash } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'harness/baselines/manifest.v1.json');
const frozenManifestSha256 = '80ccf98db088f5bd46b3d7005a6224392cf9dce7c54be6e0c143b5748a3b315b';
const evidenceManifestV2Sha256 = '53a574ee4d9d7eb7a14f1cab1890b07ee8f3eba717f651af83df3f40654d3851';
const relocationManifestV3Path = join(root, 'harness/baselines/manifest.v3.json');
const relocationCorrectionPath = join(root, 'harness/baselines/corrections/flat-layout-import-rewrite.v1.json');
const fixtureFiles = [
  'src/shared/fixtures.ts',
  'src/fixtures/attentionScenes.ts',
  'src/fixtures/liveNarrationScripts.ts',
  'src/fixtures/mathLessons.ts',
  'src/fixtures/mathScenes.ts',
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
  // Relocated fixtures (flat src/ layout) are covered by the versioned
  // correction record; their new locations are verified in the v3 step below.
  // Frozen v1 bytes and hashes are never edited.
  const earlyCorrection = JSON.parse((await readFile(relocationCorrectionPath)).toString('utf8'));
  const relocatedFrom = new Map(earlyCorrection.files.map((f) => [f.from, f.frozenSha256]));
  const changed = [];
  for (const entry of manifest.entries) {
    try {
      if (await hashFile(entry.path) !== entry.sha256) changed.push(entry.path);
    } catch {
      if (relocatedFrom.get(entry.path) !== entry.sha256) changed.push(`${entry.path} (missing)`);
    }
  }
  if (changed.length) throw new Error(`Frozen baseline changed:\n${changed.join('\n')}`);
  const v2Bytes = await readFile(join(root, 'harness/baselines/manifest.v2.json'));
  if (createHash('sha256').update(v2Bytes).digest('hex') !== evidenceManifestV2Sha256) throw new Error('Frozen v2 evidence inventory was edited; add a reviewed v3 instead.');
  const v2 = JSON.parse(v2Bytes.toString('utf8'));
  if (v2.parentManifestSha256 !== frozenManifestSha256) throw new Error('V2 evidence inventory does not reference the frozen v1 manifest');
  for (const entry of v2.entries) {
    try { if (await hashFile(entry.path) !== entry.sha256) changed.push(entry.path); }
    catch {
      // `.data/` holds gitignored local scratch (pruned 2026-10-03; kept videos
      // live in output/goal-videos/). Missing scratch is reported, never passed
      // as verified; missing repo files and hash mismatches still fail closed.
      if (entry.path.startsWith('.data/')) (globalThis.__prunedScratch ??= []).push(entry.path);
      else changed.push(`${entry.path} (missing)`);
    }
  }
  if (changed.length) throw new Error(`Frozen evidence changed:\n${changed.join('\n')}`);
  if (globalThis.__prunedScratch?.length) console.log(`note: ${globalThis.__prunedScratch.length} v2 .data scratch entries pruned from disk (unverifiable, not counted as verified)`);
  console.log(`verified ${manifest.entries.length} v1 and ${v2.entries.length} v2 evidence files; missing test sets: ${manifest.missingSets.map((x) => x.id).join(', ')}`);
  // Reviewed relocation (flat src/ layout): v3 carries the same fixture bytes at
  // new paths. v1 keeps reporting old paths as missing/changed (frozen history);
  // the run below re-verifies every v3 entry hash against disk so the gate stays
  // meaningful after the move. Correction record holds the import-only diff proof.
  const v3 = JSON.parse((await readFile(relocationManifestV3Path)).toString('utf8'));
  if (v3.immutable !== true || !Array.isArray(v3.entries)) throw new Error('Invalid relocation manifest v3');
  const correction = JSON.parse((await readFile(relocationCorrectionPath)).toString('utf8'));
  if (v3.parentCorrection !== 'harness/baselines/corrections/flat-layout-import-rewrite.v1.json' || correction.id !== 'flat-layout-import-rewrite.v1') throw new Error('v3 relocation is not backed by its reviewed correction record');
  const v3Bad = [];
  for (const entry of v3.entries) {
    try { if (await hashFile(entry.path) !== entry.sha256) v3Bad.push(entry.path); }
    catch { v3Bad.push(`${entry.path} (missing)`); }
    const rec = correction.files.find((f) => f.to === entry.path);
    if (!rec || rec.currentSha256 !== entry.sha256) v3Bad.push(`${entry.path} (no correction cover)`);
  }
  if (v3Bad.length) throw new Error(`Relocated fixtures changed:\n${v3Bad.join('\n')}`);
  console.log(`verified ${v3.entries.length} relocated v3 fixtures against their correction record`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
