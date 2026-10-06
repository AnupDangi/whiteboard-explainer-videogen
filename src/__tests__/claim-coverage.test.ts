import assert from 'node:assert/strict';
import test from 'node:test';
import { ClaimCoverageReportSchema, scoreClaimCoverage, type ClaimCoverageInput } from '../pipeline-v2/claimCoverage.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import type { SemanticOp } from '../teaching/semantic-ir/types.js';
import type { BoardOp } from '../visual-v2/board-ops/types.js';
import { applyOp, emptyBoardState } from '../visual-v2/board-state/reducer.js';
import type { BoardState } from '../visual-v2/board-state/types.js';
import type { RenderedEntityAssetEvidence } from '../pipeline-v2/renderedEntityAssets.js';

const bindings = { conceptIds: ['source'], claimIds: ['c1'] };
const entity = (conceptId: string) => ({ type: 'entity' as const, conceptId, label: conceptId, provenance: 'derived' as const,
  bindings: { conceptIds: [conceptId], claimIds: ['c1'] } });
const value = { type: 'value' as const, label: 'State', value: 'whole', provenance: 'derived' as const, bindings };
const picture = (elementId: string, conceptId: string): RenderedEntityAssetEvidence => ({ elementId, conceptId,
  selectedAssetId: null, resolvedAssetId: 'icon', depictionFamily: 'pictorial', meaningful: true,
  pathCount: 1, fillCount: 0, embedCount: 0, resolutionReason: 'test drawable' });
const beat = (kind: 'separate' | 'transform' | 'introduce'): TeachingBeat => ({ ...({} as TeachingBeat), beatId: 'b1', sceneId: 's1', claimIds: ['c1'],
  requiredSemanticChanges: [
    { kind: 'introduce', identityKey: 'source', entityId: 'source', toState: 'whole' },
    { kind, identityKey: 'source', entityId: 'source', toState: 'pieces' },
  ],
  misconceptionIds: [] });
const statesFor = (ops: readonly BoardOp[]): BoardState[] => {
  const states = [emptyBoardState()];
  for (const op of ops) states.push(applyOp(states.at(-1)!, op).state);
  return states;
};
const baseOps: BoardOp[] = [
  { op: 'add', opId: 'b1.e1.board', beatId: 'b1', id: 'source', element: entity('source'), at: { region: 'center' } },
  { op: 'add', opId: 'b1.e1.state', beatId: 'b1', id: 'source.state', element: value, at: { region: 'center' } },
];
const separate: SemanticOp = { type: 'separate', eventId: 'b1.e2', beatId: 'b1', claimIds: ['c1'], dependsOnEventIds: [],
  sourceEntityId: 'source', fromState: 'whole', results: [
    { id: 'left', conceptId: 'left', claimIds: ['c1'], lifecycle: 'active' },
    { id: 'right', conceptId: 'right', claimIds: ['c1'], lifecycle: 'active' },
  ] };
const splitOps: BoardOp[] = [
  { op: 'remove', opId: 'b1.e2.state-remove', beatId: 'b1', target: 'source.state' },
  { op: 'split', opId: 'b1.e2.split', beatId: 'b1', target: 'source', into: [
    { id: 'left', element: entity('left'), at: { region: 'left' } },
    { id: 'right', element: entity('right'), at: { region: 'right' } },
  ] },
];
const input = (ops: BoardOp[] = [...baseOps, ...splitOps]): ClaimCoverageInput => ({
  claims: [{ id: 'c1', epistemicType: 'direct_source', conceptIds: ['source', 'left', 'right'], relations: [] }],
  beats: [beat('separate')], semanticOperations: [separate],
  mechanismRequirements: [{ eventId: 'b1.e2', kind: 'separate', entityIds: ['source', 'left', 'right'], claimIds: ['c1'], description: 'Show separation.' }],
  boardOps: ops, states: statesFor(ops),
  renderedEntityAssets: [picture('source', 'source'), picture('left', 'left'), picture('right', 'right')],
});

