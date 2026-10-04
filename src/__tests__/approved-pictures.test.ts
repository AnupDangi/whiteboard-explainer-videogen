import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { approvedResolver, pickFor, upgradeTokensToEntities, type ApprovedPick } from '../visual-v2/resolver/approved.js';
import { depictEntity } from '../visual-v2/resolver/typeGate.js';
import type { ConceptInfo } from '../visual-v2/resolver/typeGate.js';
import type { BoardOp } from '../visual-v2/board-ops/types.js';

/** Approved-picture resolver: validated picks draw pictures, everything else falls back. */

const AGENT_ENTRY = 'bridge-iconify:agent-iconify-iconmind-agent-duotone-bold';
const picks = new Map<string, ApprovedPick>([
  ['agent', { entryId: AGENT_ENTRY, noun: 'agent', referent: 'agent', conceptId: 'agent' }],
]);
const concepts = new Map<string, ConceptInfo>([['agent', { id: 'agent', label: 'Agent', kind: 'entity' }]]);

describe('approved picks', () => {
  it('finds picks by concept id first, then by label', () => {
    assert.equal(pickFor('agent', 'Something else', picks)?.entryId, AGENT_ENTRY);
    assert.equal(pickFor(undefined, 'Agent', picks)?.entryId, AGENT_ENTRY);
    assert.equal(pickFor(undefined, 'Unrelated', picks), undefined);
    assert.equal(pickFor('other', 'Unrelated', picks), undefined);
  });

  it('an approved referent depicts meaningfully; unknown referents fall back to labelled', () => {
    const resolve = approvedResolver(picks);
    const good = depictEntity({ id: 'agent', label: 'Agent', kind: 'entity' }, 'Agent', { x: 0, y: 0, w: 240, h: 210 }, resolve);
    assert.equal(good.meaningful, true);
    assert.equal(good.assetId, AGENT_ENTRY);
    const bad = depictEntity({ id: 'xyz', label: 'Xyz', kind: 'entity' }, 'Xyz', { x: 0, y: 0, w: 240, h: 210 }, resolve);
    assert.equal(bad.meaningful, false);
  });

  it('a validated pick wins even without an exact literal in the catalog', () => {
    const forced = new Map<string, ApprovedPick>([
      ['xyz', { entryId: AGENT_ENTRY, noun: 'agent', referent: 'xyz', conceptId: 'xyz' }],
    ]);
    const resolve = approvedResolver(forced);
    const got = depictEntity({ id: 'xyz', label: 'Xyz', kind: 'entity' }, 'Xyz', { x: 0, y: 0, w: 240, h: 210 }, resolve);
    assert.equal(got.meaningful, true);
    assert.equal(got.assetId, AGENT_ENTRY);
  });

  it('an empty pick set behaves exactly like the default path', () => {
    const resolve = approvedResolver(new Map());
    for (const [id, label] of [['agent', 'Agent'], ['xyz', 'Xyz']] as const) {
      const expected = depictEntity({ id, label, kind: 'entity' }, label, { x: 0, y: 0, w: 240, h: 210 });
      const actual = depictEntity({ id, label, kind: 'entity' }, label, { x: 0, y: 0, w: 240, h: 210 }, resolve);
      assert.equal(actual.meaningful, expected.meaningful);
      assert.equal(actual.assetId, expected.assetId);
    }
  });
});

describe('token to entity upgrade', () => {
  const token = (id: string, text: string, conceptId: string): BoardOp => ({
    op: 'add' as const, opId: `${id}-op`, beatId: 's.b1', id, cue: 0,
    element: { type: 'token' as const, text, provenance: 'illustrative' as const, bindings: { conceptIds: [conceptId], claimIds: ['c1'] } },
    at: { region: 'center' as const },
  });

  it('upgrades tokens that exactly match an approved entity referent', () => {
    const { ops, upgraded } = upgradeTokensToEntities([token('a', 'agent', 'agent')], picks, concepts);
    assert.deepEqual(upgraded, ['a']);
    assert.equal(ops[0]!.op, 'add');
    if (ops[0]!.op !== 'add') throw new Error('unreachable');
    assert.equal(ops[0]!.element.type, 'entity');
  });

  it('leaves unmatched text, non-entity concepts, and non-token ops alone', () => {
    const kinds = new Map<string, ConceptInfo>([['water', { id: 'water', label: 'Water', kind: 'process' }]]);
    const ops: BoardOp[] = [token('a', 'water', 'water'), token('b', 'agent', 'agent')];
    const { ops: out, upgraded } = upgradeTokensToEntities(ops, picks, new Map([...concepts, ...kinds]));
    assert.deepEqual(upgraded, ['b']);
    assert.equal(out[0]!.op, 'add');
    assert.equal(out[1]!.op, 'add');
    if (out[0]!.op !== 'add' || out[1]!.op !== 'add') throw new Error('unreachable');
    assert.equal(out[0]!.element.type, 'token');
    assert.equal(out[1]!.element.type, 'entity');
  });
});
