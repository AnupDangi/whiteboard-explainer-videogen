import test from 'node:test';
import assert from 'node:assert/strict';
import { depictClaims, semanticCoverageMetrics } from '../validate/gates.js';
import type { LaidOutScene } from '../shared/types.js';
import type { SceneContract } from '../plan/schemas.js';

type Claim = SceneContract['essentialClaims'][number];
const claim = (id: string): Claim => ({ id, statement: `Statement for ${id}.`, conceptIds: ['c1'], relations: [], evidenceSpanIds: ['s1'] });

function scene(el: { prim: string; strategy?: string; rung?: number }): LaidOutScene {
  return {
    sceneId: 's', title: 'T', template: 'chain',
    elements: [{
      id: 'n1',
      element: { id: 'n1', anchor: 'sceneStart', prim: el.prim, concept: 'n1', conceptIds: ['c1'], evidenceRefs: [{ sourceId: 'src', spanId: 's1', startChar: 0, endChar: 1, quote: 'q' }] },
      bbox: { x: 0, y: 0, w: 10, h: 10 }, intrinsicSize: { w: 10, h: 10 }, visual: { paths: [], fills: [], texts: [] },
      ...(el.strategy ? { resolution: { rung: el.rung ?? 4, assetId: null, score: 1, license: 'manual', lane: 'procedural', source: 'generated', strategy: el.strategy } } : {}),
    }],
    edges: [], occupancy: 0.5, carryOver: [], focus: [],
    boardIntent: { schemaVersion: 'typed-board-intent/v4-layout-recipes', layout: 'flow', visualKind: 'process', roles: [], requiredConceptIds: [], requiredRelations: [], visualIntents: [{ claimId: 'k1', strategy: 'process', targets: [{ kind: 'element', elementId: 'n1' }] }] },
  } as unknown as LaidOutScene;
}
const coverage = { spokenClaimSpans: [], essentialClaims: [claim('k1')] };

test('R10 labelled primitive is text-supported but is neither drawn coverage nor mechanism coverage', () => {
  const [d] = depictClaims(scene({ prim: 'box', strategy: 'R10-labelled-primitive' }), coverage);
  assert.equal(d!.textSupported, true);
  assert.equal(d!.drawnCoverage, false);
  assert.equal(d!.mechanismCoverage, false);
  assert.equal(d!.r10Only, true);
  const m = semanticCoverageMetrics([d!], []);
  assert.equal(m['semantic.meaningfulClaimCoverage'], 0);
  assert.equal(m['semantic.mechanismClaimCoverage'], 0);
  assert.equal(m['semantic.r10OnlyMajorClaims'], 1);
  assert.equal(m['semantic.textSupportedClaims'], 1);
});

test('a plain labelled box with no resolution is not meaningful coverage either', () => {
  const [d] = depictClaims(scene({ prim: 'box' }), coverage);
  assert.equal(d!.drawnCoverage, false);
  assert.equal(d!.r10Only, true);
});

test('a semantic-core role is drawn and mechanism coverage; a literal icon is drawn but not mechanism', () => {
  const [core] = depictClaims(scene({ prim: 'object', strategy: 'R2-semantic-core', rung: 2 }), coverage);
  assert.equal(core!.drawnCoverage, true);
  assert.equal(core!.mechanismCoverage, true);
  assert.equal(core!.r10Only, false);
  const [icon] = depictClaims(scene({ prim: 'object', strategy: 'R3-downshift-literal', rung: 3 }), coverage);
  assert.equal(icon!.drawnCoverage, true);
  assert.equal(icon!.mechanismCoverage, false);
});

test('structured exact primitives (stack, formula) count as meaningful mechanism geometry', () => {
  for (const prim of ['stack', 'formula', 'container', 'tokenStrip']) {
    const [d] = depictClaims(scene({ prim }), coverage);
    assert.equal(d!.drawnCoverage, true, prim);
    assert.equal(d!.mechanismCoverage, true, prim);
  }
});

test('legacy V1 metrics are unchanged: R10 still counts as drawn for majorClaimVisualCoverage', () => {
  const m = semanticCoverageMetrics(depictClaims(scene({ prim: 'box', strategy: 'R10-labelled-primitive' }), coverage), []);
  assert.equal(m['semantic.majorClaimVisualCoverage'], 1);
});
