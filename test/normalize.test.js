import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeSvg} from '../dist/src/semantic/assets/normalize/sanitize.js';
import {parsePath} from '../dist/src/semantic/assets/normalize/path.js';
import {flattenSegments} from '../dist/src/semantic/assets/normalize/geometry.js';
import {parseTransform, applyMatrix, IDENTITY} from '../dist/src/semantic/assets/normalize/transform.js';
import {paintToRole} from '../dist/src/semantic/assets/normalize/colors.js';
import {convertSvgToAsset} from '../dist/src/semantic/assets/external/convert.js';

/** P1 — the normalizer is the only ingest path for external geometry, so it
 *  must fail closed on anything it does not fully understand. */

const svg = (body) => `<svg viewBox="0 0 24 24">${body}</svg>`;

test('the sanitizer rejects every scripting, embedding and reference vector', () => {
  const bad = [
    svg('<script>alert(1)</script>'),
    svg('<foreignObject><div/></foreignObject>'),
    svg('<iframe src="x"/>'),
    svg('<image href="x"/>'),
    svg('<use href="#a"/>'),
    svg('<text>hello</text>'),
    svg('<style>path{fill:red}</style>'),
    svg('<defs><path d="M0 0"/></defs>'),
    svg('<path d="M0 0" onclick="alert(1)"/>'),
    svg('<path d="M0 0" href="https://evil.test/x"/>'),
    svg('<path d="M0 0" xlink:href="#x"/>'),
    svg('<path d="M0 0" style="fill:url(#x)"/>'),
    svg('<path d="M0 0" fill="url(#gradient)"/>'),
    svg('<path d="M0 0" style="fill:red"/>'),
    svg('<animate attributeName="x"/>'),
    '<?xml-stylesheet href="x"?>' + svg('<path d="M0 0"/>'),
    '<!ENTITY x "y">' + svg('<path d="M0 0"/>'),
    '<svg><a href="https://evil.test"><path d="M0 0"/></a></svg>',
    svg('<path d="M0 0" fill="https://evil.test/x.svg"/>'),
  ];
  for (const input of bad) assert.throws(() => sanitizeSvg(input), `${input.slice(0, 60)} must be rejected`);
});

