#!/usr/bin/env node
// Asset Lab -> runtime sync: bridge manifest, bridge-family catalogs, vendored Iconify sets, embeddings.
// Usage: node scripts/assets-sync.mjs [--skip-bridge]   (ASSET_LAB_DIR overrides the lab location)
// Both the lab and the runtime use pnpm (docs/PNPM.md).
import { copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const run = (command, args, cwd) => { console.log(`\n$ ${command} ${args.join(' ')}   (${cwd})`); execFileSync(command, args, { cwd, stdio: 'inherit' }); };
const root = process.cwd();

function findLab() {
  if (process.env.ASSET_LAB_DIR) return resolve(process.env.ASSET_LAB_DIR);
  // Works from the repository checkout and from nested git worktrees (.claude/worktrees/<name>).
  for (let dir = root; dir !== dirname(dir); dir = dirname(dir)) {
    const candidate = join(dir, 'Assest-Library', 'asset-lab');
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  throw new Error('Asset Lab not found; set ASSET_LAB_DIR=/path/to/Assest-Library/asset-lab');
}

const lab = findLab();
const bridgeFile = join(lab, 'out', 'asset-bridge-v2', 'bridge.json');
if (!process.argv.includes('--skip-bridge')) run('pnpm', ['run', 'bridge-v2'], lab);
if (!existsSync(bridgeFile)) throw new Error(`missing ${bridgeFile}; run without --skip-bridge`);
copyFileSync(bridgeFile, join(root, 'src/assets/data/asset-bridge-v2.json'));
run('npx', ['tsc'], root);
run('node', ['scripts/ingest-bridge-assets.mjs', 'src/assets/data/asset-bridge-v2.json', lab], root);
run('node', ['scripts/ingest-iconify-sets.mjs'], root);
run('node', ['scripts/embed-catalog.mjs'], root);
console.log('\nassets synced. Review src/assets/data/bridge-ingest-report.json, then run the offline suite.');
