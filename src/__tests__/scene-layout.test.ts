import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardOpSchema, type BoardOp } from '../visual-v2/board-ops/types.js';
import { applyOp, emptyBoardState } from '../visual-v2/board-state/reducer.js';
import type { BoardState } from '../visual-v2/board-state/types.js';
import { diagnoseSceneGeometry, layoutScene, routeEdge, validateSceneGeometry, CONTENT_RECT } from '../visual-v2/layout/sceneLayout.js';
import { contains, overlaps } from '../visual-v2/kits/geometry.js';

const add = (id: string, element: unknown, at: unknown, beat = 'b1') => BoardOpSchema.parse({ op: 'add', opId: `${beat}.${id}`, beatId: beat, id, element, at });
const kit = (kitName: string, paramsJson: string, label?: string) => ({ type: 'kit', kit: kitName, paramsJson, ...(label ? { label } : {}), provenance: 'metaphorical' });
const token = (text: string) => ({ type: 'token', text, provenance: 'illustrative' });

function statesOf(ops: BoardOp[], groupBy: (op: BoardOp) => string = (op) => op.beatId): BoardState[] {
  const states: BoardState[] = [];
  let state = emptyBoardState();
  let current = '';
  for (const op of ops) {
    const key = groupBy(op);
    state = applyOp(state, op).state;
    if (key !== current) { states.push(state); current = key; } else states[states.length - 1] = state;
  }
  return states;
}

const recursion: BoardOp[] = [
  add('stack1', kit('stack', '{}', 'call stack'), { region: 'center' }, 'b0'),
  ...[4, 3, 2, 1].map((n, i) => add(`f${n}`, token(`f(${n})`), { region: 'center', container: 'stack1', slot: 'top' }, `b${i + 1}`)),
  ...[1, 2, 3, 4].map((n, i) => BoardOpSchema.parse({ op: 'remove', opId: `b${i + 5}.pop`, beatId: `b${i + 5}`, target: `f${n}` })),
];

test('a stack scene reserves its slots up front: every child keeps one rect for the whole scene', () => {
  const states = statesOf(recursion);
  const geometry = layoutScene(states);
  const f4 = states.filter((s) => s.elements.f4 && !s.elements.f4.lifecycle.removedAtBeat).map((s) => geometry.rectFor(s, 'f4')!);
  assert.ok(f4.length >= 2);
  for (const rect of f4) assert.deepEqual(rect, f4[0]);
  const f3 = geometry.rectFor(states[2]!, 'f3')!;
  assert.ok(f3.y < f4[0]!.y, 'the second item sits above the first');
  const stack = geometry.rectFor(states[0]!, 'stack1')!;
  for (const n of [4, 3, 2, 1]) assert.ok(contains(stack, geometry.rectFor(states[4]!, `f${n}`)!), `f${n} inside the stack`);
});

test('layout is deterministic and keeps everything inside the safe area without overlaps', () => {
  const states = statesOf(recursion);
  const a = layoutScene(states);
  const b = layoutScene(states);
  assert.equal(JSON.stringify(a.allRects()), JSON.stringify(b.allRects()));
  assert.deepEqual(validateSceneGeometry(a, states), []);
  for (const rect of a.allRects()) assert.ok(contains(CONTENT_RECT, rect.rect), `${rect.id} inside the content area`);
});

test('semantic regions become separate areas: left, center and right do not overlap and keep reading order', () => {
  const ops = [
    add('src', kit('queue', '{"capacity":3}', 'in'), { region: 'left' }),
    add('mid', { type: 'entity', conceptId: 'worker', label: 'worker', provenance: 'source' }, { region: 'center' }),
    add('dst', kit('queue', '{"capacity":3}', 'out'), { region: 'right' }),
  ];
  const states = statesOf(ops, () => 'b1');
  const g = layoutScene(states);
  const [l, m, r] = ['src', 'mid', 'dst'].map((id) => g.rectFor(states[0]!, id)!);
  assert.ok(l!.x + l!.w <= m!.x + 1 && m!.x + m!.w <= r!.x + 1, 'left < center < right');
  assert.equal(overlaps(l!, r!), false);
  assert.deepEqual(validateSceneGeometry(g, states), []);
});

