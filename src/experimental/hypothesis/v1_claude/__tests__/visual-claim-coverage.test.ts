import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneContract } from '../plan/schemas.js';
import type { SceneSpec, SpokenClaimSpan, Timeline } from '../types.js';
import { visualClaimCoverageFailures } from '../validation/gates.js';
import { runVisualChain } from '../pipeline/visualChain.js';

const ref = (spanId: string) => ({ sourceId: 'document', spanId, startChar: 0, endChar: 20, startLine: 1, endLine: 1, quote: 'source supported fact' });
const claim = (id: string, concepts: [string, string], spanId: string): SceneContract['essentialClaims'][number] => ({
  id, statement: 'A source backed relation', conceptIds: concepts,
  relations: [{ from: concepts[0], to: concepts[1], type: 'feeds' }], evidenceSpanIds: [spanId],
});
const spoken = (id: string): SpokenClaimSpan => ({ claimId: id, exactText: 'The relation is spoken.', plainStart: 0, plainEnd: 23 });
const timedCoverage = (coverage: ReturnType<typeof fixture>['coverage']) => ({ ...coverage, plainText: 'The relation is spoken.', alignedWords: [
  { w: 'The', startMs: 0, endMs: 80 }, { w: 'relation', startMs: 90, endMs: 180 },
  { w: 'is', startMs: 190, endMs: 230 }, { w: 'spoken', startMs: 240, endMs: 340 },
] });

function fixture(concepts: [string, string] = ['upstream', 'downstream'], spanId = 'span-a') {
  const [from, to] = concepts;
  const evidenceRefs = [ref(spanId)];
  const spec: SceneSpec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'synthetic', title: 'A relation', template: 'chain',
    elements: [from, to].map((name, index) => ({ id: `n${index + 1}`, prim: 'box' as const, text: name, anchor: 'sceneStart' as const, conceptIds: [name], evidenceRefs })),
    edges: [{ from: 'n1', to: 'n2', evidenceRefs, factualRelation: { fromConceptId: from, toConceptId: to, type: 'feeds', evidenceRefs } }],
    boardIntent: {
      schemaVersion: 'typed-board-intent/v3', layout: 'flow', visualKind: 'process',
      roles: [{ elementId: 'n1', role: 'input' }, { elementId: 'n2', role: 'process' }],
      requiredConceptIds: [from, to], requiredRelations: [{ from, to, type: 'feeds', evidenceRefs }],
      visualIntents: [{ claimId: 'claim-a', strategy: 'process', targets: [
        { kind: 'element', elementId: 'n1' }, { kind: 'element', elementId: 'n2' }, { kind: 'edge', fromElementId: 'n1', toElementId: 'n2', relationType: 'feeds' },
      ] }],
    },
  };
  return { spec, coverage: { essentialClaims: [claim('claim-a', concepts, spanId)], spokenClaimSpans: [spoken('claim-a')] } };
}
const asInput = (spec: SceneSpec) => ({ ...spec, elements: spec.elements.map((element) => ({ id: element.id, element })) });
const timeline: Timeline = { sceneId: 'synthetic', sceneStartMs: 0, sceneEndMs: 1000, events: [
  { elementId: 'n1', track: 'wipe', t0: 0, t1: 100 },
  { elementId: 'n2', track: 'wipe', t0: 100, t1: 200 },
  { elementId: 'n1', track: 'edge', edgeIndex: 0, t0: 200, t1: 300 },
] };
const errors = (spec: SceneSpec, coverage = fixture().coverage, clock?: Timeline) => visualClaimCoverageFailures(asInput(spec), coverage, clock).map((failure) => failure.message);

test('claim coverage accepts a multi-target relation and topic-swapped source data', () => {
  for (const concepts of [['upstream', 'downstream'], ['signal', 'actuator']] as Array<[string, string]>) {
    const { spec, coverage } = fixture(concepts, concepts[0]);
    assert.deepEqual(visualClaimCoverageFailures(asInput(spec), timedCoverage(coverage), timeline).map((failure) => failure.message), []);
  }
});

test('claim coverage rejects missing, unknown, and duplicated claim mappings', () => {
  const { spec, coverage } = fixture();
  spec.boardIntent!.visualIntents = [];
  assert.match(errors(spec, coverage).join(' '), /requires exactly one visual intent/);
  spec.boardIntent!.visualIntents = [{ claimId: 'wrong', strategy: 'process', targets: [{ kind: 'element', elementId: 'n1' }] }];
  assert.match(errors(spec, coverage).join(' '), /unknown claim/);
  spec.boardIntent!.visualIntents = [fixture().spec.boardIntent!.visualIntents[0]!, fixture().spec.boardIntent!.visualIntents[0]!];
  assert.match(errors(spec, coverage).join(' '), /exactly one visual intent/);
});

