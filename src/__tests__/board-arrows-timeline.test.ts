import test from 'node:test';
import assert from 'node:assert/strict';
import type { BBox, Edge, ResolvedMention, SceneSpec } from '../shared/types.js';
import { RELATION_ARROWS } from '../run/config.js';
import { RELATION_TYPES } from '../plan/schemas.js';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { renderSceneBody } from '../render/renderScene.js';
import { runClaudeGates } from '../validate/gates.js';
import { STYLE } from '../render/style.js';

const ref = { sourceId: 'src_synthetic', spanId: 'span_1', startChar: 0, endChar: 4, startLine: 1, endLine: 1, quote: 'text' };

// Synthetic scenes; two unrelated vocabularies run through the same template (topic-swap rule).
const scene = (words: [string, string, string], type: NonNullable<Edge['factualRelation']>['type']): SceneSpec => {
  const arrow = RELATION_ARROWS[type];
  const [a, b, c] = words;
  return {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'synthetic', title: 'Synthetic', template: 'chain',
    elements: [a, b, c].map((word) => ({ id: word, anchor: `mention:${word}` as const, prim: 'box' as const, text: word, conceptIds: [word], evidenceRefs: [ref] })),
    edges: [
      { from: a, to: b, label: arrow.verb, ...(arrow.directed ? {} : { head: 'none' as const }), evidenceRefs: [ref], factualRelation: { fromConceptId: a, toConceptId: b, type, evidenceRefs: [ref] } },
      { from: b, to: c, label: RELATION_ARROWS.causes.verb, evidenceRefs: [ref], factualRelation: { fromConceptId: b, toConceptId: c, type: 'causes', evidenceRefs: [ref] } },
    ],
  };
};
const mention = (id: string, startMs: number): ResolvedMention => ({ sceneId: 'synthetic', mentionId: id, startMs, endMs: startMs + 300, ambiguous: false, wordRange: [0, 1] });

test('every relation type has an arrow verb; only symmetric relations drop the one-way head', () => {
  assert.deepEqual(Object.keys(RELATION_ARROWS).sort(), [...RELATION_TYPES].sort());
  assert.deepEqual(Object.entries(RELATION_ARROWS).filter(([, arrow]) => !arrow.directed).map(([type]) => type).sort(), ['compares', 'opposes']);
});

for (const words of [['heat', 'pressure', 'volume'], ['tariff', 'price', 'demand']] as Array<[string, string, string]>) {
  test(`a comparison arrow is drawn without a head and its label sits clear of the nodes (${words[0]})`, () => {
    const laidOut = layoutScene(resolveScene(scene(words, 'compares')));
    const [comparison, causal] = laidOut.edges;
    assert.equal(comparison!.head, 'none');
    for (const edge of laidOut.edges) {
      assert.ok(edge.labelBox, 'layout places every edge label');
      for (const element of laidOut.elements) {
        const box: BBox = edge.labelBox!;
        const other: BBox = element.bbox;
        assert.ok(!(box.x < other.x + other.w && other.x < box.x + box.w && box.y < other.y + other.h && other.y < box.y + box.h), `${edge.from}->${edge.to} label overlaps ${element.id}`);
      }
    }
    const endMs = 12_000;
    const timeline = compileTimelineFull(laidOut, words.map((word, i) => mention(word, 500 + i * 1500)), 0, endMs);
    const svg = renderSceneBody(laidOut, timeline, endMs - 1);
    assert.match(svg, />COMPARED WITH<\/text>/);
    assert.match(svg, />CAUSES<\/text>/);
    assert.ok(causal!.head === undefined);
  });
}

test('an arrow cannot be pulled before its source when no relation window remains', () => {
  const laidOut = layoutScene(resolveScene(scene(['alpha', 'beta', 'gamma'], 'causes')));
  const endMs = 4000;
  assert.throws(() => compileTimelineFull(laidOut, [mention('alpha', 100), mention('beta', 3990), mention('gamma', 3995)], 0, endMs), /cannot fit after its source reveal/);
});

test('a relation may not violate source order when a short scene has no remaining relation window', () => {
  const laidOut = layoutScene(resolveScene(scene(['alpha', 'beta', 'gamma'], 'causes')));
  // Behaviour change: a dense short scene now draws faster (density scale), so 600 ms can hold the relations; the
  // invariant stays that an arrow never starts before its source has finished appearing.
  const squeezed = compileTimelineFull(laidOut, [mention('alpha', 0), mention('beta', 50), mention('gamma', 100)], 0, 600);
  for (const edge of squeezed.events.filter((event) => event.track === 'edge')) {
    const source = squeezed.events.find((event) => event.track !== 'edge' && event.elementId === edge.elementId.split('->')[0]);
    assert.ok(source && edge.t0 >= source.t1 - 1, 'arrow starts after its source reveal');
  }
  assert.throws(() => compileTimelineFull(laidOut, [mention('alpha', 0), mention('beta', 5), mention('gamma', 10)], 0, 40), /cannot fit after its source reveal/);
  const roomy = compileTimelineFull(laidOut, [mention('alpha', 500), mention('beta', 4500), mention('gamma', 8500)], 0, 15_000);
  const sparse = { ...laidOut, occupancy: STYLE.occupancy.sparse / 2 };
  assert.ok(runClaudeGates(sparse, roomy).failures.some((failure) => failure.code === 'board-too-sparse'));
});
