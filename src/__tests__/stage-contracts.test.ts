import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTeachingPlan, teachingContractFindings } from '../plan/contracts.js';
import { TeachingPlanDraftSchema, TeachingPlanSchema, type ConceptGraph, type TeachingPlan, type TeachingPlanDraft } from '../plan/schemas.js';
import { buildConceptGraph, buildTeachingPlan, writeScript, validateSceneText, materializeClaimSpans } from '../plan/stages.js';
import { buildNarrationScene } from '../narration/markers.js';
import { resolveSourceEvidence, sourceDocFromText, spanExcerptPrompt } from '../intake/sourceDoc.js';

const response = (payload: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0001 } }), { status: 200 });

// Two unrelated synthetic vocabularies through the same derivation (topic-swap rule).
for (const words of [{ a: 'heat', b: 'pressure', c: 'volume' }, { a: 'tariff', b: 'price', c: 'demand' }]) {
  const doc = sourceDocFromText(`# Notes\n\n${words.a} raises ${words.b}.\n\n${words.b} lowers ${words.c}.`, 'markdown');
  const [first, second] = doc.spans.filter((span) => span.kind === 'paragraph');
  const ref = (span: typeof first, quote: string) => resolveSourceEvidence(doc, span.id, quote)!;
  const graph: ConceptGraph = {
    concepts: [
      { id: words.a, label: words.a, kind: 'entity', definition: `${words.a}.`, evidence: [ref(first, words.a)], level: 'one-step' },
      { id: words.b, label: words.b, kind: 'quantity', definition: `${words.b}.`, evidence: [ref(first, words.b), ref(second, words.b)], level: 'one-step' },
      { id: words.c, label: words.c, kind: 'quantity', definition: `${words.c}.`, evidence: [ref(second, words.c)], level: 'one-step' },
    ],
    relations: [
      { from: words.a, to: words.b, type: 'causes', evidence: [ref(first, `${words.a} raises ${words.b}`)] },
      { from: words.b, to: words.c, type: 'opposes', evidence: [ref(second, `${words.b} lowers ${words.c}`)] },
    ],
    prerequisites: [],
  };
  const section = (id: string, conceptIds: string[]) => ({ id, title: `About ${id}`, goal: `Explain ${id}.`, kind: 'explain' as const, conceptIds, budgetSec: 18, teachingSkill: 'mechanism' as const, candidateMechanisms: ['chain' as const], essentialClaims: [{ id: `${id}_claim`, statement: `Explain ${conceptIds[0]}.`, conceptIds: [conceptIds[0]], relations: [], evidenceSpanIds: [conceptIds[0] === words.c ? second.id : first.id] }] });
  const draft = (sections: TeachingPlanDraft['sections']): TeachingPlanDraft => ({ targetDurationSec: 36, intro: { sourceTitle: 'Notes', sections: [] }, sections, recap: { keyPoints: [] } });

  test(`contracts are derived from co-sectioned concepts and the graph (${words.a})`, () => {
    const plan = deriveTeachingPlan(draft([section('s1', [words.a, words.b]), section('s2', [words.b, words.c])]), graph, 'general learner');
    assert.equal(TeachingPlanSchema.safeParse(plan).success, true);
    assert.deepEqual(plan.sections.map((s) => s.contract!.requiredRelations.map((r) => `${r.from}>${r.to}`)), [[`${words.a}>${words.b}`], [`${words.b}>${words.c}`]]);
    assert.deepEqual(plan.sections[1].contract!.evidenceSpanIds.sort(), [first.id, second.id].sort(), 'concept and relation spans');
    assert.deepEqual(plan.lessonBible!.persistentConceptIds, [words.b], 'only the concept taught twice is persistent');
    assert.deepEqual(plan.lessonBible!.terminology.map((t) => t.label), [words.a, words.b, words.c], 'terms are exact graph labels');
    assert.deepEqual(teachingContractFindings(plan, graph, 'general learner'), []);
  });

  test(`essential claim evidence includes every linked concept and relation span (${words.a})`, () => {
    const claimSection: TeachingPlanDraft['sections'][number] = section('claim_evidence', [words.a, words.b]);
    claimSection.essentialClaims = [{ id: 'linked_claim', statement: `${words.a} raises ${words.b}.`, conceptIds: [words.a, words.b], relations: [{ from: words.a, to: words.b, type: 'causes' }], evidenceSpanIds: [first.id] }];
    const plan = deriveTeachingPlan(draft([claimSection]), graph, 'general learner');
    assert.deepEqual(plan.sections[0]!.contract!.essentialClaims[0]!.evidenceSpanIds.sort(), [...new Set([first.id, second.id])].sort());
  });

  test(`splitting related concepts into separate sections still fails as a lost relation (${words.a})`, () => {
    const plan = deriveTeachingPlan(draft([section('s1', [words.a]), section('s2', [words.b, words.c])]), graph, 'general learner');
    assert.deepEqual(teachingContractFindings(plan, graph, 'general learner').map((f) => f.code), ['LESSON_OMITS_SOURCE_RELATION']);
  });

  test(`an unknown concept id is kept and rejected, never dropped (${words.a})`, () => {
    const plan = deriveTeachingPlan(draft([section('s1', [words.a, words.b, 'invented']), section('s2', [words.b, words.c])]), graph, 'general learner');
    assert.ok(teachingContractFindings(plan, graph, 'general learner').some((f) => f.code === 'REQUIRED_CONCEPT_UNKNOWN'));
  });

  test(`essential claim IDs, links, and source evidence cannot be forged (${words.a})`, () => {
    const plan = deriveTeachingPlan(draft([section('s1', [words.a, words.b]), section('s2', [words.b, words.c])]), graph, 'general learner');
    const claim = plan.sections[0].contract!.essentialClaims[0];
    assert.deepEqual(teachingContractFindings(plan, graph), []);
    plan.sections[1].contract!.essentialClaims[0].id = claim.id;
    assert.ok(teachingContractFindings(plan, graph).some((f) => f.code === 'ESSENTIAL_CLAIM_DUPLICATE'));
    plan.sections[1].contract!.essentialClaims[0].id = 's2_claim';
    claim.conceptIds = [words.c];
    assert.ok(teachingContractFindings(plan, graph).some((f) => f.code === 'ESSENTIAL_CLAIM_CONCEPT'));
    claim.conceptIds = [words.a];
    claim.evidenceSpanIds = [second.id];
    assert.ok(teachingContractFindings(plan, graph).some((f) => f.code === 'ESSENTIAL_CLAIM_EVIDENCE'));
  });
}