test('claim coverage rejects dangling and unsupported targets and incomplete relation depiction', () => {
  const { spec, coverage } = fixture();
  spec.boardIntent!.visualIntents[0]!.targets = [{ kind: 'element', elementId: 'absent' }];
  assert.match(errors(spec, coverage).join(' '), /unsupported element/);
  spec.boardIntent!.visualIntents[0]!.targets = [{ kind: 'element', elementId: 'n1' }, { kind: 'element', elementId: 'n2' }];
  assert.match(errors(spec, coverage).join(' '), /no depicting edge/);
  spec.boardIntent!.visualIntents[0]!.targets.push({ kind: 'edge', fromElementId: 'n1', toElementId: 'n2', relationType: 'feeds' });
  spec.edges[0]!.evidenceRefs = [ref('other')];
  assert.match(errors(spec, coverage).join(' '), /unsupported edge/);
});

test('claim coverage rejects absent, zero, and end-only target reveals', () => {
  const { spec, coverage } = fixture();
  for (const events of [[], timeline.events.map((event) => event.track === 'edge' ? { ...event, t1: event.t0 } : event), timeline.events.map((event) => event.track === 'edge' ? { ...event, t0: 999, t1: 1000 } : event)]) {
    assert.match(errors(spec, timedCoverage(coverage), { ...timeline, events }).join(' '), /not fully revealed/);
  }
});

test('edge targets disambiguate multiple relations between the same elements', () => {
  const { spec, coverage } = fixture();
  spec.edges.push({ from: 'n1', to: 'n2', evidenceRefs: [ref('span-a')], factualRelation: { fromConceptId: 'upstream', toConceptId: 'downstream', type: 'causes', evidenceRefs: [ref('span-a')] } });
  spec.boardIntent!.visualIntents[0]!.targets = [{ kind: 'edge', fromElementId: 'n1', toElementId: 'n2', relationType: 'feeds' }];
  const duplicateRelationClaim = timedCoverage({ ...coverage, essentialClaims: [claim('claim-a', ['upstream', 'downstream'], 'span-a')] });
  const twoEdges = { ...timeline, events: [...timeline.events, { elementId: 'n2', track: 'edge' as const, edgeIndex: 1, t0: 250, t1: 300 }] };
  assert.deepEqual(visualClaimCoverageFailures(asInput(spec), duplicateRelationClaim, twoEdges), []);
});

test('claim coverage rejects a target revealed only after the spoken claim', () => {
  const { spec, coverage } = fixture();
  const claimCoverage = timedCoverage(coverage);
  const lateTimeline = { ...timeline, events: timeline.events.map((event) => event.track === 'edge' ? { ...event, t0: 500, t1: 600 } : event) };
  assert.match(visualClaimCoverageFailures(asInput(spec), claimCoverage, lateTimeline).map((failure) => failure.message).join(' '), /by the end of its spoken claim/);
});

test('claim timing maps compound tokens inside one aligned word and requires the depiction to finish in time', () => {
  const { spec, coverage } = fixture();
  const plainText = 'A/B is spoken.';
  const compoundCoverage = { ...coverage, spokenClaimSpans: [{ claimId: 'claim-a', exactText: plainText, plainStart: 0, plainEnd: plainText.length }], plainText, alignedWords: [
    { w: 'A/B', startMs: 0, endMs: 90 }, { w: 'is', startMs: 100, endMs: 140 }, { w: 'spoken', startMs: 150, endMs: 240 },
  ] };
  const slowTimeline = { ...timeline, events: timeline.events.map((event) => event.track === 'edge' ? { ...event, t0: 200, t1: 300 } : event) };
  assert.match(visualClaimCoverageFailures(asInput(spec), compoundCoverage, slowTimeline).map((failure) => failure.message).join(' '), /not fully revealed/);
  const readyTimeline = { ...slowTimeline, events: slowTimeline.events.map((event) => event.track === 'edge' ? { ...event, t1: 230 } : event) };
  assert.deepEqual(visualClaimCoverageFailures(asInput(spec), compoundCoverage, readyTimeline), []);
});

test('claim timing rejects a spoken span beginning inside an aligned word', () => {
  const { spec, coverage } = fixture();
  const plainText = 'Osmosis explains water.';
  const exactText = 'smosis explains water.';
  const misaligned = { ...coverage, spokenClaimSpans: [{ claimId: 'claim-a', exactText, plainStart: 1, plainEnd: plainText.length }], plainText, alignedWords: [
    { w: 'Osmosis', startMs: 0, endMs: 80 }, { w: 'explains', startMs: 90, endMs: 180 }, { w: 'water', startMs: 190, endMs: 340 },
  ] };
  assert.match(visualClaimCoverageFailures(asInput(spec), misaligned, timeline).map((failure) => failure.message).join(' '), /does not start and end on aligned word boundaries/);
});

test('failed claim coverage returns before S10 and emits no final frame', async () => {
  const { spec, coverage } = fixture();
  spec.boardIntent!.visualIntents = [];
  const stages: string[] = [];
  const result = await runVisualChain({ sceneId: spec.sceneId, spec, mentions: [], bounds: { startMs: 0, endMs: 1000 }, claimCoverage: coverage }, {
    catalogVersion: 'synthetic', onStage: (stage) => { stages.push(stage); },
  });
  assert.ok(result.gates.failures.some((failure) => failure.code === 'visual-claim-coverage'));
  assert.equal(result.finalFrameSvg, undefined);
  assert.ok(!stages.includes('S10-render'));
});
