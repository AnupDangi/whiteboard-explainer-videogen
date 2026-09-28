import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticFitnessFailures, SEMANTIC_FITNESS_GATE_VERSION } from '../validation/gates.js';
import type { LaidOutScene } from '../types.js';
import type { SceneContract } from '../plan/schemas.js';

type Claim = SceneContract['essentialClaims'][number];

const claim = (id: string, conceptIds: string[] = ['c1']): Claim => ({
  id, statement: `Statement for ${id}.`, conceptIds, relations: [], evidenceSpanIds: ['s1'],
});

const laidOut = (entries: Array<{ id: string; rung?: 2 | 3 | 4; strategy?: string; conceptIds?: string[] }>): LaidOutScene => ({
  sceneId: 's',
  title: 'T',
  template: 'chain',
  elements: entries.map((e) => ({
    id: e.id,
    element: {
      id: e.id, anchor: 'sceneStart', prim: 'object', concept: e.id,
      ...(e.conceptIds ? { conceptIds: e.conceptIds } : {}),
      evidenceRefs: [{ sourceId: 'src', spanId: 's1', startChar: 0, endChar: 1, quote: 'q' }],
    },
    bbox: { x: 0, y: 0, w: 10, h: 10 },
    intrinsicSize: { w: 10, h: 10 },
    visual: { paths: [], fills: [], texts: [] },
    ...(e.rung === undefined ? {} : {
      resolution: {
        rung: e.rung, assetId: e.rung === 4 ? null : `asset:${e.id}`, score: 1, license: 'manual',
        lane: 'procedural', source: 'semantic-core',
        ...(e.strategy ? { strategy: e.strategy as 'R2-semantic-core' } : {}),
      },
    }),
  })),
  edges: [],
  occupancy: 0.5,
  carryOver: [],
  focus: [],
} as unknown as LaidOutScene);

const sceneWithIntent = (
  entries: Array<{ id: string; rung?: 2 | 3 | 4; strategy?: string; conceptIds?: string[] }>,
  claimId: string,
): LaidOutScene => {
  const base = laidOut(entries);
  return {
    ...base,
    boardIntent: {
      schemaVersion: 'typed-board-intent/v3',
      layout: 'flow',
      visualKind: 'process',
      roles: [],
      requiredConceptIds: [],
      requiredRelations: [],
      visualIntents: [{ claimId, strategy: 'process', targets: entries.map((e) => ({ kind: 'element', elementId: e.id })) }],
    },
  } as unknown as LaidOutScene;
};

test('fitness gate version is pinned', () => {
  assert.equal(SEMANTIC_FITNESS_GATE_VERSION, 'semantic-fitness/v1');
});

test('claim drawn by R2 passes fitness silently', () => {
  const scene = sceneWithIntent([{ id: 'n1', rung: 2, strategy: 'R2-semantic-core', conceptIds: ['c1'] }], 'k1');
  const failures = semanticFitnessFailures(scene,  { spokenClaimSpans: [], essentialClaims: [claim('k1')] });
  assert.deepEqual(failures, []);
});

test('claim depicted only by text fallback is a hard failure', () => {
  const scene = sceneWithIntent([{ id: 'n1', rung: 4, conceptIds: ['c1'] }], 'k1');
  const failures = semanticFitnessFailures(scene,  { spokenClaimSpans: [], essentialClaims: [claim('k1')] });
  assert.ok(failures.some((f) => f.code === 'major-claim-undepicted' && f.hard), JSON.stringify(failures));
});

test('claims without intents are left to B3', () => {
  const scene = laidOut([{ id: 'n1', rung: 2, strategy: 'R2-semantic-core', conceptIds: ['c1'] }]);
  const failures = semanticFitnessFailures(scene,  { spokenClaimSpans: [], essentialClaims: [claim('k1')] });
  assert.ok(!failures.some((f) => f.code === 'major-claim-undepicted'));
});

test('mechanism depicted literally is a draft finding, not a pass', () => {
  // neural-network is diagram-first in the vendored bridge.
  const scene = sceneWithIntent([{ id: 'n1', rung: 2, strategy: 'R3-house-literal', conceptIds: ['neural-network'] }], 'k1');
  const failures = semanticFitnessFailures(scene,  { spokenClaimSpans: [], essentialClaims: [claim('k1', ['neural-network'])] });
  const finding = failures.find((f) => f.code === 'mechanism-literal-fallback');
  assert.ok(finding && !finding.hard, JSON.stringify(failures));
});

test('mechanism depicted by diagram passes', () => {
  const scene = sceneWithIntent([{ id: 'n1', rung: 2, strategy: 'R1-diagram', conceptIds: ['neural-network'] }], 'k1');
  const failures = semanticFitnessFailures(scene,  { spokenClaimSpans: [], essentialClaims: [claim('k1', ['neural-network'])] });
  assert.deepEqual(failures.filter((f) => f.code === 'mechanism-literal-fallback'), []);
});

test('text fallback despite approved assets is a draft finding', () => {
  // abacus has approved house assets in the vendored bridge.
  const scene = sceneWithIntent([{ id: 'n1', rung: 4, conceptIds: ['abacus'] }], 'k1');
  const failures = semanticFitnessFailures(scene,  { spokenClaimSpans: [], essentialClaims: [claim('k1', ['abacus'])] });
  assert.ok(failures.some((f) => f.code === 'major-claim-undepicted' && f.hard));
  assert.ok(failures.some((f) => f.code === 'text-fallback-despite-assets' && !f.hard));
});