test('S4 exact claim spans are code-offset into marker-stripped speech and reject missing, duplicate, and forged text', () => {
  const raw = 'A [[a|warm cup]] transfers heat to a [[b|cool cup]]. [[c|Heat]] moves. [[d|Both cups]] change.';
  const section: TeachingPlan['sections'][number] = { id: 's1', title: 'Heat', goal: 'Heat moves', kind: 'explain', conceptIds: ['heat'], budgetSec: 15, contract: { learningDelta: 'Heat moves', targetDurationSec: 15, requiredConceptIds: ['heat'], requiredRelations: [], evidenceSpanIds: ['span'], essentialClaims: [{ id: 'heat_transfer', statement: 'Heat moves', conceptIds: ['heat'], relations: [], evidenceSpanIds: ['span'] }], teachingSkill: 'mechanism', candidateMechanisms: ['chain'] } };
  const claimSpans = [{ claimId: 'heat_transfer', exactText: 'warm cup transfers heat to a cool cup' }];
  const scene = buildNarrationScene('s1', 's1', raw, claimSpans);
  assert.equal(scene.plainText.slice(scene.claimSpans![0].plainStart, scene.claimSpans![0].plainEnd), claimSpans[0].exactText);
  assert.ok(validateSceneText(raw, section, []).some((p) => /needs exactly one spoken span/.test(p)));
  assert.ok(validateSceneText(raw, section, [...claimSpans, ...claimSpans]).some((p) => /needs exactly one spoken span/.test(p)));
  assert.ok(validateSceneText(raw, section, [{ claimId: 'wrong', exactText: 'warm cup' }]).some((p) => /unknown spoken claim/.test(p)));
  assert.ok(validateSceneText(raw, section, [{ claimId: 'heat_transfer', exactText: 'invented words' }]).some((p) => /occur exactly once/.test(p)));
  assert.throws(() => buildNarrationScene('s1', 's1', 'heat and heat', [{ claimId: 'x', exactText: 'heat' }]), /occur exactly once/);
});

