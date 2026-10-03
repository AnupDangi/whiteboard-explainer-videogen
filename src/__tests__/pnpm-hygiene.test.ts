import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { packageManager?: string; scripts: Record<string, string>; pnpm?: { overrides?: Record<string, string> } };

test('pnpm is the only package manager: pinned, locked, and no npm lockfile or npm script invocation', () => {
  assert.match(manifest.packageManager ?? '', /^pnpm@10\./);
  assert.ok(existsSync(path.join(root, 'pnpm-lock.yaml')));
  for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock']) assert.equal(existsSync(path.join(root, lock)), false, lock);
  for (const [name, command] of Object.entries(manifest.scripts)) assert.doesNotMatch(command, /\bnpm\b|\bnpx\b/, `script ${name} must use pnpm`);
  const voice = JSON.parse(readFileSync(path.join(root, 'voice-engine', 'package.json'), 'utf8')) as { packageManager?: string; scripts: Record<string, string> };
  assert.match(voice.packageManager ?? '', /^pnpm@10\./);
  for (const [name, command] of Object.entries(voice.scripts)) assert.doesNotMatch(command, /\bnpm\b|\bnpx\b/, `voice-engine script ${name}`);
});

test('the known-vulnerable transitive @xmldom/xmldom is pinned to a patched release', () => {
  assert.equal(manifest.pnpm?.overrides?.['@xmldom/xmldom'], '>=0.9.12');
  const lock = readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  const versions = [...lock.matchAll(/'?@xmldom\/xmldom@(\d+\.\d+\.\d+)'?:/g)].map((m) => m[1]!);
  assert.ok(versions.length > 0);
  for (const version of versions) {
    const [major, minor, patch] = version.split('.').map(Number);
    assert.ok(major! > 0 || minor! > 9 || (minor === 9 && patch! >= 12), `@xmldom/xmldom ${version} is vulnerable`);
  }
});

test('operator-facing scripts and examples name pnpm, never npm', () => {
  const files = ['.env.example', 'voice-engine/setup.sh', 'scripts/assets-sync.mjs', 'docs/PNPM.md'];
  for (const file of files.filter((f) => f !== 'docs/PNPM.md')) assert.doesNotMatch(readFileSync(path.join(root, file), 'utf8'), /\bnpm (run|install|i|ci|test)\b/, file);
  assert.ok(readdirSync(path.join(root, 'scripts')).length > 0);
});