test('zoned kit placement is stable and reports a move path through occupied slots', () => {
  const cell = kit('compartment', '{"zones":["outside","inside"],"zoneLabels":["OUT","IN"]}', 'cell');
  const ops: BoardOp[] = [add('cell', cell, { region: 'center' }, 'b0')];
  for (let i = 1; i <= 6; i++) ops.push(add(`p${i}`, token(String(i)), { region: 'center', container: 'cell', zone: i <= 4 ? 'outside' : 'inside' }, 'b1'));
  ops.push(BoardOpSchema.parse({ op: 'move', opId: 'b2.m', beatId: 'b2', target: 'p1', to: { region: 'center', container: 'cell', zone: 'inside' } }));
  const states = statesOf(ops);
  const g = layoutScene(states);
  const last = states[states.length - 1]!;
  const outside = g.rectFor(last, 'p2')!;
  const inside = g.rectFor(last, 'p1')!;
  assert.ok(outside.x < inside.x, 'outside is left of inside');
  const diagnostics = diagnoseSceneGeometry(g, states);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === 'movement_path_collision' && diagnostic.message.startsWith('transition 2: p1')));
  assert.ok(diagnostics.every((diagnostic) => diagnostic.message.startsWith('transition 2:')));
});

test('an element that moves between slots has a rect in both places, so the move can be drawn', () => {
  const ops: BoardOp[] = [
    add('q1', kit('queue', '{"capacity":3}'), { region: 'left' }, 'b0'), add('q2', kit('queue', '{"capacity":3}'), { region: 'right' }, 'b0'),
    add('x', token('x'), { region: 'left', container: 'q1', slot: 'end' }, 'b1'),
    BoardOpSchema.parse({ op: 'move', opId: 'b2.m', beatId: 'b2', target: 'x', to: { region: 'right', container: 'q2', slot: 'end' } }),
  ];
  const states = statesOf(ops);
  const g = layoutScene(states);
  const before = g.rectFor(states[1]!, 'x')!;
  const after = g.rectFor(states[2]!, 'x')!;
  assert.ok(after.x > before.x + 300);
});

test('geometry validation reports overflow, overlap and unreadable size instead of hiding them', () => {
  const states = statesOf([add('a', kit('stack', '{}'), { region: 'center' }, 'b0')], () => 'b0');
  const g = layoutScene(states);
  const rect = g.rectFor(states[0]!, 'a')!;
  const broken = { ...g, rectFor: () => ({ ...rect, x: -50 }), allRects: () => [{ id: 'a', rect: { ...rect, x: -50 } }] } as unknown as typeof g;
  assert.ok(validateSceneGeometry(broken, states).some((p) => /outside the safe area/.test(p)));
});

test('structured geometry diagnostics identify stable fields and measured ink collisions', () => {
  const ops = [
    add('alpha', token('ALPHA'), { region: 'left' }, 'b0'),
    add('beta', token('BETA'), { region: 'right' }, 'b0'),
  ];
  const states = statesOf(ops, () => 'b0');
  const geometry = layoutScene(states);
  const left = geometry.rectFor(states[0]!, 'alpha')!;
  const colliding = { ...geometry,
    rectFor: (_state: BoardState, _id: string) => ({ ...left }),
    allRects: () => [{ id: 'alpha', rect: left }, { id: 'beta', rect: left }],
  } as typeof geometry;
  const diagnostics = diagnoseSceneGeometry(colliding, states);
  const overlap = diagnostics.find((diagnostic) => diagnostic.code === 'top_level_overlap');
  const textCollision = diagnostics.find((diagnostic) => diagnostic.code === 'text_collision');
  assert.deepEqual(overlap?.elementIds, ['alpha', 'beta']);
  assert.deepEqual(overlap?.fields, ['/elements/alpha/placement', '/elements/beta/placement']);
  assert.deepEqual(textCollision?.elementIds, ['alpha', 'beta']);
  assert.ok(textCollision?.fields.every((field) => field.startsWith('/elements/')));
});

test('transformed element geometry is checked at its rendered scale', () => {
  const ops: BoardOp[] = [
    add('a', token('A'), { region: 'left' }, 'b0'),
    BoardOpSchema.parse({ op: 'transform', opId: 'b1.scale', beatId: 'b1', target: 'a', changes: [{ key: 'scale', value: 0.1 }] }),
  ];
  const states = statesOf(ops);
  const geometry = layoutScene(states);
  assert.ok(diagnoseSceneGeometry(geometry, states).some((diagnostic) => diagnostic.code === 'element_too_small' && diagnostic.elementIds.includes('a')));
});