test('S4 sentence selectors materialize exact spoken text across markers', () => {
  const text = 'First, [[heat|heat]] moves into the [[cup|cup]]. Then [[water|water]] gets warmer while [[air|air]] stays cool.';
  const spans = materializeClaimSpans(text, [{ claimId: 'transfer', sentenceIndex: 0 }, { claimId: 'effect', sentenceIndex: 1 }]);
  assert.deepEqual(spans, [
    { claimId: 'transfer', exactText: 'First, heat moves into the cup.' },
    { claimId: 'effect', exactText: 'Then water gets warmer while air stays cool.' },
  ]);
  const scene = buildNarrationScene('s1', 's1', text, spans);
  for (const span of scene.claimSpans!) assert.equal(scene.plainText.slice(span.plainStart, span.plainEnd), span.exactText);
  assert.throws(() => materializeClaimSpans(text, [{ claimId: 'transfer', exactText: 'Heat enters the cup.' }]), /occur exactly once/);
  // A quote that disagrees with the selected index no longer fails the script: the sentence it names (or, with none, the
  // selected index) stands, and claim-coverage gates report a wrong pick.
  assert.deepEqual(materializeClaimSpans(text, [{ claimId: 'effect', sentenceIndex: 0, exactText: 'Then water gets warmer while air stays cool.' }]), [{ claimId: 'effect', exactText: 'Then water gets warmer while air stays cool.' }]);
  assert.deepEqual(materializeClaimSpans(text, [{ claimId: 'transfer', sentenceIndex: 1, exactText: 'moves into the cup' }]), [{ claimId: 'transfer', exactText: 'First, heat moves into the cup.' }]);
  assert.deepEqual(materializeClaimSpans(text, [{ claimId: 'transfer', sentenceIndex: 0, exactText: 'Entirely unrelated words.' }]), [{ claimId: 'transfer', exactText: 'First, heat moves into the cup.' }]);
  assert.throws(() => materializeClaimSpans(text, [{ claimId: 'transfer', sentenceIndex: 2 }]), /outside spoken text/);
});

