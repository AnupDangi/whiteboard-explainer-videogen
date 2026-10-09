import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { completeBindings } from '../visual-v2/ops-plan/complete.js';
import { SceneBoardDraftSchema } from '../visual-v2/ops-plan/types.js';
import type { BoardContext } from '../visual-v2/ops-plan/validate.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';

/** Deterministic bindings completion fills only unambiguous gaps. */

const ctx = (claims: string[]): BoardContext => ({
  sceneId: 'sc', title: 'T',
  beats: [{ beatId: 'sc.b1', sceneId: 'sc', order: 1, claimIds: claims, learnerDelta: 'd', beatType: 'introduce', cognitiveOperation: 'identify', representationFamily: 'process', entities: [{ conceptId: 'c1' }], relationships: [], misconceptionIds: [], narrationGoal: 'g', visualInvariant: 'v', mutedMeaning: 'm', narrationOnly: false, persistence: 'scene', pauseIntent: 'none', evidenceSpanIds: ['S1'] }],
  narration: [{ beatId: 'sc.b1', sentences: ['Charge builds.'] }],
  concepts: [{ id: 'c1', label: 'Charge' }],
  initial: emptyBoardState(),
});
const token = (bindings?: unknown) => ({
  op: 'add', opId: 'o1', beatId: 'sc.b1', id: 'e1',
  element: { type: 'token', text: 'charge', provenance: 'illustrative', ...(bindings ? { bindings } : {}) },
  at: { region: 'center' }, cue: 0,
});
const draftOf = (ops: unknown[]) => SceneBoardDraftSchema.parse({ transition: { mode: 'clean' }, ops });

describe('completeBindings', () => {
  it('fills claimIds for single-claim beats, leaves multi-claim beats missing', () => {
    const single = completeBindings(draftOf([token()]), ctx(['c1']));
    assert.deepEqual((single.ops[0] as { element: { bindings: unknown } }).element.bindings, { conceptIds: [], claimIds: ['c1'] });
    const multi = completeBindings(draftOf([token()]), ctx(['c1', 'c2']));
    assert.deepEqual((multi.ops[0] as { element: { bindings?: unknown } }).element.bindings ?? { conceptIds: [], claimIds: [] }, { conceptIds: [], claimIds: [] });
  });

  it('fills conceptIds from entity conceptId fields known to the scene', () => {
    const entity = {
      op: 'add', opId: 'o1', beatId: 'sc.b1', id: 'e1',
      element: { type: 'entity', conceptId: 'c1', label: 'Charge', provenance: 'illustrative' },
      at: { region: 'center' }, cue: 0,
    };
    const out = completeBindings(draftOf([entity]), ctx(['c1']));
    assert.deepEqual((out.ops[0] as { element: { bindings: unknown } }).element.bindings, { conceptIds: ['c1'], claimIds: ['c1'] });
  });

  it('never overwrites bindings the model wrote', () => {
    const kept = { conceptIds: ['c9'], claimIds: ['c9'] };
    const out = completeBindings(draftOf([token(kept)]), ctx(['c1']));
    assert.deepEqual((out.ops[0] as { element: { bindings: unknown } }).element.bindings, kept);
  });

  it('connect ops inherit endpoint concept bindings', () => {
    const add = {
      op: 'add', opId: 'o1', beatId: 'sc.b1', id: 'a',
      element: { type: 'entity', conceptId: 'c1', label: 'Charge', provenance: 'illustrative', bindings: { conceptIds: ['c1'], claimIds: ['c1'] } },
      at: { region: 'center' }, cue: 0,
    };
    const edge = { op: 'connect', opId: 'o2', beatId: 'sc.b1', id: 'e', from: 'a', to: 'a', relation: 'causes' };
    const out = completeBindings(draftOf([add, edge]), ctx(['c1']));
    assert.deepEqual((out.ops[1] as { bindings: unknown }).bindings, { conceptIds: ['c1'], claimIds: ['c1'] });
  });

  it('snaps a factual edge with no valid quote to a source quote stating the directed sequence; leaves it unsnapped otherwise', () => {
    const base = ctx(['c1']);
    const withQuote: BoardContext = { ...base, concepts: [{ id: 'c1', label: 'Water', evidence: [{ spanId: 'S1', quote: 'water moves toward the cell and the cell swells' }] }] };
    const add = (id: string, label: string) => ({
      op: 'add', opId: `o-${id}`, beatId: 'sc.b1', id,
      element: { type: 'entity', conceptId: 'c1', label, provenance: 'illustrative' },
      at: { region: 'center' }, cue: 0,
    });
    const edge = { op: 'connect', opId: 'o-e', beatId: 'sc.b1', id: 'e', from: 'water', to: 'cell', relation: 'causes' };
    const snapped = completeBindings(draftOf([add('water', 'Water'), add('cell', 'Cell'), edge]), withQuote);
    assert.deepEqual((snapped.ops[2] as { evidence?: unknown }).evidence, { spanId: 'S1', quote: 'water moves toward the cell and the cell swells' });

    const noQuote = completeBindings(draftOf([add('water', 'Water'), add('cell', 'Cell'), edge]), { ...base, concepts: [{ id: 'c1', label: 'Water' }] });
    assert.equal((noQuote.ops[2] as { evidence?: unknown }).evidence, undefined, 'no containing quote means no snap; the edge still fails validation');
  });
});
