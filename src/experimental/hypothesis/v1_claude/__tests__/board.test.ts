import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { PlannerSceneInput } from '../planner/prompt.js';
import type { ScenePlanningContext } from '../planner/context.js';
import { BOARD_SCHEMA_VERSION, boardEnums, boardSchema, buildBoardPrompt, compileBoard, fallbackBoard, planBoardScene, validateBoard, type Board } from '../planner/board.js';

// Synthetic, topic-neutral scene: two inputs combine through a process into an output.
function makeScene(words: { a: string; b: string; p: string; o: string }, prefix = 'src'): PlannerSceneInput {
  const ref = (id: string, quote: string, start: number) => ({ sourceId: `${prefix}_doc`, spanId: `${prefix}_${id}`, startChar: start, endChar: start + quote.length, startLine: 1, endLine: 1, quote });
  const refs = { a: ref('a', `${words.a} enters`, 0), b: ref('b', `${words.b} enters`, 20), p: ref('p', `${words.p} combines them`, 40), o: ref('o', `${words.o} results`, 70), ap: ref('ap', `${words.a} feeds ${words.p}`, 90), bp: ref('bp', `${words.b} feeds ${words.p}`, 120), po: ref('po', `${words.p} produces ${words.o}`, 150) };
  const concept = (id: 'a' | 'b' | 'p' | 'o') => ({ id: `${prefix}_${id}`, label: words[id], kind: 'entity', definition: `${words[id]} definition`, evidenceRefs: [refs[id]] });
  const input: PlannerSceneInput = {
    sceneId: `${prefix}_scene`,
    raw: '',
    plainText: `${words.a} and ${words.b} go into ${words.p}, which makes ${words.o}.`,
    mentions: [{ id: 'm_a', phrase: words.a }, { id: 'm_b', phrase: words.b }, { id: 'm_p', phrase: words.p }, { id: 'm_o', phrase: words.o }],
    teachingContext: {
      requireEvidence: true,
      sourceId: `${prefix}_doc`,
      displayText: `${words.p} Makes ${words.o}`,
      sourceEvidenceRefs: Object.values(refs),
      concepts: (['a', 'b', 'p', 'o'] as const).map(concept),
      relations: [
        { from: `${prefix}_a`, to: `${prefix}_p`, type: 'feeds', evidenceRefs: [refs.ap] },
        { from: `${prefix}_b`, to: `${prefix}_p`, type: 'feeds', evidenceRefs: [refs.bp] },
        { from: `${prefix}_p`, to: `${prefix}_o`, type: 'produces', evidenceRefs: [refs.po] },
      ],
    },
    candidates: {
      m_a: [{ id: `lib:${words.a}`, name: words.a, score: 0.9 }, { id: 'lib:weak', name: 'weak', score: 0.2 }],
      m_b: [{ id: `lib:${words.b}`, name: words.b, score: 0.55 }],
      m_p: [],
      m_o: [{ id: `lib:${words.o}`, name: words.o, score: 0.8 }],
    },
  };
  input.planningContext = {
    lessonBible: { audience: 'general learner', terminology: [{ conceptId: `${prefix}_p`, label: words.p }], persistentConceptIds: [`${prefix}_p`] },
    sceneContract: { learningDelta: 'x', targetDurationSec: 20, requiredConceptIds: [`${prefix}_p`, `${prefix}_o`], requiredRelations: [], evidenceSpanIds: ['x'], teachingSkill: 'mechanism', candidateMechanisms: ['convergence'] },
    examples: [],
  } as unknown as ScenePlanningContext;
  return input;
}

const WORDS = { a: 'flour', b: 'water', p: 'mixing', o: 'dough' };
const scene = makeScene(WORDS);
const goodBoard = (w = WORDS, prefix = 'src'): Board => ({
  schemaVersion: BOARD_SCHEMA_VERSION,
  title: 'ignored when the heading fits',
  layout: 'convergence',
  nodes: [
    { id: 'n1', mention: 'm_a', concept: `${prefix}_a`, icon: w.a, label: w.a, role: 'input' },
    { id: 'n2', mention: 'm_b', concept: `${prefix}_b`, icon: w.b, label: w.b, role: 'input' },
    { id: 'n3', mention: 'm_p', concept: `${prefix}_p`, icon: 'label', label: w.p, role: 'process' },
    { id: 'n4', mention: 'm_o', concept: `${prefix}_o`, icon: w.o, label: w.o, role: 'output' },
  ],
});

test('board enums come only from the scene: mentions, concepts, and above-threshold candidates', () => {
  const enums = boardEnums(scene);
  assert.deepEqual(enums.mentionIds, ['m_a', 'm_b', 'm_p', 'm_o']);
  assert.deepEqual(enums.conceptIds, ['src_a', 'src_b', 'src_p', 'src_o']);
  assert.deepEqual(enums.icons, ['flour', 'water', 'dough']);
  assert.deepEqual(enums.candidatesByMention, { m_a: ['flour'], m_b: ['water'], m_p: [], m_o: ['dough'] });
  const json = JSON.stringify(z.toJSONSchema(boardSchema(enums)));
  for (const value of ['m_a', 'src_p', 'dough', 'label', 'convergence']) assert.ok(json.includes(`"${value}"`), value);
  assert.ok(!json.includes('"weak"'), 'below-threshold candidates never reach the schema');
});