test('S4 stores a provider sentence selector as a verbatim public claim span', async () => {
  const doc = sourceDocFromText('Heat moves into cool water. The water becomes warmer.', 'text');
  const span = doc.spans[0]!;
  const section: TeachingPlan['sections'][number] = { id: 's1', title: 'Transfer', goal: 'Explain heat transfer', kind: 'explain', conceptIds: ['heat'], budgetSec: 15, contract: { learningDelta: 'Explain heat transfer', targetDurationSec: 15, requiredConceptIds: ['heat'], requiredRelations: [], evidenceSpanIds: [span.id], essentialClaims: [{ id: 'transfer', statement: 'Heat moves into cool water.', conceptIds: ['heat'], relations: [], evidenceSpanIds: [span.id] }], teachingSkill: 'mechanism', candidateMechanisms: ['chain'] } };
  const plan: TeachingPlan = { targetDurationSec: 15, intro: { sourceTitle: 'Notes', sections: [] }, sections: [section], recap: { keyPoints: [] } };
  const text = 'Watch [[heat|heat]] move into [[water|cool water]]. The [[water_change|water]] becomes [[warmer|warmer]] as energy arrives. This change tells you which way the heat traveled, from the warmer place toward the cooler one.';
  const result = await writeScript({ source: doc.text, sourceDoc: doc, targetDurationSec: 15 }, { concepts: [], relations: [], prerequisites: [] }, plan, {
    model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05,
    fetcher: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.match(request.messages[0].content, /CLAIM COVERAGE \(required\)/);
      assert.match(request.messages[0].content, /both endpoints and their relationship/);
      return response({ text, claimSpans: [{ claimId: 'transfer', sentenceIndex: 0 }] });
    },
  });
  assert.equal(result.failures.filter((failure) => failure.hard).length, 0);
  assert.equal(result.value?.scenes[0]?.claimSpans?.[0]?.exactText, 'Watch heat move into cool water.');
});
test('word budget compares rounded bounds: an exact-boundary count passes', () => {
  // 12s at 2.25 words/s = 27 words; tolerance band rounds to 16-38.
  // A 38-word script hit the displayed max but failed the unrounded 37.8
  // bound (live spaced-repetition run). The check must use rounded bounds.
  const words38 = ['[[a|alpha]]', '[[b|beta]]', '[[c|gamma]]', '[[d|delta]]', ...Array.from({ length: 34 }, (_, i) => `word${i}`)].join(' ');
  // 4 markers + 34 plain = 38 spoken words (markers strip to their phrases).
  const section: TeachingPlan['sections'][number] = { id: 's1', title: 'T', goal: 'G', kind: 'explain', conceptIds: ['a'], budgetSec: 12, contract: { learningDelta: 'G', targetDurationSec: 12, requiredConceptIds: ['a'], requiredRelations: [], evidenceSpanIds: ['span'], essentialClaims: [], teachingSkill: 'mechanism', candidateMechanisms: ['chain'] } };
  assert.deepEqual(validateSceneText(words38, section), []);
  // Behaviour change (audio is the master clock): between the tolerance band and 1.8x the budget (capped at the hard
  // pacing ceiling) a longer script is accepted and reported as a lesson-level duration delta, not a scene failure.
  const words39 = `${words38} extra`;
  assert.deepEqual(validateSceneText(words39, section), []);
  const words50 = `${words38} ${Array.from({ length: 12 }, (_, i) => `more${i}`).join(' ')}`;
  assert.ok(validateSceneText(words50, section).some((p) => /needs 16-38 \(12s at 2\.25 words\/s\) — cut at least 12 words/.test(p)));
  const short = 'Just a few words here now.';
  assert.ok(validateSceneText(short, section).some((p) => /add at least 10 words/.test(p)));
});

test('the S3 draft schema lifts model-owned fields from an older full-plan response and drops copied ones', () => {
  const parsed = TeachingPlanDraftSchema.parse({
    targetDurationSec: 18, intro: { sourceTitle: 'x', sections: [] }, recap: { keyPoints: [] },
    lessonBible: { audience: 'anyone', domain: 'physics', terminology: [], persistentConceptIds: [] },
    sections: [{ id: 's1', title: 't', goal: 'g', kind: 'explain', conceptIds: ['a'], budgetSec: 18, contract: { teachingSkill: 'process', candidateMechanisms: ['cycle'], requiredRelations: [{ from: 'a', to: 'b', type: 'contains' }], essentialClaims: [{ id: 'claim', statement: 'x', conceptIds: ['a'], relations: [], evidenceSpanIds: ['span'] }] } }],
  });
  assert.equal(parsed.domain, 'physics');
  assert.deepEqual([parsed.sections[0].teachingSkill, parsed.sections[0].candidateMechanisms], ['process', ['cycle']]);
  assert.equal(parsed.sections[0].essentialClaims[0].id, 'claim');
  assert.ok(!('contract' in parsed.sections[0]));
});

test('model prompts print each span\'s text under its id with no character offsets', () => {
  const doc = sourceDocFromText('# Title\n\nFirst paragraph here.\n\nSecond paragraph here.', 'markdown');
  const payload = JSON.parse(spanExcerptPrompt(doc, { maxChars: 25 })) as { excerpts: Array<Record<string, unknown>>; omittedSpans?: number };
  assert.ok(payload.excerpts.every((excerpt) => typeof excerpt.id === 'string' && typeof excerpt.text === 'string' && !('startChar' in excerpt)));
  assert.equal(payload.excerpts[0].text, '# Title\n', 'span text is exact source bytes');
  assert.equal(payload.omittedSpans, 1, 'spans past the character budget are counted, not silently dropped');
  assert.equal(payload.excerpts.at(-1)!.excerpted, true);
});

