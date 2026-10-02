import test from 'node:test';
import assert from 'node:assert/strict';
import { KIT_REGISTRY, parseKitParams } from '../visual-v2/kits/registry.js';
import { KIT_NAMES, type KitName } from '../visual-v2/board-ops/types.js';
import { contains, overlaps, type Rect } from '../visual-v2/kits/geometry.js';

const PARAMS: Record<KitName, unknown> = {
  stack: { capacity: 5 }, queue: { capacity: 4 }, array: { length: 6 }, compartment: { zones: ['out', 'in'], boundary: 'semipermeable', zoneLabels: ['OUTSIDE', 'INSIDE'] },
  'layered-stack': { layers: 4, repeat: 6 }, cycle: { nodes: 4 }, comparison: { sides: ['A', 'B'] }, graph: { nodes: 5 }, tree: { shape: [1, 2, 4] },
  'weighted-links': { left: 3, right: 3, labels: ['Q', 'K'] }, 'axes-plot': { fn: 'linear', params: [1, 0], domain: [0, 10] }, equation: { latex: 'a^2+b^2=c^2' },
};
const SLOTTED = KIT_NAMES.filter((name) => name !== 'axes-plot' && name !== 'equation');

function layoutOf(name: KitName) {
  const def = KIT_REGISTRY[name];
  const params = def.paramsSchema.parse(PARAMS[name]);
  const size = def.preferredSize(params, 5);
  const rect: Rect = { x: 100, y: 120, w: size.w, h: size.h };
  const zoneCapacity = Object.fromEntries(def.zones(params).map((zone: string) => [zone, 4]));
  return { def, params, rect, geometry: def.layout({ id: `${name}1`, params, label: 'kit', rect, capacity: 5, zoneCapacity }), zoneCapacity };
}

test('every kit has a registered definition, parses its example params and refuses unknown keys', () => {
  for (const name of KIT_NAMES) {
    assert.equal(KIT_REGISTRY[name].name, name);
    assert.equal(parseKitParams(name, JSON.stringify(PARAMS[name])).ok, true, name);
    assert.equal(parseKitParams(name, JSON.stringify({ ...(PARAMS[name] as object), surprise: 1 })).ok, false, `${name} must be strict`);
  }
  assert.deepEqual(parseKitParams('stack', 'not json'), { ok: false, error: 'paramsJson is not valid JSON text for kit stack' });
  assert.equal(parseKitParams('stack', '{"capacity":1}').ok, false);
  assert.equal(parseKitParams('compartment', '{"zones":["only"]}').ok, false);
  assert.match((parseKitParams('array', '{"length":99}') as { error: string }).error, /array params: length/);
});

test('every kit draws something and lays out deterministically', () => {
  for (const name of KIT_NAMES) {
    const a = layoutOf(name).geometry;
    const b = layoutOf(name).geometry;
    assert.equal(JSON.stringify(a.frame), JSON.stringify(b.frame), name);
    assert.ok(a.frame.paths.length + a.frame.texts.length + (a.frame.embeds?.length ?? 0) > 0, `${name} draws nothing`);
  }
});

test('slots lie inside the kit, never overlap, and are large enough to hold a child', () => {
  for (const name of SLOTTED) {
    const { def, params, rect, geometry } = layoutOf(name);
    const zones: Array<string | undefined> = def.zones(params).length ? def.zones(params) : [undefined];
    const slots: Rect[] = [];
    for (const zone of zones) for (let i = 0; i < geometry.slotCount(zone); i++) slots.push(geometry.slotRect(zone, i));
    assert.ok(slots.length >= 2, `${name} provides slots`);
    for (const slot of slots) { assert.ok(contains(rect, slot), `${name} slot outside kit ${JSON.stringify(slot)}`); assert.ok(slot.w >= 20 && slot.h >= 20, `${name} slot too small ${JSON.stringify(slot)}`); }
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) assert.equal(overlaps(slots[i]!, slots[j]!), false, `${name} slots ${i} and ${j} overlap`);
  }
});

test('a kit provides at least the capacity the scene needs, per zone for zoned kits', () => {
  const stack = layoutOf('stack');
  assert.ok(stack.geometry.slotCount(undefined) >= 5);
  const compartment = layoutOf('compartment');
  assert.ok(compartment.geometry.slotCount('out') >= 4 && compartment.geometry.slotCount('in') >= 4);
  const comparison = layoutOf('comparison');
  assert.ok(comparison.geometry.slotCount('A') >= 4);
});

test('slot order is meaningful: stack bottom-up, queue left to right, cycle clockwise from the top, array by cell', () => {
  const stack = layoutOf('stack').geometry;
  assert.ok(stack.slotRect(undefined, 0).y > stack.slotRect(undefined, 1).y, 'stack slot 0 is the bottom');
  const queue = layoutOf('queue').geometry;
  assert.ok(queue.slotRect(undefined, 0).x < queue.slotRect(undefined, 1).x, 'queue slot 0 is the front (left)');
  const cycle = layoutOf('cycle').geometry;
  const top = cycle.slotRect(undefined, 0);
  const next = cycle.slotRect(undefined, 1);
  assert.ok(top.y < next.y && next.x > top.x, 'cycle starts at the top and goes clockwise');
  const array = layoutOf('array').geometry;
  assert.equal(array.slotCount(undefined), 6);
  assert.ok(array.slotRect(undefined, 2).x < array.slotRect(undefined, 3).x);
});

test('zones are separate areas', () => {
  const { geometry } = layoutOf('compartment');
  assert.ok(geometry.slotRect('out', 0).x + geometry.slotRect('out', 0).w <= geometry.slotRect('in', 0).x + 1);
  const links = layoutOf('weighted-links').geometry;
  assert.ok(links.slotRect('left', 0).x < links.slotRect('right', 0).x);
});

test('the kits know no topic: no kit source names a lesson subject', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const dir = 'src/visual-v2/kits';
  for (const file of await readdir(dir)) {
    const text = await readFile(`${dir}/${file}`, 'utf8');
    assert.doesNotMatch(text, /osmosis|recursion|pythagor|attention|thermostat|vaccin|half-life|membrane/i, file);
  }
});
