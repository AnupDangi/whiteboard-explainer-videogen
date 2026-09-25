import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const destination = join(root, 'harness/baselines/manifest.v2.json');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const filesIn = async (dir, suffixes) => {
  try { return (await readdir(join(root, dir))).filter((name) => suffixes.some((suffix) => name.endsWith(suffix))).sort().map((name) => `${dir}/${name}`); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
};

async function build() {
  const entries = [];
  const referenceVideos = await filesIn('../lamina-labs-video', ['.mp4']);
  const referenceFrames = await filesIn('harness/reference/lamina', ['.png']);
  const runs = [];
  for (const category of ['fixtures', 'live', 'lessons']) {
    const base = `.data/hypothesis-runs/claude/${category}`;
    const directories = (await readdir(join(root, base), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const name of directories) {
      const runDir = `${base}/${name}`;
      const files = await filesIn(runDir, ['.mp4', 'contact-sheet.svg', 'evaluation-bundle.json', 'run-manifest.json']);
      if (!files.length) continue;
      let manifest = {};
      try { manifest = JSON.parse(await readFile(join(root, runDir, 'run-manifest.json'), 'utf8')); } catch { /* legacy run */ }
      const inferredClass = category === 'fixtures' ? 'renderer-fixture' : category === 'live' ? 'hand-authored-script' : 'generated-lesson';
      runs.push({ directory: runDir, runClass: manifest.runClass ?? inferredClass, classProvenance: manifest.runClass ? 'manifest' : 'inferred-from-run-directory', status: manifest.status ?? 'legacy-unclassified', runId: manifest.runId ?? null, files });
    }
  }
  const add = async (file, role, metadata = {}) => entries.push({ path: file, sha256: sha(await readFile(join(root, file))), role, ...metadata });
  for (const file of referenceVideos) await add(file, 'reference-video');
  for (const file of referenceFrames) await add(file, 'reference-frame');
  for (const run of runs) for (const file of run.files) await add(file, 'retained-run-artifact', { runClass: run.runClass, status: run.status, classProvenance: run.classProvenance, runId: run.runId });
  return {
    schemaVersion: 'baseline-inventory/v2', baselineVersion: 2, frozenAt: new Date().toISOString(), immutable: true,
    parentManifestSha256: sha(await readFile(join(root, 'harness/baselines/manifest.v1.json'))),
    correction: 'simi-scene01.png is from photosynthesis simi.mp4; lamina-video-ec6c5e81-291c-4917-93f5-7820f50b4213-1-scene01.png is the Attention reference. The earlier token-strip comparison is withdrawn.',
    entries,
    missingSets: [
      { id: 'G-10', status: 'partial', reason: 'Full ten-lesson frozen source set is not available.' },
      { id: 'G-DOC', status: 'missing', reason: 'Five unseen source documents are not frozen.' },
      { id: 'G-LONG', status: 'missing', reason: 'Four long-form inputs are not frozen.' },
    ],
  };
}

if (process.argv.includes('--freeze')) {
  const result = await build();
  await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(`froze v2 evidence inventory: ${result.entries.length} files, sha256=${sha(await readFile(destination))}`);
} else {
  const inventory = JSON.parse(await readFile(destination, 'utf8'));
  const changed = [];
  for (const entry of inventory.entries) {
    try { if (sha(await readFile(join(root, entry.path))) !== entry.sha256) changed.push(entry.path); }
    catch { changed.push(`${entry.path} (missing)`); }
  }
  if (changed.length) throw new Error(`Retained evidence changed:\n${changed.join('\n')}`);
  console.log(`verified v2 evidence inventory: ${inventory.entries.length} files; missing sets: ${inventory.missingSets.map((set) => set.id).join(', ')}`);
}
