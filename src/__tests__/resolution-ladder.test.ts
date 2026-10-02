import { renderTopology } from '../render/semanticCore.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveObject, typeCompatible, APPROVED_METAPHORS, classifyDiagramAdapter } from '../assets/ladder.js';
import { allCatalogEntries } from '../assets/semantic.js';
import { loadBridge, setBridgeDataDir } from '../assets/bridge.js';
import type { CatalogEntry } from '../assets/catalog.js';

const SIZE = { w: 150, h: 220 };
const catalog = allCatalogEntries();
const catalogDir = resolve('src/assets');

function withCuratedTypes(run: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), 's7-bridge-'));
  try {
    const bridge = structuredClone(loadBridge());
    for (const concept of bridge.concepts) {
      if (concept.conceptId === 'abacus' || concept.conceptId === 'acceleration') concept.inferred = false;
    }
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'asset-bridge-v2.json'), JSON.stringify(bridge));
    setBridgeDataDir(dir);
    run();
  } finally {
    setBridgeDataDir(catalogDir);
    rmSync(dir, { recursive: true, force: true });
  }
}

const entry = (id: string, name: string, source = 'generated'): CatalogEntry => ({
  id, names: [name], tags: [], meaning: '', source, license: 'manual', lane: 'simple-symbol', strokePaths: 1,
  render: () => ({ paths: [{ d: 'M0 0 L10 10', length: 14 }], fills: [], texts: [] }),
});

test('R3: exact house literal resolves with strategy recorded', () => {
  const first = catalog.find((e) => e.names.includes('abacus')) ?? catalog[0];
  const out = resolveObject(first.names[0], { size: SIZE }, catalog);
  assert.equal(out.resolution.strategy, 'R3-house-literal');
  assert.equal(out.resolution.rung, 2);
  assert.equal(out.resolution.score, 1);
  assert.ok(out.resolution.bridgeVersion === loadBridge().catalogVersion);
  assert.ok(out.visual.paths.length > 0 || out.visual.fills.length > 0);
});

test('R2: explicit semantic role draws the core primitive', () => {
  const out = resolveObject('filtering information', {
    size: SIZE, semanticRole: 'filter', visualStrategy: 'semantic-core', label: 'filtering information',
  }, catalog);
  assert.equal(out.resolution.strategy, 'R2-semantic-core');
  assert.equal(out.resolution.rung, 2);
  assert.equal(out.resolution.assetId, 'core:filter');
  assert.equal(out.resolution.semanticRole, 'filter');
  assert.ok(out.visual.paths.length > 0);
  // Label below aids muted-board comprehension.
  assert.ok(out.visual.texts.some((t) => t.text.includes('FILTERING')));
});

test('R1: a structural diagram recipe compiles to a labelled topology drawing without inventing content', () => {
  const out = resolveObject('neural network propagation', { size: SIZE, conceptId: 'neural-network', label: 'Neural network' }, catalog);
  assert.equal(out.resolution.strategy, 'R1-diagram');
  assert.equal(out.resolution.assetId, 'diagram:diagram:neural-network:network-graph');
  assert.equal(out.resolution.diagramRef, 'diagram:neural-network:network-graph');
  assert.ok(out.visual.paths.length > 0);
  assert.ok(out.visual.texts.some((t) => t.text.includes('NEURAL')), 'label below the diagram');
  assert.equal(out.resolution.diagramRejection, undefined);
});

test('R1: explicit diagram strategy on a recipe that needs an exact renderer records a reason code and falls back truthfully', () => {
  const plot = loadBridge().diagrams.find((diagram) => diagram.topology === 'plot')!;
  const out = resolveObject('a curve', { size: SIZE, conceptId: plot.conceptId, visualStrategy: 'diagram', label: 'Curve' }, catalog);
  assert.notEqual(out.resolution.strategy, 'R1-diagram');
  assert.equal(out.resolution.diagramRejection?.reasonCode, 'USE_EXACT_RENDERER');
});

