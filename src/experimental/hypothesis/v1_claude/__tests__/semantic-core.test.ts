import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEMANTIC_ROLES, SEMANTIC_TOPOLOGIES, renderSemanticRole, renderTopology,
  isSemanticRole, isSemanticTopology,
} from '../render/semanticCore.js';

const nonEmpty = (v: { paths: unknown[]; fills: unknown[]; texts: unknown[] }): boolean =>
  v.paths.length > 0 || v.fills.length > 0 || v.texts.length > 0;

test('every semantic role renders a non-empty visual', () => {
  assert.ok(SEMANTIC_ROLES.length >= 30, `expected 30+ roles, got ${SEMANTIC_ROLES.length}`);
  for (const role of SEMANTIC_ROLES) {
    const visual = renderSemanticRole(role, 150);
    assert.ok(visual && nonEmpty(visual), `role ${role} renders nothing`);
    for (const path of visual.paths) {
      assert.ok(path.d.length > 0, `role ${role} has an empty path`);
      assert.ok(Number.isFinite(path.length) && path.length >= 0, `role ${role} has bad length`);
    }
  }
});

test('every topology renders a non-empty visual', () => {
  assert.ok(SEMANTIC_TOPOLOGIES.length >= 8);
  for (const topology of SEMANTIC_TOPOLOGIES) {
    const visual = renderTopology(topology, 300, 200);
    assert.ok(visual && nonEmpty(visual), `topology ${topology} renders nothing`);
  }
});

test('role rendering is deterministic and scales', () => {
  const a = JSON.stringify(renderSemanticRole('filter', 150));
  const b = JSON.stringify(renderSemanticRole('filter', 150));
  assert.equal(a, b, 'same role+side must be byte-identical');
  const small = renderSemanticRole('loop', 50)!;
  const large = renderSemanticRole('loop', 200)!;
  assert.notEqual(JSON.stringify(small), JSON.stringify(large), 'size must affect geometry');
  assert.ok(nonEmpty(small) && nonEmpty(large));
});

test('topology rendering is deterministic', () => {
  assert.equal(JSON.stringify(renderTopology('chain', 300, 200)), JSON.stringify(renderTopology('chain', 300, 200)));
});

test('unknown roles and topologies fall through', () => {
  assert.equal(renderSemanticRole('not-a-role-xyz', 150), undefined);
  assert.equal(renderTopology('not-a-topology-xyz', 300, 200), undefined);
  assert.equal(isSemanticRole('filter'), true);
  assert.equal(isSemanticRole('nope'), false);
  assert.equal(isSemanticTopology('chain'), true);
  assert.equal(isSemanticTopology('nope'), false);
});