test('module S2 checks relation evidence but not the concept quotes the syllabus replaces', async () => {
  const doc = sourceDocFromText('# Notes\n\nThe pump moves water uphill.', 'markdown');
  const span = doc.spans.find((item) => item.kind === 'paragraph')!;
  let user = '';
  const graph = (relationQuote: string) => ({
    concepts: [
      { id: 'pump', label: 'Pump', kind: 'entity', definition: 'x', evidence: [{ spanId: span.id, quote: 'a paraphrase the syllabus replaces' }], level: 'one-step' },
      { id: 'water', label: 'Water', kind: 'entity', definition: 'x', evidence: [], level: 'one-step' },
    ],
    relations: [{ from: 'pump', to: 'water', type: 'transforms', evidence: [{ spanId: span.id, quote: relationQuote }] }],
    prerequisites: [],
  });
  const bodies = [graph('pumps shift fluids'), graph('The pump moves water uphill')];
  const result = await buildConceptGraph({ source: doc.text, sourceDoc: doc, targetDurationSec: 60, conceptScope: [{ id: 'pump', label: 'Pump', definition: 'x' }, { id: 'water', label: 'Water', definition: 'x' }] }, {
    model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05,
    fetcher: async (_url, init) => { user ||= JSON.parse(String(init?.body)).messages[1].content; return response(bodies.shift()); },
  });
  assert.equal(result.usage.repairs, 1, 'the invented relation quote costs the repair');
  assert.deepEqual(result.value?.concepts.map((concept) => concept.evidence.length), [0, 0], 'concept evidence comes from the syllabus later');
  assert.equal(result.value?.relations[0].evidence[0].quote, 'The pump moves water uphill');
  assert.match(user, /"excerpts"/);
  assert.doesNotMatch(user, /startChar/);
});

test('each S4 scene sees only its own section\'s evidence spans', async () => {
  const doc = sourceDocFromText('# Notes\n\nAlpha fact sentence.\n\nBeta fact sentence.', 'markdown');
  const [alpha, beta] = doc.spans.filter((span) => span.kind === 'paragraph');
  const graph: ConceptGraph = {
    concepts: [
      { id: 'alpha', label: 'Alpha', kind: 'entity', definition: 'x', evidence: [resolveSourceEvidence(doc, alpha.id, 'Alpha fact sentence.')!], level: 'one-step' },
      { id: 'beta', label: 'Beta', kind: 'entity', definition: 'x', evidence: [resolveSourceEvidence(doc, beta.id, 'Beta fact sentence.')!], level: 'one-step' },
    ],
    relations: [], prerequisites: [],
  };
  const plan = deriveTeachingPlan({ targetDurationSec: 30, intro: { sourceTitle: 'x', sections: [] }, recap: { keyPoints: [] }, sections: [
    { id: 's_alpha', title: 'Alpha', goal: 'x', kind: 'explain', conceptIds: ['alpha'], budgetSec: 15, teachingSkill: 'definition', candidateMechanisms: ['focus'], essentialClaims: [{ id: 'alpha_claim', statement: 'Alpha fact.', conceptIds: ['alpha'], relations: [], evidenceSpanIds: [alpha.id] }] },
    { id: 's_beta', title: 'Beta', goal: 'x', kind: 'explain', conceptIds: ['beta'], budgetSec: 15, teachingSkill: 'definition', candidateMechanisms: ['focus'], essentialClaims: [{ id: 'beta_claim', statement: 'Beta fact.', conceptIds: ['beta'], relations: [], evidenceSpanIds: [beta.id] }] },
  ] }, graph, 'general learner');
  const users: string[] = [];
  await writeScript({ source: doc.text, sourceDoc: doc, targetDurationSec: 30 }, graph, plan, {
    model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05,
    fetcher: async (_url, init) => { users.push(JSON.parse(String(init?.body)).messages[1].content); return response({ text: 'x' }); },
  });
  const alphaPrompt = users.find((user) => user.includes('WRITE SCENE 1'))!;
  assert.match(alphaPrompt, /Alpha fact sentence/);
  assert.doesNotMatch(alphaPrompt.slice(alphaPrompt.indexOf('SOURCE')), /Beta fact sentence/);
});

