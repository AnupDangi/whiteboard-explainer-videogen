import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// A real browser cannot resolve bare or node: specifiers. The player is served as native ES modules from dist/, so its
// statically reachable import graph must be relative-only. (A unit test never loads the page, which is how a Node-only
// import silently broke the player until it was opened in an actual browser.)
const root = path.resolve(process.cwd(), 'dist');

function staticImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/^(?:import|export)\s[^'";]*?from\s+['"]([^'"]+)['"]|^import\s+['"]([^'"]+)['"]/gm)].map((match) => (match[1] ?? match[2])!);
}

test('the browser player statically imports only relative modules, so it loads in a real browser', () => {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of staticImports(file)) {
      if (!specifier.startsWith('.')) { offenders.push(`${path.relative(root, file)} -> ${specifier}`); continue; }
      visit(path.resolve(path.dirname(file), specifier));
    }
  };
  visit(path.join(root, 'src/export/player/client.js'));
  assert.deepEqual(offenders, []);
  assert.ok(seen.size >= 2);
});

test('the V1 scene composer is loaded lazily, never as a static import of the player', () => {
  const client = readFileSync(path.join(root, 'src/export/player/client.js'), 'utf8');
  assert.doesNotMatch(client, /^import[^;]*from\s+['"]\.\.\/frame\.js['"]/m);
  assert.match(client, /import\(['"]\.\.\/frame\.js['"]\)/);
});
