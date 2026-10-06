import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverVisualVocabulary, probeDepiction, vocabularyPromptBlock } from '../planner/visualDiscovery.js';
import { allCatalogEntries } from '../assets/semantic.js';
import { TeachingPlanDraftSchema, type ConceptGraph } from '../plan/schemas.js';
import { deriveTeachingPlan } from '../plan/contracts.js';

const concept = (id: string, label: string, kind: string, definition = 'd') => ({ id, label, kind, definition, evidence: [{ spanId: 's1', quote: 'q' }], level: 'one-step' });

test('probe: exact icon, reviewed metaphor, diagram recipe and label are decided by data, deterministically', () => {
  const catalog = allCatalogEntries();
  const exact = catalog.find((entry) => entry.source.startsWith('assetlab-sketchy-downshift:'))!;
  const icon = probeDepiction({ id: 'c1', label: exact.names[0]!, kind: 'entity' }, { catalog });
  assert.equal(icon.kind, 'icon');
  assert.notEqual(probeDepiction({ id: 'c1-process', label: exact.names[0]!, kind: 'process' }, { catalog }).kind, 'icon', 'literal pictures are reserved for canonical entities');
  const metaphor = probeDepiction({ id: 'c2', label: 'a bottleneck', kind: 'process' }, { catalog });
  assert.equal(metaphor.kind, 'metaphor');
  const plain = probeDepiction({ id: 'c3', label: 'quarterly synergy', kind: 'quantity' }, { catalog });
  assert.deepEqual(plain, { kind: 'labelled' });
  assert.deepEqual(probeDepiction({ id: 'c4', label: 'x', kind: 'formula' }, { catalog }), { kind: 'exact', renderer: 'math' });
  assert.deepEqual(probeDepiction({ id: 'c5', label: 'quarterly synergy', kind: 'process' }, { catalog, topologyHint: 'cycle' }), { kind: 'topology', topology: 'cycle' });
  assert.deepEqual(probeDepiction({ id: 'c2', label: 'a bottleneck', kind: 'process' }, { catalog }), metaphor);
});

test('discovery validates candidates for concrete concepts lacking an exact icon and never leaks asset ids into prompts', async () => {
  const graph = { concepts: [concept('c1', 'quarterly synergy widget', 'entity'), concept('c2', 'a bottleneck', 'process'), concept('c3', 'unmapped process term', 'process')], relations: [], prerequisites: [] } as unknown as ConceptGraph;
  const draft = TeachingPlanDraftSchema.parse({
    targetDurationSec: 18, intro: { sourceTitle: 'x', sections: [] }, recap: { keyPoints: [] },
    sections: [{ id: 's1', title: 'T', goal: 'G.', kind: 'explain', conceptIds: ['c1', 'c2', 'c3'], budgetSec: 18, teachingSkill: 'mechanism', candidateMechanisms: ['chain'], essentialClaims: [{ id: 'k', statement: 'Widget meets bottleneck and an unmapped process term.', conceptIds: ['c1', 'c2', 'c3'], relations: [], evidenceSpanIds: ['s1'] }] }],
  });
  const plan = deriveTeachingPlan(draft, graph, 'learner');
  const catalogEntry = allCatalogEntries().find((entry) => entry.source.startsWith('assetlab-sketchy-downshift:'))!;
  let directed: string[] = [];
  const result = await discoverVisualVocabulary({
    plan, graph, model: 'm', apiKey: 'k', remainingBudgetUsd: 1,
    rank: async (queries) => new Map(queries.map((query) => [query.trim().toLowerCase(), [{ id: catalogEntry.id, name: catalogEntry.names[0]!, score: 0.9 }]])),
    // The director proposes drawable nouns; code resolves them by exact name. A noun the library lacks yields no icon.
    judge: async ({ pairs }) => ({ approved: new Set(pairs.map((pair) => `${pair.referent}\u0000${pair.picture}`)), usage: { calls: 1, promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0, repairs: 0 }, failures: [] }),
    direct: async ({ items }) => { directed = items.map((item) => item.referent); return { nouns: new Map(items.map((item) => [item.referent, item.referent.includes('widget') ? ['not-in-library', catalogEntry.names[0]!] : []])), usage: { calls: 1, promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0, repairs: 0 }, failures: [] }; },
  });
  assert.deepEqual(directed, ['quarterly synergy widget'], 'only a concrete entity without an exact icon or reviewed metaphor is directed');
  assert.equal(result.validatedByConcept.c1, catalogEntry.id);
  const vocabulary = result.vocabularies.s1!;
  assert.equal(vocabulary.concepts.find((entry) => entry.conceptId === 'c1')!.depiction.kind, 'icon');
  assert.equal(vocabulary.concepts.find((entry) => entry.conceptId === 'c2')!.depiction.kind, 'metaphor');
  assert.equal(vocabulary.concepts.find((entry) => entry.conceptId === 'c3')!.depiction.kind, 'labelled');
  const block = vocabularyPromptBlock(vocabulary);
  assert.doesNotMatch(block, new RegExp(catalogEntry.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(block, /bottleneck/);
  assert.match(block, /real term "bottleneck"/);
});

test('a failing validator degrades to labels with a soft failure, never a crash', async () => {
  const graph = { concepts: [concept('c1', 'quarterly synergy widget', 'entity')], relations: [], prerequisites: [] } as unknown as ConceptGraph;
  const plan = deriveTeachingPlan(TeachingPlanDraftSchema.parse({ targetDurationSec: 18, intro: { sourceTitle: 'x', sections: [] }, recap: { keyPoints: [] }, sections: [{ id: 's1', title: 'T', goal: 'G.', kind: 'explain', conceptIds: ['c1'], budgetSec: 18, teachingSkill: 'definition', candidateMechanisms: ['focus'], essentialClaims: [{ id: 'k', statement: 'Widget exists.', conceptIds: ['c1'], relations: [], evidenceSpanIds: ['s1'] }] }] }), graph, 'learner');
  const result = await discoverVisualVocabulary({ plan, graph, model: 'm', apiKey: 'k', remainingBudgetUsd: 1, rank: async () => { throw new Error('embedding model unavailable'); } });
  assert.equal(result.vocabularies.s1!.concepts[0]!.depiction.kind, 'labelled');
  assert.ok(result.failures.some((failure) => failure.code === 'visual-discovery-degraded' && !failure.hard));
});