test('every bridge diagram recipe is either compiled or explicitly rejected with a reason code', () => {
  const bridge = loadBridge();
  const decisions = bridge.diagrams.map((diagram) => ({ diagram, decision: classifyDiagramAdapter(diagram) }));
  assert.equal(decisions.length, bridge.counts.diagrams);
  const compiled = decisions.filter(({ decision }) => decision.status === 'compiled');
  assert.ok(compiled.length >= 45, `compiled ${compiled.length}`);
  for (const { diagram, decision } of decisions) {
    if (decision.status === 'compiled') assert.ok(renderTopology(decision.topology, 200, 200)?.paths.length, diagram.ref);
    else {
      assert.ok(['USE_EXACT_RENDERER', 'UNSUPPORTED_TOPOLOGY'].includes(decision.reasonCode), diagram.ref);
      assert.ok(decision.reason.includes(diagram.topology), diagram.ref);
    }
  }
  assert.deepEqual([...new Set(decisions.filter(({ decision }) => decision.status === 'rejected').map(({ diagram }) => diagram.topology))].sort(), ['annotated-scene', 'chart', 'molecule-graph', 'plot']);
});

test('R9: explicit topology strategy draws the board grammar', () => {
  const out = resolveObject('something unresolvable xyz', {
    size: SIZE, visualStrategy: 'topology', template: 'fan_out', label: 'xyz',
  }, catalog);
  assert.equal(out.resolution.strategy, 'R9-state-topology');
  assert.equal(out.resolution.rung, 2, 'confident procedural drawing is rung 2, never a weak match');
  assert.equal(out.resolution.assetId, 'topo:fan_out');
  assert.ok(out.visual.paths.length > 0);
});

test('R0: valid pin reuses the validated representation', () => {
  const first = resolveObject('abacus', { size: SIZE }, catalog);
  const pinned = resolveObject('abacus', {
    size: SIZE, pin: { assetId: first.resolution.assetId!, rung: 2, score: 1 },
  }, catalog);
  assert.equal(pinned.resolution.strategy, 'R0-verified-pin');
  assert.equal(pinned.resolution.assetId, first.resolution.assetId);
});

test('R0: matching synthetic core pins re-render deterministically', () => {
  const out = resolveObject('filtering', {
    size: SIZE, label: 'filtering', semanticRole: 'filter', pin: { assetId: 'core:filter', rung: 2, score: 0.9 },
  }, catalog);
  assert.equal(out.resolution.strategy, 'R0-verified-pin');
  assert.equal(out.resolution.assetId, 'core:filter');
});

test('R0: a diagram ref pin is reused only for the same concept and never for another', () => {
  const ref = loadBridge().diagrams.find((diagram) => diagram.conceptId === 'neural-network')?.ref;
  assert.ok(ref, 'fixture has a neural-network diagram spec');
  const pin = { assetId: `diagram:${ref}`, rung: 2 as const, score: 0.9 };
  const other = resolveObject('abacus', { size: SIZE, conceptId: 'abacus', pin }, catalog);
  assert.notEqual(other.resolution.strategy, 'R0-verified-pin');
  assert.notEqual(other.resolution.assetId, pin.assetId);
});

test('R0: stale pins are ignored, never trusted', () => {
  const out = resolveObject('abacus', {
    size: SIZE, pin: { assetId: 'retired:icon:gone', rung: 2, score: 1 },
  }, catalog);
  assert.notEqual(out.resolution.strategy, 'R0-verified-pin', 'stale pin must not pin');
  assert.notEqual(out.resolution.assetId, 'retired:icon:gone');
});

test('uncurated embedding candidates fail closed even at high similarity', () => {
  const target = catalog[3];
  const out = resolveObject('unrelated concept xyz', {
    size: SIZE, candidates: [{ id: target.id, name: target.names[0] ?? target.id, score: 0.75 }],
  }, catalog);
  assert.equal(out.resolution.strategy, 'R10-labelled-primitive');
  assert.equal(out.resolution.assetId, null);
});