test('edge labels colliding with unrelated geometry are reported with the edge label pointer', () => {
  const ops: BoardOp[] = [
    add('a', token('A'), { region: 'left' }, 'b0'),
    add('middle', token('MIDDLE'), { region: 'center' }, 'b0'),
    add('b', token('B'), { region: 'right' }, 'b0'),
    BoardOpSchema.parse({ op: 'connect', opId: 'b1.edge', beatId: 'b1', id: 'edge', from: 'a', to: 'b', relation: 'causes', label: 'causes' }),
  ];
  const states = statesOf(ops);
  const geometry = layoutScene(states);
  const rect = geometry.rectFor(states.at(-1)!, 'a')!;
  const collapsed = { ...geometry, rectFor: () => ({ ...rect }), edgeRouteFor: (_state: BoardState, id: string) => routeEdge(id, rect, rect, 'causes') } as unknown as typeof geometry;
  const diagnostic = diagnoseSceneGeometry(collapsed, states).find((item) => item.code === 'edge_label_collision' && item.edgeId === 'edge' && item.fields.includes('/edges/edge/label'));
  assert.ok(diagnostic, 'the arrow label overlaps unrelated element geometry');
  assert.ok(diagnostic.fields.includes('/edges/edge/label'));
});

test('edge routes pin the exact shaft, label ink, and arrowhead across repeated layouts', () => {
  const ops: BoardOp[] = [
    add('a', token('A'), { region: 'left' }, 'b0'),
    add('b', token('B'), { region: 'right' }, 'b0'),
    BoardOpSchema.parse({ op: 'connect', opId: 'b1.edge', beatId: 'b1', id: 'edge', from: 'a', to: 'b', relation: 'causes', label: 'causes' }),
  ];
  const states = statesOf(ops);
  const route = layoutScene(states).edgeRouteFor(states.at(-1)!, 'edge');
  assert.ok(route);
  assert.deepEqual(route, layoutScene(states).edgeRouteFor(states.at(-1)!, 'edge'));
  assert.equal(route.arrowhead[1].x, route.points[1].x);
  assert.equal(route.arrowhead[1].y, route.points[1].y);
  assert.ok(route.label && route.label.bounds.w > 0 && route.label.bounds.h > 0);
  assert.ok(contains(route.arrowheadBounds, { x: route.points[1].x, y: route.points[1].y, w: 0, h: 0 }));
  assert.equal(layoutScene(states).edgeRouteFor(states[0]!, 'edge'), undefined);
});

test('a shaft detours around unrelated text with a deterministic pinned curve', async () => {
  const ops: BoardOp[] = [
    add('a', token('A'), { region: 'left' }, 'b0'),
    add('word', token('MIDDLE'), { region: 'center' }, 'b0'),
    add('b', token('B'), { region: 'right' }, 'b0'),
    BoardOpSchema.parse({ op: 'connect', opId: 'b1.edge', beatId: 'b1', id: 'edge', from: 'a', to: 'b', relation: 'causes' }),
  ];
  const states = statesOf(ops);
  const geometry = layoutScene(states);
  const route = geometry.edgeRouteFor(states.at(-1)!, 'edge');
  assert.ok(route?.controlPoint, 'the direct shaft crosses the center element, so a quadratic detour is pinned');
  assert.deepEqual(route, layoutScene(states).edgeRouteFor(states.at(-1)!, 'edge'));
  assert.equal(diagnoseSceneGeometry(geometry, states).some((d) => d.edgeId === 'edge' && ['edge_crossing', 'edge_text_collision'].includes(d.code)), false);
  const { edgeVisual } = await import('../visual-v2/renderer/visuals.js');
  const rendered = edgeVisual(states.at(-1)!.edges.edge!, geometry.rectFor(states.at(-1)!, 'a')!, geometry.rectFor(states.at(-1)!, 'b')!, route);
  assert.ok(rendered.paths[0]!.d.includes(' Q '), 'the exact control point is consumed by the renderer');
});

