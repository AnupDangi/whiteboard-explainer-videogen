import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceBundle, evidenceHitBudget, instructionClauses } from '../intake/sourceBundle.js';
import { sourceDocFromText } from '../intake/sourceDoc.js';
import { orderSectionsByPrerequisites } from '../plan/contracts.js';

test('evidence budget grows with lesson length and is capped', () => {
  assert.equal(evidenceHitBudget(60), 12);
  assert.ok(evidenceHitBudget(300) > evidenceHitBudget(60));
  assert.equal(evidenceHitBudget(3600), 50);
});

test('an instruction with several asks yields one clause per ask', () => {
  const clauses = instructionClauses('List every component of the machine, explain the scoring formula step by step, and state how many stages it stacks.');
  assert.equal(clauses.length, 3);
});

test('every clause of the instruction gets its own evidence even when one topic dominates the document', () => {
  const dominant = Array.from({ length: 30 }, (_, i) => `The widget assembly line moves widget number ${i} through the widget assembly station carefully.`).join('\n\n');
  const rare = 'The calibration formula divides the measured gap by a constant factor.\n\nThe machine repeats the same stage exactly nine times in a stack.';
  const doc = sourceDocFromText(`${dominant}\n\n${rare}`, 'text');
  const { sourceBundle } = buildSourceBundle([doc], 'Explain the widget assembly line, the calibration formula, and how many times the stage repeats in a stack.', { topK: 6 });
  const texts = sourceBundle.evidenceHits.map((hit) => hit.text).join(' | ');
  assert.match(texts, /calibration formula/);
  assert.match(texts, /nine times/);
  assert.equal(sourceBundle.evidenceHits.length, 6);
});

test('sections are reordered only where a prerequisite is taught later; recaps stay last', () => {
  const graph = { concepts: [], relations: [], prerequisites: [{ concept: 'multi_head', needs: 'scaled_dot' }] } as never;
  const section = (id: string, kind: string, conceptIds: string[]) => ({ id, kind, conceptIds });
  const ordered = orderSectionsByPrerequisites([section('a', 'explain', ['multi_head']), section('r', 'recap', ['multi_head', 'scaled_dot']), section('b', 'explain', ['scaled_dot'])], graph);
  assert.deepEqual(ordered.map((item) => item.id), ['b', 'a', 'r']);
  const unchanged = orderSectionsByPrerequisites([section('x', 'explain', ['scaled_dot']), section('y', 'explain', ['multi_head'])], graph);
  assert.deepEqual(unchanged.map((item) => item.id), ['x', 'y']);
});

import { fitBudgetsToTarget } from '../plan/analyze.js';

test('section budgets are fitted to the lesson target one second at a time within the scene bounds', () => {
  const sections = [{ id: 'a', budgetSec: 20, claims: 2 }, { id: 'b', budgetSec: 20, claims: 1 }, { id: 'c', budgetSec: 20, claims: 1 }];
  const claims = (section: { claims: number }) => section.claims;
  const up = fitBudgetsToTarget(sections, 70, claims);
  assert.equal(up.reduce((sum, section) => sum + section.budgetSec, 0), 70);
  assert.ok(up[0]!.budgetSec >= up[1]!.budgetSec, 'the section with the most claims per second receives the seconds first');
  const down = fitBudgetsToTarget(sections, 50, claims);
  assert.equal(down.reduce((sum, section) => sum + section.budgetSec, 0), 50);
  assert.ok(down.every((section) => section.budgetSec >= 10));
});

import { LessonBibleSchema, TeachingPlanDraftSchema } from '../plan/schemas.js';

test('the lesson bible holds the concepts of a long lesson (up to 48), not only 14', () => {
  const concept = (index: number) => ({ conceptId: `concept_${index}`, label: `Concept ${index}` });
  const bible = { audience: 'student', terminology: Array.from({ length: 30 }, (_, index) => concept(index)), persistentConceptIds: Array.from({ length: 30 }, (_, index) => `concept_${index}`) };
  assert.ok(LessonBibleSchema.safeParse(bible).success);
});

test('over-long recap and intro prose is shortened instead of failing the plan', () => {
  const long = 'word '.repeat(60).trim();
  const parsed = TeachingPlanDraftSchema.safeParse({ targetDurationSec: 18, intro: { sourceTitle: long, sections: [long] }, recap: { keyPoints: [long] }, sections: [] });
  assert.ok(parsed.success || !JSON.stringify(parsed.error.issues).match(/recap|intro/), parsed.success ? '' : JSON.stringify(parsed.error.issues));
});

import { ConceptGraphSchema } from '../plan/schemas.js';

test('an unknown concept kind or level takes the neutral default instead of failing the concept graph', () => {
  const parsed = ConceptGraphSchema.safeParse({
    concepts: [{ id: 'a_b', label: 'Thing', kind: 'component', definition: 'x', evidence: [{ spanId: 'span_1', quote: 'q' }], level: 'advanced' }],
    relations: [], prerequisites: [],
  });
  assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
  if (parsed.success) { assert.equal(parsed.data.concepts[0]!.kind, 'entity'); assert.equal(parsed.data.concepts[0]!.level, 'one-step'); }
});

import { uniquifyClaimIds } from '../plan/contracts.js';

test('claim ids reused by a later module are made unique, including the section\'s own intents', () => {
  const section = (id: string, claimId: string) => ({ id, title: 't', goal: 'g', kind: 'explain', conceptIds: ['a'], budgetSec: 18, contract: { essentialClaims: [{ id: claimId, statement: 's', conceptIds: ['a'], relations: [], evidenceSpanIds: ['x'] }], semanticVisualIntents: [{ claimId, conceptType: 'cause', strategy: 'topology', conceptIds: ['a'], roles: [] }] } });
  const taken = new Set<string>();
  const first = uniquifyClaimIds({ sections: [section('m1', 'six_layers')] } as never, taken);
  const second = uniquifyClaimIds({ sections: [section('m2', 'six_layers')] } as never, taken);
  assert.equal(first.sections[0]!.contract!.essentialClaims[0]!.id, 'six_layers');
  const renamed = second.sections[0]!.contract!;
  assert.equal(renamed.essentialClaims[0]!.id, 'six_layers_2');
  assert.equal(renamed.semanticVisualIntents![0]!.claimId, 'six_layers_2');
});
