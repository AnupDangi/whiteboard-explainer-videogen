import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestLibrary, ingestSvg, type IconLibraryManifest } from '../catalog/libraryIngest.js';

const strokeIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
const duotone = '<svg viewBox="0 0 48 48"><path d="M4 4h40v40H4z" fill="#8fbffa"/><path d="M10 10h6v6h-6z" fill="#ffffff"/><path d="M4 4h40v40H4z" fill="none" stroke="#2859c5" stroke-width="3"/></svg>';
const meta = (id: string) => ({ id, set: 'testlib', name: id, tags: [], category: null, license: 'MIT' });
const files: Record<string, string> = {
  'clock.svg': strokeIcon,
  'box.svg': duotone,
  'moved.svg': '<svg viewBox="0 0 24 24"><path transform="translate(2,2)" d="M0 0h10" stroke="#000"/></svg>',
  'ref.svg': '<svg viewBox="0 0 24 24"><defs><path id="p" d="M0 0h1"/></defs><use href="#p"/></svg>',
  'grad.svg': '<svg viewBox="0 0 24 24"><path d="M0 0h10v10z" fill="url(#g)" stroke="#000"/></svg>',
  'noink.svg': '<svg viewBox="0 0 24 24"><path d="M0 0h10v10z" fill="#8fbffa"/></svg>',
};
const manifest: IconLibraryManifest = { schemaVersion: 'icon-library-manifest/v1', libraryId: 'testlib', version: '1.0.0', license: 'MIT', attribution: 'Test icons (MIT)', icons: Object.keys(files).map((file) => ({ file, names: [file.replace('.svg', '')] })) };

test('stroke-only currentColor icons become ink strokes with lengths', () => {
  const result = ingestSvg(strokeIcon, meta('clock'));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.entry.strokes.length, 2);
  assert.ok(result.entry.strokes.every((stroke) => stroke.len > 0 && stroke.w === 2));
  assert.equal(result.entry.fills.length, 0);
  assert.deepEqual(result.entry.vb, { w: 24, h: 24 });
});

test('duotone icons map fills to main, white, and ink roles', () => {
  const result = ingestSvg(duotone, meta('box'));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.entry.fills.map((fill) => fill.role), ['main', 'white']);
  assert.equal(result.entry.strokes.length, 1);
});

test('bad files are rejected individually with reasons', () => {
  const { catalog, rejected } = ingestLibrary(manifest, (file) => files[file]);
  assert.deepEqual(catalog.entries.map((entry) => entry.id), ['testlib:box', 'testlib:clock']);
  assert.deepEqual(Object.fromEntries(rejected.map((item) => [item.file, item.reason.split(':')[0]])), {
    'grad.svg': 'unsupported-paint', 'moved.svg': 'transform', 'noink.svg': 'no-ink', 'ref.svg': 'unsupported-element',
  });
});

test('ingest output is byte-stable and independent of manifest order', () => {
  const a = JSON.stringify(ingestLibrary(manifest, (file) => files[file]).catalog);
  const reversed = { ...manifest, icons: [...manifest.icons].reverse() };
  const b = JSON.stringify(ingestLibrary(reversed, (file) => files[file]).catalog);
  assert.equal(a, b);
});

test('a non-allowlisted license rejects the whole library', () => {
  assert.throws(() => ingestLibrary({ ...manifest, license: 'CC-BY-NC-4.0' }, (file) => files[file]), /license CC-BY-NC-4.0 is not allowlisted/);
});

test('icons over the path budget are rejected', () => {
  const many = `<svg viewBox="0 0 24 24">${Array.from({ length: 41 }, (_, index) => `<path d="M${index} 0h1" stroke="#000"/>`).join('')}</svg>`;
  const result = ingestSvg(many, meta('many'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /^too-many-paths/);
});

// Sketchy-family shape: CSS-var colours with literal fallbacks, a separate fill layer, an ink layer, and a coloured detail stroke.
const sketchy = '<svg viewBox="0 0 96 96" fill="none"><g stroke="none"><path fill="var(--sk-c1, #E8538F)" d="M10 10h40v40H10z"/></g><g stroke="currentColor" stroke-width="5"><path d="M10 10h40v40H10z"/><path d="M20 30h20" stroke="var(--sk-c2, #FFFFFF)"/></g></svg>';

test('sketchy icons: var() colours resolve, body fills keep their designed colour, detail strokes keep theirs', () => {
  const result = ingestSvg(sketchy, meta('badge'));
  assert.ok(result.ok, result.ok ? '' : result.reason);
  if (!result.ok) return;
  assert.deepEqual(result.entry.fills.map((fill) => [fill.role, fill.color]), [['main', '#e8538f']]);
  assert.deepEqual(result.entry.strokes.map((stroke) => stroke.color), [undefined, '#ffffff']);
});

test('an icon whose only strokes are coloured details is still rejected: the reveal needs an ink outline', () => {
  const detailOnly = '<svg viewBox="0 0 24 24"><path d="M0 0h10v10z" fill="#8fbffa"/><path d="M2 2h5" fill="none" stroke="#ffffff"/></svg>';
  const result = ingestSvg(detailOnly, meta('detail'));
  assert.equal(result.ok, false);
});