test('visible separation requires typed event, source removal, split, captured results and drawable claim-bound pictures', () => {
  const report = scoreClaimCoverage(input());
  assert.equal(report.rows[0]?.level, 'mechanism_visible');
  assert.equal(report.rows[0]?.weight, 3);
  assert.equal(report.weightedCoverage, 1);
  assert.deepEqual(report.dynamicMechanismMissingClaimIds, []);
  assert.deepEqual(ClaimCoverageReportSchema.parse(report), report);
  assert.equal(ClaimCoverageReportSchema.safeParse({ ...report, invented: true }).success, false);
  assert.equal(ClaimCoverageReportSchema.safeParse({ ...report, rows: [{ ...report.rows[0], invented: true }] }).success, false);
  assert.deepEqual(report.rows[0]?.boardOpIds, ['b1.e1.board', 'b1.e1.state', 'b1.e2.split', 'b1.e2.state-remove']);

  const noSemantic = { ...input(), semanticOperations: [] };
  assert.equal(scoreClaimCoverage(noSemantic).rows[0]?.level, 'partial');
  const noRequirement = { ...input(), mechanismRequirements: [] };
  assert.equal(scoreClaimCoverage(noRequirement).rows[0]?.level, 'partial');
  const label = { ...input(), renderedEntityAssets: [] };
  assert.equal(scoreClaimCoverage(label).rows[0]?.level, 'label_only');
  const wrongOps: BoardOp[] = [...baseOps, splitOps[0]!, { ...splitOps[1]!, into: [
    { id: 'left', element: { ...entity('left'), bindings: { conceptIds: ['left'], claimIds: ['other'] } }, at: { region: 'left' } },
    { id: 'right', element: entity('right'), at: { region: 'right' } },
  ] } as BoardOp];
  const wrongBinding = input(wrongOps);
  assert.equal(scoreClaimCoverage(wrongBinding).rows[0]?.level, 'partial');
});

test('value-only transformation stays below mechanism coverage even with a selected icon', () => {
  const update: BoardOp = { op: 'updateValue', opId: 'b1.e2.board', beatId: 'b1', target: 'source.state', value: 'pieces' };
  const caseInput: ClaimCoverageInput = { ...input([...baseOps, update]),
    claims: [{ id: 'c1', conceptIds: ['source'], relations: [] }], beats: [beat('transform')],
    semanticOperations: [{ type: 'transform', eventId: 'b1.e2', beatId: 'b1', claimIds: ['c1'], dependsOnEventIds: [],
      entityId: 'source', fromState: 'whole', toState: 'pieces' }],
    renderedEntityAssets: [{ ...picture('source', 'source'), selectedAssetId: 'icon' }],
  };
  const report = scoreClaimCoverage(caseInput);
  assert.equal(report.rows[0]?.level, 'partial');
  assert.ok(report.rows[0]?.boardOpIds.includes('b1.e2.board'));
  assert.deepEqual(report.dynamicMechanismMissingClaimIds, ['c1']);
});

test('canonical causal relations require mechanism coverage even when the beat only introduces labels or entities', () => {
  const caseInput: ClaimCoverageInput = {
    ...input([...baseOps]),
    claims: [{ id: 'c1', conceptIds: ['source', 'effect'], relations: [{ from: 'source', to: 'effect', type: 'causes' }] }],
    beats: [beat('introduce')], semanticOperations: [], mechanismRequirements: [],
    renderedEntityAssets: [picture('source', 'source')],
  };
  const row = scoreClaimCoverage(caseInput).rows[0]!;
  assert.equal(row.dynamicMechanismRequired, true);
  assert.equal(row.level, 'partial');
  assert.equal(row.weight, 3);
  assert.deepEqual(scoreClaimCoverage(caseInput).dynamicMechanismMissingClaimIds, ['c1']);
});

test('separation can use a previously introduced source bound to an earlier claim', () => {
  const earlierSource = { ...entity('source'), bindings: { conceptIds: ['source'], claimIds: ['c0'] } };
  const earlierValue = { ...value, bindings: { conceptIds: ['source'], claimIds: ['c0'] } };
  const operations: BoardOp[] = [
    { op: 'add', opId: 'b0.e1.board', beatId: 'b0', id: 'source', element: earlierSource, at: { region: 'center' } },
    { op: 'add', opId: 'b0.e1.state', beatId: 'b0', id: 'source.state', element: earlierValue, at: { region: 'center' } },
    { op: 'remove', opId: 'b1.e1.state-remove', beatId: 'b1', target: 'source.state' },
    { op: 'split', opId: 'b1.e1.split', beatId: 'b1', target: 'source', into: [
      { id: 'left', element: entity('left'), at: { region: 'left' } },
      { id: 'right', element: entity('right'), at: { region: 'right' } },
    ] },
  ];
  const caseInput: ClaimCoverageInput = {
    ...input(operations),
    beats: [{ ...beat('separate'), requiredSemanticChanges: [
      { kind: 'separate', identityKey: 'source', entityId: 'source', toState: 'pieces', claimIds: ['c1'] },
    ] }],
    semanticOperations: [{ ...separate, eventId: 'b1.e1' }],
    mechanismRequirements: [{ eventId: 'b1.e1', kind: 'separate', entityIds: ['source', 'left', 'right'],
      claimIds: ['c1'], description: 'Show the separation.' }],
  };
  assert.equal(scoreClaimCoverage(caseInput).rows[0]?.level, 'mechanism_visible');
  assert.equal(scoreClaimCoverage({ ...caseInput, claims: [{ id: 'c1', conceptIds: ['left', 'right'], relations: [] }] }).rows[0]?.level, 'partial');
});