test('compound graph places nested groups by their links and keeps child identities fixed', () => {
  const ops: BoardOp[] = [
    add('outer', kit('graph', '{"nodes":2,"layout":"compound"}'), { region: 'center' }, 'b0'),
    add('group', kit('graph', '{"nodes":2,"layout":"compound"}'), { region: 'center', container: 'outer', slot: 'end' }, 'b0'),
    add('peer', token('peer'), { region: 'center', container: 'outer', slot: 'end' }, 'b0'),
    add('inside', token('inside'), { region: 'center', container: 'group', slot: 'end' }, 'b1'),
    add('other', token('other'), { region: 'center', container: 'group', slot: 'end' }, 'b1'),
    BoardOpSchema.parse({ op: 'connect', opId: 'b2.link', beatId: 'b2', id: 'link', from: 'inside', to: 'peer', relation: 'causes' }),
  ];
  const states = statesOf(ops);
  const geometry = layoutScene(states);
  const final = states.at(-1)!;
  const group = geometry.rectFor(final, 'group')!;
  const peer = geometry.rectFor(final, 'peer')!;
  assert.ok(group.x < peer.x, 'descendant link promotes its containing group to the source rank');
  assert.ok(contains(group, geometry.rectFor(final, 'inside')!));
  assert.ok(contains(group, geometry.rectFor(final, 'other')!));
  assert.deepEqual(geometry.rectFor(states[0]!, 'group'), group);
  assert.deepEqual(geometry.rectFor(states[0]!, 'peer'), peer);
  assert.deepEqual(geometry.rectFor(final, 'group'), layoutScene(states).rectFor(final, 'group'));
  assert.deepEqual(validateSceneGeometry(geometry, states), []);
});

test('the pinned arrowhead and its own label cannot occupy the same ink', () => {
  const ops: BoardOp[] = [
    add('a', token('A'), { region: 'left' }, 'b0'), add('b', token('B'), { region: 'right' }, 'b0'),
    BoardOpSchema.parse({ op: 'connect', opId: 'b1.edge', beatId: 'b1', id: 'edge', from: 'a', to: 'b', relation: 'causes', label: 'a long explanation' }),
  ];
  const states = statesOf(ops);
  const geometry = layoutScene(states);
  const original = geometry.edgeRouteFor;
  const crowded = { ...geometry, edgeRouteFor: (state: BoardState, id: string) => {
    const route = original(state, id);
    return route?.label ? { ...route, label: { ...route.label, bounds: route.arrowheadBounds } } : route;
  } };
  assert.ok(diagnoseSceneGeometry(crowded, states).some((d) => d.code === 'edge_label_collision' && d.edgeId === 'edge' && d.elementIds.length === 0));
});

test('independent exact edge routes are checked for crossings and arrowhead/label collisions', () => {
  const ops: BoardOp[] = [
    add('a', token('A'), { region: 'left' }, 'b0'), add('b', token('B'), { region: 'right' }, 'b0'),
    add('c', token('C'), { region: 'left' }, 'b0'), add('d', token('D'), { region: 'right' }, 'b0'),
    BoardOpSchema.parse({ op: 'connect', opId: 'b1.e1', beatId: 'b1', id: 'e1', from: 'a', to: 'b', relation: 'causes', label: 'first' }),
    BoardOpSchema.parse({ op: 'connect', opId: 'b1.e2', beatId: 'b1', id: 'e2', from: 'c', to: 'd', relation: 'causes' }),
  ];
  const states = statesOf(ops); const base = layoutScene(states);
  const custom = { ...base, edgeRouteFor: (_state: BoardState, id: string) => id === 'e1'
    ? { id, points: [{ x: 0, y: 50 }, { x: 100, y: 50 }], arrowhead: [{ x: 90, y: 45 }, { x: 100, y: 50 }, { x: 90, y: 55 }], arrowheadBounds: { x: 88, y: 43, w: 16, h: 14 }, label: { x: 50, y: 20, text: 'first', size: 32, bounds: { x: 40, y: 10, w: 20, h: 20 } } }
    : { id, points: [{ x: 50, y: 0 }, { x: 50, y: 100 }], arrowhead: [{ x: 45, y: 90 }, { x: 50, y: 100 }, { x: 55, y: 90 }], arrowheadBounds: { x: 43, y: 88, w: 14, h: 16 } } } as typeof base;
  const diagnostics = diagnoseSceneGeometry(custom, states);
  assert.ok(diagnostics.some((d) => d.code === 'edge_crossing' && d.fields.includes('/edges/e1/from') && d.fields.includes('/edges/e2/from')));
  assert.ok(diagnostics.some((d) => d.code === 'edge_label_collision' && d.fields.includes('/edges/e1/label') && d.fields.includes('/edges/e2/from')));
});

