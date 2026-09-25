import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStreamlineCatalog } from '../catalog/streamline.js';
import { normalizeCatalogEntry, LICENSE_ALLOWLIST } from '../catalog/normalize.js';
import { STYLE } from '../style.js';

const catalog = loadStreamlineCatalog();

test('streamline: every ingested icon has an ink outline to draw on and an allowlisted licence', () => {
  assert.ok(catalog.entries.length > 1500, `expected the full free duotone sets, got ${catalog.entries.length}`);
  for (const e of catalog.entries) {
    assert.ok(e.strokePaths > 0);
    assert.ok(LICENSE_ALLOWLIST.includes(e.license), `${e.id}: ${e.license}`);
    assert.ok(normalizeCatalogEntry(e).ok, e.id);
  }
});

test('streamline: normalization maps the outline to house ink and the body to the element palette token', () => {
  const leaf = catalog.entries.find((e) => e.id === 'streamline-color:leaf')!;
  const v = leaf.render({ w: 150, h: 150 }, 'green');
  assert.ok(v.paths.length > 0 && v.paths.every((p) => p.transform && (p.pxScale ?? 0) > 0));
  const fills = new Set(v.fills.map((f) => f.fill));
  assert.ok(fills.has(STYLE.palette.green), 'main body takes the requested palette colour');
  for (const f of fills) assert.ok([STYLE.palette.green, '#FFFFFF', STYLE.stroke.color].includes(f), `unexpected fill ${f}`);
});

test('streamline: rendering is deterministic and path data contains no markup', () => {
  const sun = catalog.entries.find((e) => e.names[0] === 'sun')!;
  assert.deepEqual(sun.render({ w: 120, h: 120 }, 'yellow'), sun.render({ w: 120, h: 120 }, 'yellow'));
  for (const p of sun.render({ w: 120, h: 120 }).paths) assert.doesNotMatch(p.d, /[<>]/);
});

test('streamline: attribution text is available for every video that uses the catalog', () => {
  assert.match(catalog.attribution, /Streamline/);
  assert.match(catalog.attribution, /CC BY 4\.0/);
});