test('a concept graph that cannot support the request never reaches the S3 model', async () => {
  let calls = 0;
  const result = await buildTeachingPlan({ source: 'x', targetDurationSec: 18, instruction: 'Explain how the parts interact.' }, { concepts: [{ id: 'only', label: 'Only', kind: 'entity', definition: 'x', evidence: [], level: 'one-step' }], relations: [], prerequisites: [] }, {
    model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05, fetcher: async () => { calls++; return response({}); },
  });
  assert.equal(calls, 0);
  assert.equal(result.failures[0]?.code, 'plan-graph-not-relational');
});

test('S4 keeps an over-long but otherwise valid draft when the model cannot shorten it, and records the pacing warning', async () => {
  const doc = sourceDocFromText('Heat moves into cool water. The water becomes warmer.', 'text');
  const span = doc.spans[0]!;
  const section: TeachingPlan['sections'][number] = { id: 's1', title: 'Transfer', goal: 'Explain heat transfer', kind: 'explain', conceptIds: ['heat'], budgetSec: 10, contract: { learningDelta: 'Explain heat transfer', targetDurationSec: 10, requiredConceptIds: ['heat'], requiredRelations: [], evidenceSpanIds: [span.id], essentialClaims: [{ id: 'transfer', statement: 'Heat moves into cool water.', conceptIds: ['heat'], relations: [], evidenceSpanIds: [span.id] }], teachingSkill: 'mechanism', candidateMechanisms: ['chain'] } };
  const plan: TeachingPlan = { targetDurationSec: 10, intro: { sourceTitle: 'Notes', sections: [] }, sections: [section], recap: { keyPoints: [] } };
  const filler = Array.from({ length: 36 }, () => 'slowly').join(' ');
  const text = `Watch [[heat|heat]] move into [[water|cool water]] and warm [[cup|the cup]] and [[air|the air]] ${filler} until it settles.`;
  const result = await writeScript({ source: doc.text, sourceDoc: doc, targetDurationSec: 10 }, { concepts: [], relations: [], prerequisites: [] }, plan, {
    model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05,
    fetcher: async () => response({ text, claimSpans: [{ claimId: 'transfer', sentenceIndex: 0 }] }),
  });
  assert.ok(result.value, 'script kept');
  assert.equal(result.failures.filter((failure) => failure.hard).length, 0);
  assert.ok(result.failures.some((failure) => failure.code === 'scene-over-budget'));
});

test('S2 drops a self-relation at once and an unanchored relation only after the model was asked once', async () => {
  const doc = sourceDocFromText('# Notes\n\nThe pump moves water uphill. The valve stops the flow.', 'markdown');
  const span = doc.spans.find((item) => item.kind === 'paragraph')!;
  const concept = (id: string) => ({ id, label: id, kind: 'entity', definition: 'x', evidence: [{ spanId: span.id, quote: 'The pump moves water uphill' }], level: 'one-step' });
  const good = { from: 'pump', to: 'water', type: 'transforms', evidence: [{ spanId: span.id, quote: 'The pump moves water uphill' }] };
  const self = { from: 'pump', to: 'pump', type: 'transforms', evidence: [{ spanId: span.id, quote: 'The pump moves water uphill' }] };
  const bad = { from: 'valve', to: 'water', type: 'opposes', evidence: [{ spanId: span.id, quote: 'a paraphrase that is not in the source' }] };
  const body = { concepts: [concept('pump'), concept('water'), concept('valve')], relations: [good, self, bad], prerequisites: [] };
  let calls = 0;
  const result = await buildConceptGraph({ source: doc.text, sourceDoc: doc, targetDurationSec: 60 }, {
    model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05,
    fetcher: async () => { calls += 1; return response(body); },
  });
  assert.equal(calls, 2, 'the unanchored relation is asked about once');
  assert.deepEqual(result.value?.relations.map((relation) => `${relation.from}>${relation.to}`), ['pump>water']);
  // Dropping a relation is a semantic change, so it is in the ledger (V2 plan 1.4), not silent.
  const dropped = result.trace.coercions.filter((entry) => entry.semanticRisk === 'semantic').map((entry) => entry.reason).sort();
  assert.deepEqual(dropped, ['self-or-duplicate-relation-dropped', 'unanchored-relation-dropped']);
});