test('scaled kit text below 32px is rejected and moving objects are checked between endpoints', () => {
  const kitStates = statesOf([
    add('box', kit('queue', '{"capacity":2}', 'queue'), { region: 'center' }, 'b0'),
    BoardOpSchema.parse({ op: 'transform', opId: 'b1.shrink', beatId: 'b1', target: 'box', changes: [{ key: 'scale', value: 0.5 }] }),
  ]);
  assert.ok(diagnoseSceneGeometry(layoutScene(kitStates), kitStates).some((d) => d.code === 'element_too_small' && d.fields.includes('/elements/box/props.scale')));

  const moveStates = statesOf([
    add('source', kit('queue', '{"capacity":2}'), { region: 'left' }, 'b0'),
    add('dest', kit('queue', '{"capacity":2}'), { region: 'right' }, 'b0'),
    add('obstacle', token('obstacle'), { region: 'center' }, 'b0'),
    add('traveler', token('traveler'), { region: 'left', container: 'source', slot: 'end' }, 'b0'),
    BoardOpSchema.parse({ op: 'move', opId: 'b1.move', beatId: 'b1', target: 'traveler', to: { region: 'right', container: 'dest', slot: 'end' } }),
  ]);
  assert.ok(diagnoseSceneGeometry(layoutScene(moveStates), moveStates).some((d) => d.code === 'movement_path_collision' && d.stateIndex === 1 && d.elementIds.includes('traveler') && d.elementIds.includes('obstacle')));
});

const routeOf = (id: string, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = (da: number) => ({ x: b.x - 22 * Math.cos(angle + da), y: b.y - 22 * Math.sin(angle + da) });
  const arrowhead: [typeof a, typeof a, typeof a] = [head(0.5), b, head(-0.5)];
  const xs = arrowhead.map((p) => p.x); const ys = arrowhead.map((p) => p.y);
  return { id, points: [a, b] as [typeof a, typeof a], arrowhead, arrowheadBounds: { x: Math.min(...xs) - 4, y: Math.min(...ys) - 4, w: Math.max(...xs) - Math.min(...xs) + 8, h: Math.max(...ys) - Math.min(...ys) + 8 } };
};
const withRoutes = (base: ReturnType<typeof layoutScene>, routes: Record<string, ReturnType<typeof routeOf>>) => ({ ...base, edgeRouteFor: (_state: BoardState, id: string) => routes[id] }) as typeof base;
const connect = (id: string, from: string, to: string, beat = 'b1') => BoardOpSchema.parse({ op: 'connect', opId: `${beat}.${id}`, beatId: beat, id, from, to, relation: 'causes' });

test('P9: two arrows that never touch but run almost on top of each other are reported as a clearance defect', () => {
  const ops: BoardOp[] = [
    add('a', token('A'), { region: 'left' }, 'b0'), add('b', token('B'), { region: 'right' }, 'b0'),
    add('c', token('C'), { region: 'left' }, 'b0'), add('d', token('D'), { region: 'right' }, 'b0'),
    connect('e1', 'a', 'b'), connect('e2', 'c', 'd'),
  ];
  const states = statesOf(ops); const base = layoutScene(states);
  const near = diagnoseSceneGeometry(withRoutes(base, { e1: routeOf('e1', { x: 0, y: 50 }, { x: 300, y: 50 }), e2: routeOf('e2', { x: 0, y: 70 }, { x: 200, y: 70 }) }), states);
  assert.ok(near.some((d) => d.code === 'edge_clearance' && d.fields.includes('/edges/e1/from') && d.fields.includes('/edges/e2/from')), JSON.stringify(near.map((d) => d.code)));
  const apart = diagnoseSceneGeometry(withRoutes(base, { e1: routeOf('e1', { x: 0, y: 50 }, { x: 300, y: 50 }), e2: routeOf('e2', { x: 0, y: 150 }, { x: 300, y: 150 }) }), states);
  assert.equal(apart.some((d) => d.code === 'edge_clearance'), false);
});

