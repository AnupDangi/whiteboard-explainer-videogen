import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileScene} from '../dist/src/semantic/compiler/compile-scene.js';
import {renderSVG} from '../dist/src/semantic/renderer/render-svg.js';
import {resolveAssetColor, themePalette, DEFAULT_THEME} from '../dist/src/semantic/renderer/palette.js';
import {COLORS} from '../dist/src/semantic/renderer/style.js';
import {validateAsset} from '../dist/src/semantic/assets/validator.js';
import {getAsset} from '../dist/src/semantic/assets/registry.js';

/** P0 — palette and fill modes are additive.
 *
 *  The compatibility theme must reproduce existing SVG byte-for-byte, or the
 *  whole icon track is unsafe to build on top of. The hashes are pinned in
 *  `test/golden-svg-hashes.json`; an intentional renderer change must update
 *  that file deliberately. */

const pinned = JSON.parse(readFileSync('test/golden-svg-hashes.json', 'utf8'));
const hashOf = (svg) => createHash('sha256').update(svg).digest('hex').slice(0, 16);

test('the default theme reproduces every fixture byte-for-byte', () => {
  for (const [file, expected] of Object.entries(pinned)) {
    const scene = JSON.parse(readFileSync(`examples/semantic/${file}`, 'utf8'));
    const compiled = compileScene(scene);
    assert.equal(hashOf(renderSVG(compiled, compiled.durationMs)), expected,
      `${file} drifted; an intentional renderer change must re-pin the golden hash`);
  }
});

test('every fixture on disk is covered by the pinned hashes', () => {
  const onDisk = readdirSync('examples/semantic').filter(f => f.endsWith('.scene.json')).sort();
  assert.deepEqual(Object.keys(pinned).sort(), onDisk,
    'a new fixture must be added to the golden hashes');
});

test('a role resolves to the same hex as the equivalent legacy token', () => {
  const palette = themePalette();
  assert.equal(resolveAssetColor(undefined, 'outline', palette), COLORS.ink);
  assert.equal(resolveAssetColor(undefined, 'primary', palette), COLORS.green);
  assert.equal(resolveAssetColor(undefined, 'secondary', palette), COLORS.blue);
  assert.equal(resolveAssetColor(undefined, 'accent', palette), COLORS.amber);
  assert.equal(resolveAssetColor(undefined, 'neutral', palette), COLORS.earth);
  assert.equal(resolveAssetColor(undefined, 'primaryShadow', palette), COLORS.red);
  // legacy path is untouched
  assert.equal(resolveAssetColor('green', undefined, palette), COLORS.green);
  // no colour is undefined, not black
  assert.equal(resolveAssetColor(undefined, undefined, palette), undefined);
  assert.equal(resolveAssetColor('nonsense', undefined, palette), undefined);
});

test('an unknown theme is rejected rather than silently defaulted', () => {
  assert.equal(DEFAULT_THEME, 'chalk-ink-v2');
  assert.throws(() => themePalette('neon'), /Unknown theme/);
});

test('a part must address colour by a token or a role, never both or neither', () => {
  const base = getAsset('nature.sun.v2');
  const withRole = structuredClone(base);
  withRole.parts[0].strokeRole = 'primary';
  delete withRole.parts[0].stroke;
  assert.doesNotThrow(() => validateAsset(withRole), 'a role-only part is valid');

  const both = structuredClone(base);
  both.parts[0].strokeRole = 'primary';
  assert.throws(() => validateAsset(both), /exactly one of stroke or strokeRole/);

  const neither = structuredClone(base);
  delete neither.parts[0].stroke;
  assert.throws(() => validateAsset(neither), /exactly one of stroke or strokeRole/);

  const badRole = structuredClone(base);
  delete badRole.parts[0].stroke;
  badRole.parts[0].strokeRole = 'chartreuse';
  assert.throws(() => validateAsset(badRole), /Unknown stroke role/);

  const badMode = structuredClone(base);
  badMode.parts[0].fillMode = 'gradient';
  assert.throws(() => validateAsset(badMode), /Unknown fill mode/);

  const badOpacity = structuredClone(base);
  badOpacity.parts[0].fillOpacity = 1.5;
  assert.throws(() => validateAsset(badOpacity), /Invalid fill opacity/);
});
