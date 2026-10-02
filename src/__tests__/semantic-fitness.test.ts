import test from 'node:test';
import assert from 'node:assert/strict';
import { depictClaims, semanticCoverageMetrics, semanticFitnessFailures, SEMANTIC_FITNESS_GATE_VERSION } from '../validate/gates.js';
import type { LaidOutScene } from '../shared/types.js';
import type { SceneContract } from '../plan/schemas.js';

type Claim = SceneContract['essentialClaims'][number];

const claim = (id: string, conceptIds: string[] = ['c1']): Claim => ({
  id, statement: `Statement for ${id}.`, conceptIds, relations: [], evidenceSpanIds: ['s1'],
});

const laidOut = (entries: Array<{ id: string; rung?: 2 | 3 | 4; strategy?: string; selectionBasis?: 'exact' | 'curated' | 'similarity' | 'procedural'; conceptIds?: string[] }>): LaidOutScene => ({
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
        ...(e.selectionBasis ? { selectionBasis: e.selectionBasis } : {}),
      },
    }),
  })),
  edges: [],
  occupancy: 0.5,
  carryOver: [],
  focus: [],
} as unknown as LaidOutScene);

const sceneWithIntent = (
  entries: Array<{ id: string; rung?: 2 | 3 | 4; strategy?: string; selectionBasis?: 'exact' | 'curated' | 'similarity' | 'procedural'; conceptIds?: string[] }>,
  claimId: string,
): LaidOutScene => {
  const base = laidOut(entries);
  return {
    ...base,
    boardIntent: {
      schemaVersion: 'typed-board-intent/v4-layout-recipes',
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
  assert.equal(SEMANTIC_FITNESS_GATE_VERSION, 'semantic-fitness/v4-visual-adapter-denominator');
});

test('claim drawn by R2 passes fitness silently', () => {
  const scene = sceneWithIntent([{ id: 'n1', rung: 2, strategy: 'R2-semantic-core', conceptIds: ['c1'] }], 'k1');
  const failures = semanticFitnessFailures(scene,  { spokenClaimSpans: [], essentialClaims: [claim('k1')] });
  assert.deepEqual(failures, []);
});

test('unreviewed similarity selections fail B4 even after they become an R0 referent pin', () => {
  for (const strategy of ['R8-ontology-fallback', 'R0-verified-pin']) {
    const scene = sceneWithIntent([{ id: 'n1', rung: 2, strategy, selectionBasis: 'similarity', conceptIds: ['c1'] }], 'k1');
    assert.ok(semanticFitnessFailures(scene, { spokenClaimSpans: [], essentialClaims: [claim('k1')] }).some((finding) => finding.code === 'semantic-match-unverified' && finding.hard));
  }
});

test('edge-only relation claims still require visible depictions for both endpoint concepts', () => {
  const scene = sceneWithIntent([
    { id: 'n1', rung: 2, strategy: 'R2-semantic-core', conceptIds: ['c1'] },
    { id: 'n2', rung: 2, strategy: 'R2-semantic-core', conceptIds: ['c2'] },
  ], 'k1');
  scene.elements = scene.elements.map((element) => ({ ...element, element: { id: element.element.id, anchor: 'sceneStart', prim: 'text' as const, text: element.element.id, size: 'body' as const, conceptIds: element.element.conceptIds } }));
  scene.edges = [{
    from: 'n1', to: 'n2',
    factualRelation: { fromConceptId: 'c1', toConceptId: 'c2', type: 'causes', evidenceRefs: [{ sourceId: 'src', spanId: 's1', startChar: 0, endChar: 1, quote: 'q' }] },
  } as never];
  scene.boardIntent!.visualIntents[0]!.targets = [{ kind: 'edge', fromElementId: 'n1', toElementId: 'n2', relationType: 'causes' }];
  const relationClaim = { ...claim('k1', ['c1', 'c2']), relations: [{ from: 'c1', to: 'c2', type: 'causes' }] } as Claim;
  const coverage = { spokenClaimSpans: [], essentialClaims: [relationClaim] };
  assert.ok(semanticFitnessFailures(scene, coverage).some((finding) => finding.code === 'relation-endpoint-undepicted' && finding.hard));
  assert.equal(semanticCoverageMetrics(depictClaims(scene, coverage), [])['semantic.requiredRelationCoverage'], 0);
  scene.elements = scene.elements.map((element) => ({ ...element, element: { id: element.element.id, anchor: 'sceneStart', prim: 'box' as const, text: element.element.id, conceptIds: element.element.conceptIds } }));
  assert.deepEqual(semanticFitnessFailures(scene, coverage), []);
  assert.equal(semanticCoverageMetrics(depictClaims(scene, coverage), [])['semantic.requiredRelationCoverage'], 1);
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
  const metrics = semanticCoverageMetrics(depictClaims(scene, { spokenClaimSpans: [], essentialClaims: [claim('k1')] }), []);
  assert.equal(metrics['semantic.visuallyRepresentableClaims'], 0);
  assert.equal(metrics['semantic.lastResortTextRate'], 0, 'a claim without an intent is outside the text-fallback denominator and is independently blocked by B3');
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

test('labelled boxes count as drawn depictions, not text fallback', () => {
  // A labelled box carries geometry; a bare text primitive does not.
  const scene = laidOut([{ id: 'n1', rung: 4, conceptIds: ['c1'] }]);
  const boxed: LaidOutScene = {
    ...scene,
    elements: scene.elements.map((e) => ({ ...e, element: { ...e.element, prim: 'box' as const }, resolution: undefined })),
  };
  const withIntent: LaidOutScene = {
    ...boxed,
    boardIntent: {
      schemaVersion: 'typed-board-intent/v4-layout-recipes',
      layout: 'flow',
      visualKind: 'process',
      roles: [],
      requiredConceptIds: [],
      requiredRelations: [],
      visualIntents: [{ claimId: 'k1', strategy: 'process', targets: [{ kind: 'element', elementId: 'n1' }] }],
    },
  } as unknown as LaidOutScene;
  const failures = semanticFitnessFailures(withIntent, { spokenClaimSpans: [], essentialClaims: [claim('k1')] });
  assert.ok(!failures.some((f) => f.code === 'major-claim-undepicted'), JSON.stringify(failures));
});

test('R10 labelled primitive is drawn; only R11 contributes to the last-resort text rate', () => {
  const coverage = { spokenClaimSpans: [], essentialClaims: [claim('k1')] };
  const r10 = sceneWithIntent([{ id: 'n1', rung: 4, strategy: 'R10-labelled-primitive', conceptIds: ['c1'] }], 'k1');
  const r10Depiction = depictClaims(r10, coverage);
  assert.equal(r10Depiction[0]!.drawnTargets, 1);
  assert.equal(r10Depiction[0]!.textTargets, 0);
  assert.equal(semanticCoverageMetrics(r10Depiction, [])['semantic.lastResortTextRate'], 0);
  assert.deepEqual(semanticFitnessFailures(r10, coverage), []);

  const r11 = sceneWithIntent([{ id: 'n1', rung: 4, strategy: 'R11-minimal-text', conceptIds: ['c1'] }], 'k1');
  const r11Depiction = depictClaims(r11, coverage);
  assert.equal(r11Depiction[0]!.drawnTargets, 0);
  assert.equal(r11Depiction[0]!.textTargets, 1);
  assert.equal(semanticCoverageMetrics(r11Depiction, [])['semantic.lastResortTextRate'], 1);
});

test('relation and state-change coverage have separate denominators', () => {
  const scene = sceneWithIntent([
    { id: 'n1', rung: 2, strategy: 'R2-semantic-core', conceptIds: ['c1'] },
    { id: 'n2', rung: 2, strategy: 'R2-semantic-core', conceptIds: ['c2'] },
  ], 'k1');
  scene.edges = [{
    from: 'n1', to: 'n2', factualRelation: { fromConceptId: 'c1', toConceptId: 'c2', type: 'transforms', evidenceRefs: [{ sourceId: 'src', spanId: 's1', startChar: 0, endChar: 1, quote: 'q' }] },
  } as never];
  scene.boardIntent!.visualIntents[0]!.targets = [{ kind: 'edge', fromElementId: 'n1', toElementId: 'n2', relationType: 'transforms' }];
  const transformationClaim = { ...claim('k1', ['c1', 'c2']), relations: [{ from: 'c1', to: 'c2', type: 'transforms' }] } as Claim;
  const depiction = depictClaims(scene, { spokenClaimSpans: [], essentialClaims: [transformationClaim] });
  const metrics = semanticCoverageMetrics(depiction, []);
  assert.equal(metrics['semantic.requiredRelations'], 1);
  assert.equal(metrics['semantic.requiredStateChanges'], 1);
  assert.equal(metrics['semantic.depictedStateChanges'], 1);
  assert.equal(metrics['semantic.stateChangeCoverage'], 1);
});

test('B4 and release metrics count an explicit text primitive as text-only even with an icon resolution', () => {
  const base = sceneWithIntent([{ id: 'n1', rung: 2, strategy: 'R2-semantic-core', conceptIds: ['c1'] }], 'k1');
  const scene = {
    ...base,
    elements: base.elements.map((entry) => ({
      ...entry,
      element: { ...entry.element, prim: 'text' as const, text: 'A copied label', size: 'body' as const },
    })),
  } as LaidOutScene;
  const coverage = { spokenClaimSpans: [], essentialClaims: [claim('k1')] };
  const depiction = depictClaims(scene, coverage);
  assert.equal(depiction[0]!.drawnTargets, 0);
  assert.equal(depiction[0]!.textTargets, 1);
  assert.ok(semanticFitnessFailures(scene, coverage).some((f) => f.code === 'major-claim-undepicted' && f.hard));
  const metrics = semanticCoverageMetrics(depiction, []);
  assert.equal(metrics['semantic.depictedClaims'], 0);
  assert.equal(metrics['semantic.textFallbackClaims'], 1);
  assert.equal(metrics['semantic.lastResortTextRate'], 1);
});

test('a text label beside a drawn depiction is not counted as last-resort text', () => {
  const base = sceneWithIntent([{ id: 'n1', rung: 2, strategy: 'R2-semantic-core', conceptIds: ['c1'] }], 'k1');
  const scene = {
    ...base,
    elements: [...base.elements, { ...base.elements[0]!, id: 'label', element: { ...base.elements[0]!.element, id: 'label', prim: 'text' as const, text: 'Concept', size: 'body' as const } }],
  } as LaidOutScene;
  const coverage = { spokenClaimSpans: [], essentialClaims: [claim('k1')] };
  const metrics = semanticCoverageMetrics(depictClaims(scene, coverage), []);
  assert.equal(metrics['semantic.textFallbackClaims'], 0);
  assert.equal(metrics['semantic.lastResortTextRate'], 0);
});

test('typed plot remains a visual depiction for B4 and coverage metrics', () => {
  const base = sceneWithIntent([{ id: 'n1', rung: 4, conceptIds: ['c1'] }], 'k1');
  const scene = {
    ...base,
    elements: base.elements.map((entry) => ({
      ...entry,
      element: { ...entry.element, prim: 'plot' as const, fn: 'linear' as const, params: [1, 0], domain: [0, 1] as [number, number] },
      resolution: undefined,
    })),
  } as LaidOutScene;
  const coverage = { spokenClaimSpans: [], essentialClaims: [claim('k1')] };
  const depiction = depictClaims(scene, coverage);
  assert.equal(depiction[0]!.drawnTargets, 1);
  assert.equal(depiction[0]!.textTargets, 0);
  assert.ok(!semanticFitnessFailures(scene, coverage).some((f) => f.code === 'major-claim-undepicted'));
  assert.equal(semanticCoverageMetrics(depiction, [])['semantic.lastResortTextRate'], 0);
});

test('code and chemistry adapters count as drawn claim depictions', () => {
  for (const prim of ['code', 'molecule', 'reaction'] as const) {
    const base = sceneWithIntent([{ id: 'n1', conceptIds: ['c1'] }], 'k1');
    const scene = {
      ...base,
      elements: base.elements.map((entry) => ({
        ...entry,
        element: { ...entry.element, prim } as unknown as typeof entry.element,
        resolution: undefined,
      })),
    } as LaidOutScene;
    const coverage = { spokenClaimSpans: [], essentialClaims: [claim('k1')] };
    const depiction = depictClaims(scene, coverage);
    assert.equal(depiction[0]!.drawnTargets, 1, `${prim} is a visual adapter`);
    assert.equal(depiction[0]!.textTargets, 0, `${prim} is not a text fallback`);
    assert.equal(semanticCoverageMetrics(depiction, [])['semantic.majorClaimVisualCoverage'], 1);
  }
});