test('P9: arrows that share an endpoint must leave it in clearly different directions', () => {
  const ops: BoardOp[] = [
    add('a', token('A'), { region: 'left' }, 'b0'), add('b', token('B'), { region: 'right' }, 'b0'), add('c', token('C'), { region: 'right' }, 'b0'),
    connect('e1', 'a', 'b'), connect('e2', 'a', 'c'),
  ];
  const states = statesOf(ops); const base = layoutScene(states);
  const stacked = diagnoseSceneGeometry(withRoutes(base, { e1: routeOf('e1', { x: 0, y: 50 }, { x: 300, y: 50 }), e2: routeOf('e2', { x: 0, y: 50 }, { x: 300, y: 62 }) }), states);
  assert.ok(stacked.some((d) => d.code === 'edge_overlap'), JSON.stringify(stacked.map((d) => d.code)));
  const fanned = diagnoseSceneGeometry(withRoutes(base, { e1: routeOf('e1', { x: 0, y: 50 }, { x: 300, y: 0 }), e2: routeOf('e2', { x: 0, y: 50 }, { x: 300, y: 200 }) }), states);
  assert.equal(fanned.some((d) => d.code === 'edge_overlap'), false);
});

test('P9: a pair of arrows drawn back to back between the same two elements is one line, and is reported', () => {
  const states = statesOf([add('a', token('A'), { region: 'left' }, 'b0'), add('b', token('B'), { region: 'right' }, 'b0'), connect('e1', 'a', 'b'), connect('e2', 'b', 'a')]);
  const base = layoutScene(states);
  const reversed = diagnoseSceneGeometry(withRoutes(base, { e1: routeOf('e1', { x: 0, y: 50 }, { x: 300, y: 50 }), e2: routeOf('e2', { x: 300, y: 54 }, { x: 0, y: 54 }) }), states);
  assert.ok(reversed.some((d) => d.code === 'edge_overlap'), JSON.stringify(reversed.map((d) => d.code)));
  const apart = diagnoseSceneGeometry(withRoutes(base, { e1: routeOf('e1', { x: 0, y: 50 }, { x: 300, y: 50 }), e2: routeOf('e2', { x: 300, y: 150 }, { x: 0, y: 150 }) }), states);
  assert.equal(apart.some((d) => d.code === 'edge_overlap'), false);
});

test('P9: ink inside a kit frame is checked, not only text: a kit line through text, or a child label across a kit line, is a collision', () => {
  const states = statesOf([add('box', kit('compartment', JSON.stringify({ zones: ['left', 'right'], boundary: 'solid' }), 'cell'), { region: 'center' }, 'b0')]);
  const base = layoutScene(states);
  assert.equal(diagnoseSceneGeometry(base, states).some((d) => d.code === 'kit_ink_collision'), false, 'a stock kit does not collide with its own ink');
  const home = base.kitRect('box')!; const geometry = base.kitGeometry('box')!;
  const struck = { ...base, kitGeometry: (id: string) => id === 'box' ? { ...geometry, frame: { ...geometry.frame, paths: [...geometry.frame.paths, { d: `M${home.x} ${home.y + 28}L${home.x + home.w} ${home.y + 28}`, length: home.w, width: 5 }] } } : base.kitGeometry(id) } as typeof base;
  const found = diagnoseSceneGeometry(struck, states).find((d) => d.code === 'kit_ink_collision');
  assert.ok(found, 'a stroke through the kit title is reported');
  assert.deepEqual(found!.elementIds, ['box']);
  assert.ok(found!.fields.some((f) => f.includes('box')));
});

test('P9: a kit line through a child element\'s label is a kit_ink_collision on the child', () => {
  const states = statesOf([add('stack1', kit('stack', '{}', 'call stack'), { region: 'center' }, 'b0'), add('f1', token('f(1)'), { region: 'center', container: 'stack1', slot: 'top' }, 'b1')]);
  const base = layoutScene(states); const last = states.at(-1)!;
  assert.equal(diagnoseSceneGeometry(base, states).some((d) => d.code === 'kit_ink_collision'), false);
  const child = base.rectFor(last, 'f1')!; const geometry = base.kitGeometry('stack1')!;
  const struck = { ...base, kitGeometry: (id: string) => id === 'stack1' ? { ...geometry, frame: { ...geometry.frame, paths: [...geometry.frame.paths, { d: `M${child.x - 20} ${child.y + child.h / 2}L${child.x + child.w + 20} ${child.y + child.h / 2}`, length: child.w, width: 5 }] } } : base.kitGeometry(id) } as typeof base;
  const found = diagnoseSceneGeometry(struck, states).find((d) => d.code === 'kit_ink_collision');
  assert.ok(found, 'reported');
  assert.deepEqual(found!.elementIds, ['f1', 'stack1']);
});
