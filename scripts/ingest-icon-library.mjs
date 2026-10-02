#!/usr/bin/env node
// Offline icon-library ingest. Usage: node scripts/ingest-icon-library.mjs <libraryDir> [outDir]
// <libraryDir>/manifest.json follows icon-library-manifest/v1; SVG paths are relative to libraryDir.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ingestLibrary } from '../dist/src/assets/libraryIngest.js';

const [libraryDir, outDir = 'src/assets/data'] = process.argv.slice(2);
if (!libraryDir) {
  console.error('usage: ingest-icon-library.mjs <libraryDir> [outDir]');
  process.exit(2);
}

const libraryRoot = realpathSync(resolve(libraryDir));
const manifest = JSON.parse(readFileSync(join(libraryRoot, 'manifest.json'), 'utf8'));
const { catalog, rejected } = ingestLibrary(manifest, (file) => {
  const fullPath = realpathSync(resolve(libraryRoot, file));
  const relativePath = relative(libraryRoot, fullPath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('path escapes library directory');
  }
  return readFileSync(fullPath, 'utf8');
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${catalog.libraryId}.json`), `${JSON.stringify(catalog)}\n`);
writeFileSync(join(outDir, `${catalog.libraryId}.ingest-report.json`), `${JSON.stringify({
  libraryId: catalog.libraryId,
  version: catalog.version,
  accepted: catalog.entries.length,
  rejected,
  limitations: ['SVG style attributes are not parsed; use presentation attributes for fill, stroke, stroke-width, and fill-rule.'],
}, null, 2)}\n`);
console.log(`accepted ${catalog.entries.length}, rejected ${rejected.length} → ${join(outDir, `${catalog.libraryId}.json`)}`);
