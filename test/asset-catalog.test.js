import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileScene} from '../dist/src/semantic/compiler/compile-scene.js';
import {renderSVG} from '../dist/src/semantic/renderer/render-svg.js';
import {resolveAsset, getAsset} from '../dist/src/semantic/assets/registry.js';
import {convertSvgToAsset} from '../dist/src/semantic/assets/external/convert.js';

/** P2 — an asset the static registry does not hold must travel inside the
 *  compiled scene and render identically in-process, in a fresh process (the
 *  export path) and after a JSON round-trip (the browser path). No registry
 *  entry, no network. */

const CATALOG_ID = 'external.database.v1';
const {asset} = convertSvgToAsset({
  id: CATALOG_ID,
  svg: '<svg viewBox="0 0 24 24"><path d="M4 6 L20 6 L20 18 L4 18 Z" fill="none" stroke="#000"/></svg>',
  aliases: ['database'],
  tags: ['database'],
  semanticTypes: ['entity'],
  archetypes: ['flow'],
  provenance: {provider: 'test', collection: 'test', sourceAssetId: 'db', licenseId: 'MIT', fetchedAt: '2026-01-01T00:00:00.000Z'},
});
const catalog = {[CATALOG_ID]: asset};

const scene = {
  version: 2, id: 'catalog-scene', title: 'Catalog', teachingGoal: 'g', mentalModel: 'm', archetype: 'flow',
  objects: [
    {id: 'a', conceptId: 'a', label: 'Store', role: 'hero', assetRef: CATALOG_ID, children: [], state: 'neutral', allowedStates: ['neutral', 'highlighted', 'activated'], importance: 'primary', collisionPolicy: 'forbid'},
    {id: 'b', conceptId: 'b', label: 'Read', role: 'support', children: [], state: 'neutral', allowedStates: ['neutral'], importance: 'secondary', collisionPolicy: 'forbid', primitiveRef: 'rectangle'},
  ],
  relations: [{id: 'r', from: {objectId: 'a', anchor: 'center'}, to: {objectId: 'b', anchor: 'center'}, relationType: 'flows_to', visualForm: 'arrow'}],
  beats: [{id: 'beat_1', narration: 'probe', actions: [
    {id: 'x1', type: 'reveal', objectIds: ['a'], relationIds: [], durationMs: 400, leadMs: 0, easing: 'linear'},
    {id: 'x2', type: 'reveal', objectIds: ['b'], relationIds: [], durationMs: 400, leadMs: 0, easing: 'linear'},
  ]}],
  continuity: {keepFromPrevious: [], prepareForNext: []},
};

test('an asset that exists only in the scene catalog is not in the static registry', () => {
  assert.throws(() => getAsset(CATALOG_ID), /Unknown asset/);
  assert.equal(resolveAsset(CATALOG_ID, catalog).id, CATALOG_ID);
  assert.throws(() => resolveAsset(CATALOG_ID, undefined), /Unknown asset/, 'without a catalog it must still fail');
  assert.throws(() => resolveAsset(CATALOG_ID), /Unknown asset/);
});

test('the compiled scene carries the catalog and renders the catalog-only asset', () => {
  const compiled = compileScene(scene, undefined, undefined, catalog);
  assert.ok(compiled.assetCatalog, 'the catalog must be embedded in the compiled scene');
  assert.equal(compiled.assetCatalog[CATALOG_ID].id, CATALOG_ID);
  const svg = renderSVG(compiled, compiled.durationMs);
  assert.ok(!/undefined/.test(svg), 'the asset geometry must resolve, not degrade to "undefined"');
  assert.ok(svg.includes('stroke="#233832"'), 'the outline role must resolve through the palette');
});

test('a scene without a catalog embeds none, so the static path is unchanged', () => {
  const stripAsset = ({assetRef, ...rest}) => assetRef ? {...rest, primitiveRef: 'rectangle'} : rest;
  const compiled = compileScene({...scene, objects: scene.objects.map(stripAsset)});
  assert.equal(compiled.assetCatalog, undefined);
});

test('catalog rendering is identical in a fresh process and after a JSON round-trip', () => {
  const compiled = compileScene(scene, undefined, undefined, catalog);
  const inProcess = renderSVG(compiled, compiled.durationMs);
  assert.equal(renderSVG(JSON.parse(JSON.stringify(compiled)), compiled.durationMs), inProcess,
    'the browser path (serialized scene) must render identically');

  const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
  const scenePath = join(dir, 'scene.json');
  writeFileSync(scenePath, JSON.stringify(compiled));
  const fresh = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {readFileSync} from 'node:fs';
    import {renderSVG} from '${process.cwd()}/dist/src/semantic/renderer/render-svg.js';
    const scene = JSON.parse(readFileSync('${scenePath}', 'utf8'));
    process.stdout.write(renderSVG(scene, scene.durationMs));
  `], {encoding: 'utf8'});
  assert.equal(fresh, inProcess, 'the export path (fresh process) must render identically');
});