import { normalizeClaimAnchors, trimMarkers } from '../plan/stages.js';
import { collectCoercions } from '../structured/coercionLedger.js';

test('claim anchors are completed by code: unknown and repeated ids dropped, a missing claim takes its best-matching sentence', () => {
  const plain = 'First the query meets every key. Then softmax turns scores into weights. Finally the values are summed.';
  const expected = [{ id: 'scores', statement: 'The query meets every key' }, { id: 'weights', statement: 'Softmax turns scores into weights' }];
  const anchors = normalizeClaimAnchors(plain, [{ claimId: 'scores', sentenceIndex: 0 }, { claimId: 'scores', sentenceIndex: 2 }, { claimId: 'ghost', sentenceIndex: 1 }], expected);
  assert.deepEqual(anchors, [{ claimId: 'scores', sentenceIndex: 0 }, { claimId: 'weights', sentenceIndex: 1 }]);
});

test('surplus markers are unwrapped (words kept), outside-claim markers first and the last ones first', () => {
  const raw = '[[a|Alpha]] opens. The claim names [[b|beta]] and [[c|gamma]]. Then [[d|delta]] and [[e|epsilon]] close.';
  const plainStart = 'Alpha opens. '.length;
  const claim = { plainStart, plainEnd: plainStart + 'The claim names beta and gamma.'.length };
  const trimmed = trimMarkers(raw, [claim], 3);
  assert.equal((trimmed.match(/\[\[/g) ?? []).length, 3);
  assert.match(trimmed, /\[\[b\|beta\]\]/);
  assert.match(trimmed, /\[\[c\|gamma\]\]/);
  assert.match(trimmed, /\[\[a\|Alpha\]\]/);
  assert.ok(trimmed.includes('epsilon') && !trimmed.includes('[[e|') && !trimmed.includes('[[d|'));
});

test('anchor completion and marker trimming are written to the coercion ledger', () => {
  const plain = 'First the query meets every key. Then softmax turns scores into weights. Finally the values are summed.';
  const expected = [{ id: 'scores', statement: 'The query meets every key' }, { id: 'weights', statement: 'Softmax turns scores into weights' }];
  const anchored = collectCoercions(() => normalizeClaimAnchors(plain, [{ claimId: 'scores', sentenceIndex: 0 }, { claimId: 'scores', sentenceIndex: 2 }, { claimId: 'ghost', sentenceIndex: 1 }], expected));
  const byReason = (reason: string) => anchored.entries.filter((entry) => entry.reason === reason);
  assert.equal(byReason('claim-anchor-dropped-unknown-or-repeated').length, 2);
  assert.ok(byReason('claim-anchor-dropped-unknown-or-repeated').every((entry) => entry.semanticRisk === 'semantic'));
  assert.deepEqual(byReason('claim-anchor-completed-from-best-sentence').map((entry) => [entry.path, entry.semanticRisk]), [['/claimSpans/weights', 'low']]);
  const raw = '[[a|Alpha]] opens. The claim names [[b|beta]] and [[c|gamma]]. Then [[d|delta]] and [[e|epsilon]] close.';
  const trimmed = collectCoercions(() => trimMarkers(raw, [], 3));
  assert.deepEqual(trimmed.entries.map((entry) => [entry.reason, entry.semanticRisk]), [['markers-trimmed-to-limit', 'low']]);
  assert.equal(trimmed.entries[0]!.oldValue, 5);
  assert.equal(trimmed.entries[0]!.newValue, 3);
});
