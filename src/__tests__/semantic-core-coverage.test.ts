import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSemanticRole, renderTopology, SEMANTIC_ROLES, SEMANTIC_TOPOLOGIES } from '../render/semanticCore.js';
import { resolveObject } from '../assets/ladder.js';
import type { CatalogEntry } from '../assets/catalog.js';

// final_plan/02 §5 (roles) and §6 (topologies), spelled as in the spec.
const SPEC_ROLES = [
  'source', 'sink', 'channel', 'path', 'pipeline', 'queue', 'buffer', 'container', 'accumulator',
  'filter', 'gate', 'transformation', 'merge', 'fork', 'router', 'selector', 'mixer', 'comparator',
  'boundary', 'threshold', 'limit', 'bottleneck', 'block', 'allow',
  'layer', 'stack', 'hierarchy', 'group', 'hub', 'bridge', 'link',
  'increase', 'decrease', 'success', 'failure', 'uncertain', 'active', 'inactive', 'before', 'after',
  'evidence', 'claim', 'question', 'contradiction', 'exception', 'prerequisite', 'dependency',
];
const SPEC_TOPOLOGIES = [
  'chain', 'fan_out', 'convergence', 'cycle', 'feedback', 'hub_spoke', 'comparison', 'before_after', 'bounded_flow',
  'bottleneck', 'threshold', 'routing', 'merge', 'accumulation', 'tree', 'input_process_output', 'decision_tree',
  'timeline', 'claim_evidence', 'rule_exception', 'state_machine',
];
// Spec singular/plural spellings the core draws under its own name.
const ROLE_ALIAS: Record<string, string> = { layer: 'layers' };

test('every spec semantic role renders non-empty geometry inside its box', () => {
  for (const role of SPEC_ROLES) {
    const name = ROLE_ALIAS[role] ?? role;
    assert.ok((SEMANTIC_ROLES as readonly string[]).includes(name), `role ${role} missing from SEMANTIC_ROLES`);
    const drawn = renderSemanticRole(name, 200);
    assert.ok(drawn && drawn.paths.length > 0, `role ${role} draws nothing`);
    for (const path of drawn.paths) for (const n of path.d.match(/-?\d+(\.\d+)?/g) ?? []) assert.ok(Number(n) >= -1 && Number(n) <= 201, `${role} leaves its box (${n})`);
  }
});

test('every spec topology renders non-empty geometry inside its box', () => {
  for (const topology of SPEC_TOPOLOGIES) {
    assert.ok((SEMANTIC_TOPOLOGIES as readonly string[]).includes(topology), `topology ${topology} missing`);
    const drawn = renderTopology(topology, 400, 240);
    assert.ok(drawn && drawn.paths.length > 0, `topology ${topology} draws nothing`);
  }
});

test('rendering is deterministic', () => {
  for (const role of SEMANTIC_ROLES) assert.deepEqual(renderSemanticRole(role, 120), renderSemanticRole(role, 120));
  for (const topology of SEMANTIC_TOPOLOGIES) assert.deepEqual(renderTopology(topology, 300, 200), renderTopology(topology, 300, 200));
});

const literal = (id: string, name: string): CatalogEntry => ({ id, names: [name], tags: [], meaning: '', source: 'assetlab-sketchy-downshift:x', license: 'manual', lane: 'simple-symbol', strokePaths: 1, render: () => ({ paths: [], fills: [], texts: [] }) });

test('a role requested for a noun that has a real icon is upgraded to the literal; a real role name stays a role', () => {
  const items = [literal('syringe-icon', 'syringe')];
  const upgraded = resolveObject('syringe', { size: { w: 300, h: 300 }, visualStrategy: 'semantic-core', semanticRole: 'cost', label: 'Syringe' }, items);
  assert.equal(upgraded.resolution.assetId, 'syringe-icon');
  const role = resolveObject('filter', { size: { w: 300, h: 300 }, visualStrategy: 'semantic-core', semanticRole: 'filter', label: 'Filter' }, [literal('filter-icon', 'filter')]);
  assert.equal(role.resolution.strategy, 'R2-semantic-core');
});