test('verified split covers only exact source-to-result relation direction and predicate', () => {
  const sourceToResult = { from: 'source', to: 'left', type: 'produces' };
  const caseInput = input();
  caseInput.claims = [{ id: 'c1', conceptIds: ['source', 'left', 'right'], relations: [sourceToResult] }];
  assert.equal(scoreClaimCoverage(caseInput).rows[0]?.level, 'mechanism_visible');
  for (const relation of [
    { from: 'left', to: 'source', type: 'produces' },
    { from: 'source', to: 'left', type: 'contains' },
    { from: 'source', to: 'missing', type: 'produces' },
  ]) {
    assert.equal(scoreClaimCoverage({ ...caseInput, claims: [{ id: 'c1', conceptIds: ['source', 'left', 'right'], relations: [relation] }] }).rows[0]?.level, 'partial');
  }
});

test('static relation does not join an edge to endpoints from different captured states', () => {
  const operations: BoardOp[] = [
    { op: 'add', opId: 'a', beatId: 'b1', id: 'left', element: entity('left'), at: { region: 'left' } },
    { op: 'add', opId: 'b', beatId: 'b1', id: 'right', element: entity('right'), at: { region: 'right' } },
    { op: 'connect', opId: 'e', beatId: 'b1', id: 'edge', from: 'left', to: 'right', relation: 'produces',
      bindings: { conceptIds: ['left', 'right'], claimIds: ['c1'] } },
  ];
  const states = statesFor(operations);
  const splitSnapshots = states.map((state) => structuredClone(state));
  splitSnapshots[2]!.elements.left!.lifecycle.removedAtBeat = 'b1';
  splitSnapshots[3]!.elements.right!.lifecycle.removedAtBeat = 'b1';
  const caseInput: ClaimCoverageInput = {
    claims: [{ id: 'c1', conceptIds: ['left', 'right'], relations: [{ from: 'left', to: 'right', type: 'produces' }] }],
    beats: [], semanticOperations: [], mechanismRequirements: [], boardOps: operations, states: splitSnapshots,
    renderedEntityAssets: [picture('left', 'left'), picture('right', 'right')],
  };
  const row = scoreClaimCoverage(caseInput).rows[0]!;
  assert.equal(row.level, 'partial');
  assert.deepEqual(row.edgeIds, []);
});

test('multi-claim beat without per-change ownership cannot claim a visible mechanism', () => {
  const caseInput = input();
  caseInput.beats = [{ ...beat('separate'), claimIds: ['c1', 'c2'] }];
  const report = scoreClaimCoverage(caseInput);
  assert.equal(report.rows[0]?.level, 'partial');
  assert.match(report.rows[0]!.rationale, /ambiguous/);
});

test('claim weight and coverage are independent of prose and input ordering', () => {
  const caseInput = input();
  caseInput.claims = [
    { id: 'relation', conceptIds: ['left', 'right'], relations: [{ from: 'left', to: 'right', type: 'causes' }] },
    { id: 'example', epistemicType: 'illustrative_example', conceptIds: ['missing'], relations: [] },
    ...caseInput.claims,
  ];
  const first = scoreClaimCoverage(caseInput);
  assert.deepEqual(first.rows.map((row) => [row.claimId, row.weight, row.level]), [
    ['c1', 3, 'mechanism_visible'], ['example', 1, 'none'], ['relation', 3, 'none'],
  ]);
  assert.deepEqual(scoreClaimCoverage({ ...caseInput, claims: [...caseInput.claims].reverse() }), first);
});