test('a valid board compiles to a gated SceneSpec with data-derived evidence, arrows, and title', () => {
  const checked = validateBoard(goodBoard(), scene);
  assert.deepEqual(checked.problems, []);
  const spec = checked.spec!;
  assert.equal(spec.template, 'convergence');
  assert.equal(spec.title, 'mixing Makes dough');
  assert.deepEqual(spec.elements.map((element) => [element.id, element.prim, element.slot, element.anchor]), [
    ['n1', 'object', 'input', 'mention:m_a'], ['n2', 'object', 'input', 'mention:m_b'], ['n3', 'text', 'operator', 'mention:m_p'], ['n4', 'object', 'output', 'mention:m_o'],
  ]);
  assert.deepEqual(spec.edges.map((edge) => [edge.from, edge.to, edge.factualRelation?.type]), [['n1', 'n3', 'feeds'], ['n2', 'n3', 'feeds'], ['n3', 'n4', 'produces']]);
  assert.deepEqual(checked.iconAssets, { n1: 'lib:flour', n2: 'lib:water', n4: 'lib:dough' });
});

test('board rules reject off-candidate icons, invented label words, reused mentions, and missing relation concepts', () => {
  const bad = goodBoard();
  bad.nodes[0].icon = 'dough';
  bad.nodes[1].label = 'cold water tank';
  bad.nodes[3].mention = 'm_a';
  const problems = validateBoard(bad, scene).problems.join(' | ');
  assert.match(problems, /icon "dough" is not a candidate for mention m_a/);
  assert.match(problems, /label words \[cold, tank\]/);
  assert.match(problems, /mention m_a is used by two nodes/);
  const missing = goodBoard();
  missing.nodes = missing.nodes.filter((node) => node.concept !== 'src_b');
  assert.match(validateBoard(missing, scene).problems.join(' | '), /relation src_b -> src_p \(feeds\) must be drawn, so add a node for concept src_b/);
});

test('persistent concepts must use their canonical term, and unknown enum values fail the schema', () => {
  const renamed = goodBoard();
  renamed.nodes[2].label = 'combines';
  assert.match(validateBoard(renamed, scene).problems.join(' | '), /canonical term "mixing"/);
  const unknown = { ...goodBoard(), nodes: [{ ...goodBoard().nodes[0], icon: 'rocket' }] };
  assert.ok(validateBoard(unknown, scene).problems.some((problem) => problem.startsWith('nodes.0.icon')));
});

test('topic swap: the same board shape compiles each topic from its own data only', () => {
  const other = { a: 'sand', b: 'lime', p: 'heating', o: 'glass' };
  const otherScene = makeScene(other, 'alt');
  const first = JSON.stringify(compileBoard(goodBoard(), scene).spec);
  const second = JSON.stringify(compileBoard(goodBoard(other, 'alt'), otherScene).spec);
  for (const word of Object.values(WORDS)) assert.ok(!second.includes(word), `leaked ${word}`);
  for (const word of Object.values(other)) assert.ok(!first.includes(word), `leaked ${word}`);
  assert.deepEqual(validateBoard(goodBoard(other, 'alt'), otherScene).problems, []);
});

test('fallback board is built from data: concept-matched mentions, confident icons only, layout from relation shape', () => {
  const board = fallbackBoard(scene);
  assert.equal(board.layout, 'convergence');
  assert.deepEqual(board.nodes.map((node) => [node.concept, node.icon, node.role]), [
    ['src_a', 'flour', 'input'], ['src_b', 'label', 'input'], ['src_p', 'label', 'process'], ['src_o', 'dough', 'output'],
  ]);
  assert.equal(compileBoard(board, scene).spec.edges.length, 3);
});

test('board prompt carries the scene data and per-mention candidates, never icon ids', () => {
  const prompt = buildBoardPrompt(scene);
  assert.match(prompt.user, /"iconSuggestions": \[\s*"flour"\s*\]/);
  assert.match(prompt.user, /"mustShow"/);
  assert.ok(!prompt.user.includes('lib:flour'));
  assert.match(prompt.system, /illustrative, not about this lesson/);
});

test('planBoardScene repairs once on a rule violation and returns the compiled scene with icon pins', async () => {
  const replies = [{ ...goodBoard(), nodes: goodBoard().nodes.map((node, i) => (i === 0 ? { ...node, icon: 'water' } : node)) }, goodBoard()];
  let calls = 0;
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(replies[calls++]) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 40, cost: 0.001 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await planBoardScene(scene, { model: 'test/board', apiKey: 'test-only', remainingBudgetUsd: 0.05, fetcher });
  assert.equal(calls, 2);
  assert.equal(result.fallback, false);
  assert.equal(result.usage.repairs, 1);
  assert.equal(result.spec?.template, 'convergence');
  assert.equal(result.iconAssets?.n1, 'lib:flour');
});

test('with an icon catalog, any catalog icon is admissible (a metaphor), off-catalog names fail, suggestions stay hints', () => {
  const withCatalog: PlannerSceneInput = { ...scene, iconCatalog: [{ id: 'lib:flour', name: 'flour' }, { id: 'lib:water', name: 'water' }, { id: 'lib:dough', name: 'dough' }, { id: 'lib:robot', name: 'robot' }] };
  const enums = boardEnums(withCatalog);
  assert.deepEqual(enums.icons, ['flour', 'water', 'dough', 'robot']);
  const metaphor = goodBoard();
  metaphor.nodes[2].icon = 'robot';
  const checked = validateBoard(metaphor, withCatalog);
  assert.deepEqual(checked.problems, []);
  assert.equal(checked.iconAssets?.n3, 'lib:robot');
  const offCatalog = goodBoard();
  offCatalog.nodes[2].icon = 'rocket';
  assert.ok(validateBoard(offCatalog, withCatalog).problems.some((problem) => problem.startsWith('nodes.2.icon')));
  assert.match(buildBoardPrompt(withCatalog).system, /Icon catalog \(4 hand-drawn icons, one visual family\):\nflour, water, dough, robot/);
});
