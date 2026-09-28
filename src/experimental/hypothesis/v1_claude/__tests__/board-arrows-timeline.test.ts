import test from 'node:test';
import assert from 'node:assert/strict';
import type { BBox, Edge, ResolvedMention, SceneSpec } from '../types.js';
import { RELATION_ARROWS } from '../config.js';
import { RELATION_TYPES } from '../plan/schemas.js';
import { resolveScene } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { renderSceneBody } from '../render/renderScene.js';
import { runClaudeGates, timelineVisibilityFailures } from '../validation/gates.js';
import { STYLE } from '../style.js';

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

test('an arrow between nodes drawn at the very end is pulled back so it is visible; a zero-length reveal fails', () => {
  const laidOut = layoutScene(resolveScene(scene(['alpha', 'beta', 'gamma'], 'causes')));
  const endMs = 4000;
  const timeline = compileTimelineFull(laidOut, [mention('alpha', 100), mention('beta', 3990), mention('gamma', 3995)], 0, endMs);
  assert.deepEqual(timelineVisibilityFailures(laidOut, timeline).filter((failure) => failure.message.includes('relation')), []);
  const squeezed = { ...timeline, events: timeline.events.map((event) => (event.elementId === 'gamma' && event.track !== 'emphasis' ? { ...event, t0: endMs, t1: endMs } : event)) };
  assert.ok(timelineVisibilityFailures(laidOut, squeezed).some((failure) => failure.code === 'reveal-invisible' && failure.message.includes('gamma')));
});

test('reveals sped up to fit a short scene are reported; a nearly empty frame is a hard failure', () => {
  const laidOut = layoutScene(resolveScene(scene(['alpha', 'beta', 'gamma'], 'causes')));
  const rushed = compileTimelineFull(laidOut, [mention('alpha', 0), mention('beta', 50), mention('gamma', 100)], 0, 600);
  assert.ok(runClaudeGates(laidOut, rushed).warnings.some((warning) => warning.code === 'timeline-compressed'));
  const sparse = { ...laidOut, occupancy: STYLE.occupancy.sparse / 2 };
  assert.ok(runClaudeGates(sparse, rushed).failures.some((failure) => failure.code === 'board-too-sparse'));
});