test('similarity type gate rejects missing and inferred request or asset types', () => {
  const physical = catalog.find((e) => e.names.includes('abacus')) ?? catalog[0];
  assert.equal(typeCompatible('process', physical), false);
  assert.equal(typeCompatible('physical-object', physical), false, 'asset type is inferred');
  assert.equal(typeCompatible(undefined, physical), false);
  assert.equal(typeCompatible('physical-object', physical, true), false);
});

test('curated same-type retrieval uses R6; missing or mismatched types fall to R10', () => {
  withCuratedTypes(() => {
    const items = [entry('a', 'abacus', 'streamline:color'), entry('b', 'acceleration', 'streamline:color')];
    const request = { size: SIZE, conceptId: 'abacus', candidates: [{ id: 'a', name: 'abacus', score: 0.93 }] };
    const compatible = resolveObject('unseen referent', request, items);
    assert.equal(compatible.resolution.strategy, 'R6-typed-streamline');
    assert.equal(compatible.resolution.assetId, 'a');
    assert.equal(typeCompatible('entity', items[0]!), true);
    assert.equal(typeCompatible('abstract', items[0]!), false);

    const mismatch = resolveObject('unseen referent', {
      ...request, candidates: [{ id: 'b', name: 'acceleration', score: 0.99 }],
    }, items);
    assert.equal(mismatch.resolution.strategy, 'R10-labelled-primitive');
    assert.equal(mismatch.resolution.assetId, null);

    const missing = resolveObject('unseen referent', { ...request, conceptId: undefined }, items);
    assert.equal(missing.resolution.strategy, 'R10-labelled-primitive');
  });
});

test('ambiguous exact referents and incompatible pins are rejected', () => {
  const apple = entry('apple-icon', 'apple');
  const ambiguous = resolveObject('apple', { size: SIZE, pin: { assetId: apple.id, rung: 2, score: 1 } }, [apple]);
  assert.equal(ambiguous.resolution.strategy, 'R10-labelled-primitive');
  assert.equal(ambiguous.resolution.assetId, null);
  const wrongRole = resolveObject('routing', {
    size: SIZE, semanticRole: 'router', pin: { assetId: 'core:filter', rung: 2, score: 0.9 },
  }, []);
  assert.notEqual(wrongRole.resolution.strategy, 'R0-verified-pin');
  assert.notEqual(wrongRole.resolution.assetId, 'core:filter');
});

test('an inferred asset type cannot satisfy a curated request or pin', () => {
  withCuratedTypes(() => {
    // 'access-control' remains an inferred (uncurated) concept in the bridge; asset-backed literals are curated since bridge-v2 types them on approval.
    const robot = entry('robot-icon', 'access-control');
    const request = { size: SIZE, conceptId: 'abacus', candidates: [{ id: robot.id, name: 'access-control', score: 0.99 }] };
    assert.equal(resolveObject('unseen referent', request, [robot]).resolution.assetId, null);
    assert.equal(resolveObject('unseen referent', {
      ...request, pin: { assetId: robot.id, rung: 2 as const, score: 0.99 },
    }, [robot]).resolution.assetId, null);
  });
});

test('R5: approved metaphors state their structure and reconnect term and resolve by geometry', () => {
  assert.ok(Object.keys(APPROVED_METAPHORS).length >= 40);
  for (const metaphor of Object.values(APPROVED_METAPHORS)) {
    assert.ok(metaphor.structure.length >= 12 && metaphor.reconnectTerm, metaphor.concept);
  }
  const role = resolveObject('the bottleneck', { size: SIZE, visualStrategy: 'metaphor', label: 'Bottleneck' }, catalog);
  assert.equal(role.resolution.strategy, 'R5-approved-metaphor');
  assert.equal(role.resolution.assetId, 'topo:bottleneck');
  assert.equal(role.resolution.reconnectTerm, 'bottleneck');
  const glyph = resolveObject('regularization', { size: SIZE, visualStrategy: 'metaphor', label: 'Regularization' }, catalog);
  assert.equal(glyph.resolution.strategy, 'R5-approved-metaphor');
  assert.equal(glyph.resolution.assetId, 'core:limit');
  const none = resolveObject('filtering information xyz', { size: SIZE, visualStrategy: 'metaphor' }, catalog);
  assert.notEqual(none.resolution.strategy, 'R5-approved-metaphor');
});

