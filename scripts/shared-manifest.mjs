#!/usr/bin/env node
// Regenerate or verify src/shared/MANIFEST.sha256.
// The shared directory is copied byte-for-byte between track worktrees; the
// manifest is how a copy proves it is identical.
//   node scripts/shared-manifest.mjs          # rewrite the manifest
//   node scripts/shared-manifest.mjs --check  # exit 1 if it is stale
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHARED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/shared');
const MANIFEST = path.join(SHARED, 'MANIFEST.sha256');
// Only files git tracks or would track (respects .gitignore, so venvs, caches
// and .DS_Store never enter the manifest).
function files() {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '.'], { cwd: SHARED, encoding: 'utf8' });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  return listed.stdout.split('\0').filter((rel) => rel && rel !== 'MANIFEST.sha256');
}

export function buildSharedManifest() {
  return files()
    .sort()
    .map((rel) => `${createHash('sha256').update(readFileSync(path.join(SHARED, rel))).digest('hex')}  ${rel}`)
    .join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expected = buildSharedManifest();
  if (process.argv.includes('--check')) {
    if (readFileSync(MANIFEST, 'utf8') !== expected) {
      console.error('shared/MANIFEST.sha256 is stale; run `pnpm run manifest:shared` after changing shared files.');
      process.exitCode = 1;
    } else console.log('shared manifest verified');
  } else {
    writeFileSync(MANIFEST, expected);
    console.log(`wrote ${expected.trim().split('\n').length} entries to ${path.relative(process.cwd(), MANIFEST)}`);
  }
}