test('a namespace declaration is not an external reference, but a real reference still is', () => {
  const real = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" d="M5 12h14"/></svg>';
  assert.doesNotThrow(() => sanitizeSvg(real), 'every real icon carries an xmlns declaration');
  assert.throws(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/x"/></svg>'), /forbidden element/);
  assert.throws(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" style="fill:url(#g)"/></svg>'), /external or scripting reference/);
  assert.throws(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" fill="https://evil.test/x.svg"/></svg>'), /external URL/);
});

test('the sanitizer accepts the geometry it is meant to convert', () => {
  const good = svg('<g transform="translate(1 2)"><path d="M0 0 L10 10"/><rect x="1" y="1" width="4" height="4"/><circle cx="5" cy="5" r="2"/><polyline points="0,0 1,1"/></g>');
  const result = sanitizeSvg(good);
  assert.equal(result.svg, good);
  assert.ok(result.elementCount >= 5);
  assert.throws(() => sanitizeSvg(''), /empty/);
  assert.throws(() => sanitizeSvg('<div/>'), /missing <svg> root/);
});

test('the path parser resolves relative commands, implicit repetition and shorthand', () => {
  assert.deepEqual(parsePath('M1 2 L3 4'), [{cmd: 'M', x: 1, y: 2}, {cmd: 'L', x: 3, y: 4}]);
  assert.deepEqual(parsePath('m1 2 l1 1 1 1'), [
    {cmd: 'M', x: 1, y: 2},
    {cmd: 'L', x: 2, y: 3},
    {cmd: 'L', x: 3, y: 4},
  ], 'extra coordinate pairs repeat the command');
  assert.deepEqual(parsePath('M0 0 M5 5 L6 6').slice(0, 2), [{cmd: 'M', x: 0, y: 0}, {cmd: 'M', x: 5, y: 5}]);
  assert.deepEqual(parsePath('M10 10 H20 V5'), [
    {cmd: 'M', x: 10, y: 10},
    {cmd: 'L', x: 20, y: 10},
    {cmd: 'L', x: 20, y: 5},
  ]);
  // S reflects the previous cubic control point about the current point, so the
  // reflected control is (2*10-10, 2*10-0) = (10, 20).
  const smooth = parsePath('M0 0 C0 0 10 0 10 10 S20 20 20 0');
  assert.deepEqual(smooth[2], {cmd: 'C', x1: 10, y1: 20, x2: 20, y2: 20, x: 20, y: 0});
  const quadratic = parsePath('M0 0 Q5 10 10 0 T20 0');
  assert.deepEqual(quadratic[2], {cmd: 'Q', x1: 15, y1: -10, x: 20, y: 0});
});

test('arc flags are read as single characters, not swallowed as numbers', () => {
  const segments = parsePath('M0 0 A5 5 0 0110 10');
  assert.equal(segments.length, 2);
  assert.equal(segments[1].cmd, 'A');
  assert.equal(segments[1].largeArc, 0);
  assert.equal(segments[1].sweep, 1);
  assert.equal(segments[1].x, 10);
  assert.equal(segments[1].y, 10);
});

test('flattening is deterministic and produces only finite points', () => {
  const segments = parsePath('M0 0 C0 10 10 10 10 0 Q5 -5 0 0 A3 3 0 1 0 0 0 Z');
  const first = flattenSegments(segments);
  const second = flattenSegments(parsePath('M0 0 C0 10 10 10 10 0 Q5 -5 0 0 A3 3 0 1 0 0 0 Z'));
  assert.deepEqual(first, second);
  assert.ok(first[0].closed);
  for (const point of first[0].points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
});

test('transforms compose and an unknown function is rejected, never ignored', () => {
  assert.deepEqual(parseTransform(''), IDENTITY);
  const moved = applyMatrix(parseTransform('translate(10 20)'), {x: 1, y: 1});
  assert.deepEqual(moved, {x: 11, y: 21});
  const scaled = applyMatrix(parseTransform('translate(10 20) scale(2)'), {x: 1, y: 1});
  assert.deepEqual(scaled, {x: 12, y: 22});
  const rotated = applyMatrix(parseTransform('rotate(90)'), {x: 1, y: 0});
  assert.ok(Math.abs(rotated.x - 0) < 1e-9 && Math.abs(rotated.y - 1) < 1e-9);
  assert.deepEqual(applyMatrix(parseTransform('matrix(1 0 0 1 5 5)'), {x: 0, y: 0}), {x: 5, y: 5});
  assert.throws(() => parseTransform('warp(3)'), /Unsupported transform function/);
  assert.throws(() => parseTransform('translate(1 2 3)'), /translate takes/);
});

test('paint maps to a role, and an unmapped colour is reported', () => {
  assert.deepEqual(paintToRole(undefined, 'stroke'), {role: 'outline'});
  assert.deepEqual(paintToRole('none', 'fill'), {});
  assert.deepEqual(paintToRole('#ffffff', 'fill'), {role: 'white'});
  const unknown = paintToRole('#ff00ff', 'stroke');
  assert.equal(unknown.role, 'outline');
  assert.match(unknown.warning ?? '', /unmapped stroke colour/);
});

test('a stroke icon converts to a valid, deterministic asset', () => {
  const input = {
    id: 'external.database.v1',
    svg: svg('<path d="M4 6 C4 4 20 4 20 6 L20 18 C20 20 4 20 4 18 Z" fill="none" stroke="#000"/>'),
    aliases: ['database'],
    tags: ['database', 'storage'],
    semanticTypes: ['entity'],
    archetypes: ['flow'],
    provenance: {provider: 'test', collection: 'test', sourceAssetId: 'db', licenseId: 'MIT', fetchedAt: '2026-01-01T00:00:00.000Z'},
  };
  const first = convertSvgToAsset(input);
  const second = convertSvgToAsset(input);
  assert.deepEqual(first.asset, second.asset, 'the converter must be deterministic');
  assert.deepEqual(first.provenance, second.provenance);
  assert.equal(first.provenance.sourceHash, second.provenance.sourceHash);
  assert.equal(first.provenance.normalizerVersion, 'normalize-v1');
  assert.equal(first.asset.parts.length, 1);
  assert.equal(first.asset.parts[0].strokeRole, 'outline');
  assert.equal(first.asset.parts[0].fillRole, undefined);
  assert.deepEqual(first.asset.viewBox, [0, 0, 24, 24]);
  assert.ok(first.asset.anchors.center && first.asset.anchors.input && first.asset.anchors.output);
  assert.equal(first.conversion.conversionType, 'stroke_native');
});

test('a converted asset survives the same validator the curated assets use', () => {
  const {asset} = convertSvgToAsset({id: 'external.box.v1', svg: svg('<rect x="2" y="2" width="20" height="20" fill="#367354" stroke="#000"/>')});
  assert.equal(asset.type, 'icon');
  assert.equal(asset.fillRole, undefined);
  assert.equal(asset.parts.length, 1);
  assert.equal(asset.parts[0].fillRole, 'primary');
  assert.equal(asset.parts[0].fillMode, 'wash');
  assert.deepEqual(asset.states.highlighted.partIds, ['p0']);
});

test('the converter refuses an SVG with no drawable geometry', () => {
  assert.throws(() => convertSvgToAsset({id: 'external.empty.v1', svg: svg('<g><title>x</title></g>')}),
    /forbidden element|no drawable geometry/);
  assert.throws(() => convertSvgToAsset({id: 'external.script.v1', svg: svg('<script>x</script>')}),
    /forbidden element/);
});