test('explicit S6 representation strategy constrains S7 asset resolution', () => {
  const exactHouse = catalog.find((entry) => entry.names.includes('abacus'))!;
  const literal = resolveObject('abacus', { size: SIZE, visualStrategy: 'literal' }, catalog);
  assert.equal(literal.resolution.strategy, 'R3-house-literal');
  const uncuratedMetaphor = resolveObject('abacus', { size: SIZE, visualStrategy: 'metaphor', label: 'Abacus' }, catalog);
  assert.equal(uncuratedMetaphor.resolution.strategy, 'R10-labelled-primitive');
  assert.equal(uncuratedMetaphor.resolution.assetId, null);
  const topology = resolveObject('abacus', {
    size: SIZE, visualStrategy: 'topology', semanticRole: 'chain', label: 'Abacus',
    pin: { assetId: exactHouse.id, rung: 2, score: 1, requestedStrategy: 'literal' },
  }, catalog);
  assert.equal(topology.resolution.strategy, 'R9-state-topology', 'a literal pin from a different representation intent cannot override topology');
  assert.equal(topology.resolution.assetId, 'topo:chain');
});

test('R10 labelled fallback draws a box; R11 and explicit text are text-only', () => {
  const out = resolveObject('zzz unresolvable qqq', { size: SIZE }, catalog);
  assert.equal(out.resolution.strategy, 'R10-labelled-primitive');
  assert.equal(out.resolution.rung, 4);
  assert.equal(out.resolution.assetId, null);
  assert.ok(out.visual.paths.length > 0);
  assert.ok(out.visual.fills.length > 0);

  const fallbackText = resolveObject('zzz unresolvable qqq', { size: SIZE, label: '', visualStrategy: 'retrieval' }, []);
  assert.equal(fallbackText.resolution.strategy, 'R11-minimal-text');
  assert.equal(fallbackText.visual.paths.length, 0);
  assert.equal(fallbackText.visual.fills.length, 0);
  assert.ok(fallbackText.visual.texts.length > 0);

  // Explicit R11 must not opportunistically select the exact house icon.
  const explicitText = resolveObject('abacus', { size: SIZE, visualStrategy: 'text' }, catalog);
  assert.equal(explicitText.resolution.strategy, 'R11-minimal-text');
  assert.equal(explicitText.resolution.assetId, null);
  assert.equal(explicitText.visual.paths.length, 0);
  assert.equal(explicitText.visual.fills.length, 0);
  assert.ok(explicitText.visual.texts.length > 0);

  for (const visualStrategy of ['literal', 'diagram'] as const) {
    const unavailable = resolveObject('unavailable mechanism', { size: SIZE, visualStrategy }, []);
    assert.equal(unavailable.resolution.strategy, 'R10-labelled-primitive', `${visualStrategy} falls through R10 before R11`);
    assert.ok(unavailable.visual.paths.length > 0);
    assert.ok(unavailable.visual.fills.length > 0);
  }
});

test('ladder is deterministic end to end', () => {
  const opts = { size: SIZE, semanticRole: 'bottleneck', label: 'narrowing' } as const;
  const a = JSON.stringify(resolveObject('narrowing flow', { ...opts }));
  const b = JSON.stringify(resolveObject('narrowing flow', { ...opts }));
  assert.equal(a, b);
});
