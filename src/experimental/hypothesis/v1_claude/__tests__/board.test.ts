import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { PlannerSceneInput } from '../planner/prompt.js';
import type { ScenePlanningContext } from '../planner/context.js';
import { BOARD_SCHEMA_VERSION, boardEnums, boardSchema, buildBoardPrompt, compileBoard, conceptForMention, fallbackBoard, planBoardScene, validateBoard, type Board } from '../planner/board.js';
import { safeParseSceneSpec } from '../schema.js';

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
  visual: { kind: 'process' },
  nodes: [
    { id: 'n1', mention: 'm_a', concept: `${prefix}_a`, icon: w.a, label: w.a, role: 'input' },
    { id: 'n2', mention: 'm_b', concept: `${prefix}_b`, icon: w.b, label: w.b, role: 'input' },
    { id: 'n3', mention: 'm_p', concept: `${prefix}_p`, icon: 'label', label: w.p, role: 'process' },
    { id: 'n4', mention: 'm_o', concept: `${prefix}_o`, icon: w.o, label: w.o, role: 'output' },
  ],
});

test('board enums come only from the scene: mentions, concepts, and candidates above the hint floor', () => {
  const enums = boardEnums(scene);
  assert.deepEqual(enums.mentionIds, ['m_a', 'm_b', 'm_p', 'm_o']);
  assert.deepEqual(enums.conceptIds, ['src_a', 'src_b', 'src_p', 'src_o']);
  assert.deepEqual(enums.icons, ['flour', 'water', 'dough']);
  assert.deepEqual(enums.candidatesByMention, { m_a: ['flour'], m_b: ['water'], m_p: [], m_o: ['dough'] });
  const json = JSON.stringify(z.toJSONSchema(boardSchema(enums)));
  for (const value of ['m_a', 'src_p', 'dough', 'label', 'convergence']) assert.ok(json.includes(`"${value}"`), value);
  assert.ok(!json.includes('"weak"'), 'candidates below the hint floor never reach the schema');
});

test('a valid board compiles to a gated SceneSpec with data-derived evidence, arrows, and title', () => {
  const checked = validateBoard(goodBoard(), scene);
  assert.deepEqual(checked.problems, []);
  const spec = checked.spec!;
  assert.equal(spec.template, 'convergence');
  assert.equal(spec.title, 'mixing Makes dough');
  assert.deepEqual(spec.elements.map((element) => [element.id, element.prim, element.slot, element.anchor]), [
    ['n1', 'object', 'input', 'mention:m_a'], ['n2', 'object', 'input', 'mention:m_b'], ['n3', 'box', 'operator', 'mention:m_p'], ['n4', 'object', 'output', 'mention:m_o'],
  ]);
  assert.deepEqual(spec.edges.map((edge) => [edge.from, edge.to, edge.factualRelation?.type]), [['n1', 'n3', 'feeds'], ['n2', 'n3', 'feeds'], ['n3', 'n4', 'produces']]);
  assert.deepEqual(checked.iconAssets, { n1: 'lib:flour', n2: 'lib:water', n4: 'lib:dough' });
});

test('compileBoard draws unstated generic relations as verb-less arrows but keeps stated and specific word labels (P2d)', () => {
  const cmpRef = { sourceId: 'src_doc', spanId: 'src_cmp', startChar: 300, endChar: 331, startLine: 5, endLine: 5, quote: 'flour differs from water in use' };
  const statedRef = { sourceId: 'src_doc', spanId: 'src_req', startChar: 340, endChar: 378, startLine: 6, endLine: 6, quote: 'mixing requires steady dough handling' };
  const genericScene: PlannerSceneInput = {
    ...scene,
    teachingContext: {
      ...scene.teachingContext!,
      sourceEvidenceRefs: [...scene.teachingContext!.sourceEvidenceRefs!, cmpRef, statedRef],
      relations: [
        { from: 'src_a', to: 'src_b', type: 'compares', evidenceRefs: [cmpRef] },
        { from: 'src_p', to: 'src_o', type: 'requires', evidenceRefs: [statedRef] },
      ],
    },
  };
  const { spec } = compileBoard(goodBoard(), genericScene);
  const byPair = new Map(spec.edges.map((edge) => [`${edge.from}->${edge.to}`, edge]));
  const verbLess = byPair.get('n1->n2')!;
  assert.ok(!('label' in verbLess), 'an unstated generic relation draws with no word label — the arrow carries it');
  assert.equal(verbLess.factualRelation?.type, 'compares');
  const stated = byPair.get('n3->n4')!;
  assert.equal(stated.label, 'requires', 'a source-stated generic keeps its word label');
  assert.ok(spec.edges.every((edge) => edge.factualRelation && edge.evidenceRefs?.length), 'every drawn arrow retains its relation and citation');
  assert.ok(safeParseSceneSpec(spec).success);
  assert.deepEqual(validateBoard(goodBoard(), genericScene).problems, [], 'planner and adequacy gates agree on the verb-less board');
});

test('board rules reject invented content words and missing relation concepts; another mention\'s icon is a metaphor; a shared mention is allowed', () => {
  const bad = goodBoard();
  bad.nodes[0].icon = 'dough';
  bad.nodes[1].label = 'cold water tank';
  const problems = validateBoard(bad, scene).problems.join(' | ');
  assert.doesNotMatch(problems, /icon "dough"/, 'an in-vocabulary icon off this mention\'s hints is admissible');
  assert.match(problems, /label words \[cold, tank\]/);
  const shared = goodBoard();
  shared.nodes[3].mention = 'm_p';
  shared.nodes[3].icon = 'label';
  assert.deepEqual(validateBoard(shared, scene).problems, [], 'two nodes may appear on the same spoken mention');
  const functionWord = goodBoard();
  functionWord.nodes[3].label = 'dough for';
  assert.deepEqual(validateBoard(functionWord, scene).problems, [], 'short function words may join source words');
  const missing = goodBoard();
  missing.nodes = missing.nodes.filter((node) => node.concept !== 'src_b');
  assert.match(validateBoard(missing, scene).problems.join(' | '), /relation src_b -> src_p \(feeds\) must be drawn, so add a node for concept src_b/);
});

test('persistent concepts are labelled with their canonical term by code, and unknown enum values fail the schema', () => {
  const renamed = goodBoard();
  renamed.nodes[2].label = 'mixing';
  renamed.nodes[2].icon = 'label';
  const checked = validateBoard({ ...renamed, nodes: renamed.nodes.map((node) => (node.id === 'n3' ? { ...node, label: 'mixing' } : node)) }, scene);
  assert.deepEqual(checked.problems, []);
  const persistent = checked.spec!.elements.find((element) => element.id === 'n3')!;
  assert.equal(persistent.prim === 'box' ? persistent.text : persistent.label, 'mixing');
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

test('a concept may appear as up to three labelled instances with distinct mentions', () => {
  const input = makeScene(WORDS);
  input.mentions.push({ id: 'm_a2', phrase: 'more flour' });
  const board = goodBoard();
  board.nodes.push({ id: 'n5', mention: 'm_a2', concept: 'src_a', icon: 'flour', label: 'more flour', role: 'input' });
  const { problems, spec } = validateBoard(board, input);
  assert.deepEqual(problems, []);
  const fromA = spec!.edges.filter((e) => e.factualRelation?.fromConceptId === 'src_a');
  assert.equal(fromA.length, 1);
  assert.equal(fromA[0].from, 'n1');
});

test('instances must use distinct mentions and labels, and at most three per concept', () => {
  const board = goodBoard();
  board.nodes.push({ id: 'n5', mention: 'm_a', concept: 'src_a', icon: 'flour', label: 'flour', role: 'input' });
  assert.ok(validateBoard(board, scene).problems.some((p) => p.includes('distinct mention')));
  const crowded = makeScene(WORDS);
  const extra: Array<[string, string]> = [['m_a2', 'more flour'], ['m_a3', 'fine flour'], ['m_a4', 'warm flour']];
  for (const [id, phrase] of extra) crowded.mentions.push({ id, phrase });
  const many = goodBoard();
  (['n5', 'n6', 'n7'] as const).forEach((id, i) => many.nodes.push({ id, mention: extra[i]![0], concept: 'src_a', icon: 'flour', label: extra[i]![1], role: 'input' }));
  assert.ok(validateBoard(many, crowded).problems.some((p) => p.includes('at most 3 instances')));
});

test('a process board with fewer than three nodes is rejected with a fix hint', () => {
  const board = { ...goodBoard(), layout: 'flow' as const, nodes: goodBoard().nodes.slice(2) };
  const problems = validateBoard(board, scene).problems;
  assert.ok(problems.some((p) => p.includes('at least 3 nodes')));
});

test('typed visual forms compile into the existing deterministic SceneSpec primitives', () => {
  const cases: Array<[Board['visual'], string, string]> = [
    [{ kind: 'formula', latex: '\\text{flour}' }, 'formula_focus', 'formula'],
    [{ kind: 'matrix', rows: [['flour', 'enters'], ['water', 'enters']] }, 'formula_focus', 'matrix'],
    [{ kind: 'number-line', min: 0, max: 10, ticks: 6, points: [{ x: 5, label: 'enters' }] }, 'formula_focus', 'numberLine'],
    [{ kind: 'plot', fn: 'linear', params: [1, 0], domain: [0, 1] }, 'plot_focus', 'plot'],
  ];
  for (const [visual, template, prim] of cases) {
    const board = { ...goodBoard(), visual };
    const compiled = compileBoard(board, scene);
    assert.equal(compiled.spec.template, template);
    assert.ok(compiled.spec.elements.some((element) => element.prim === prim));
    assert.ok(compiled.spec.elements.find((element) => element.prim === prim)?.evidenceRefs?.length, `${prim} inherits source evidence from its linked concepts`);
  }
});

test('typed visual lexical claims must occur in the scene source quotes', () => {
  const unsupportedMatrix: Board = { ...goodBoard(), visual: { kind: 'matrix', rows: [['invented', 'value']] } };
  assert.match(validateBoard(unsupportedMatrix, scene).problems.join(' | '), /visual matrix labels\/terms \[invented, value\] are absent/);
  const supportedMatrix: Board = { ...goodBoard(), visual: { kind: 'matrix', rows: [['flour', 'enters']] } };
  assert.ok(!validateBoard(supportedMatrix, scene).problems.some((problem) => problem.includes('visual matrix labels')));
});

test('plot and number-line geometry require every factual numeric value in source evidence', () => {
  const plot: Board = { ...goodBoard(), visual: { kind: 'plot', fn: 'linear', params: [1, 0], domain: [0, 1] } };
  assert.match(validateBoard(plot, scene).problems.join(' | '), /visual plot numeric values .*absent from the scene’s cited source evidence/);
  const line: Board = { ...goodBoard(), visual: { kind: 'number-line', min: 0, max: 10, ticks: 6, points: [{ x: 5 }] } };
  assert.match(validateBoard(line, scene).problems.join(' | '), /visual number-line numeric values .*absent from the scene’s cited source evidence/);
});

test('source-backed plot and number-line values accept decimal and scientific notation citations', () => {
  const numericRef = { sourceId: 'src_doc', spanId: 'numeric_data', startChar: 200, endChar: 245, startLine: 2, endLine: 2, quote: 'linear coefficients include 1e3, 0.5, −2, and 1' };
  const numericScene: PlannerSceneInput = {
    ...scene,
    teachingContext: {
      ...scene.teachingContext!,
      sourceEvidenceRefs: [...scene.teachingContext!.sourceEvidenceRefs!, numericRef],
      concepts: scene.teachingContext!.concepts!.map((concept) => ({ ...concept, evidenceRefs: [...concept.evidenceRefs!, numericRef] })),
    },
  };
  const plot: Board = { ...goodBoard(), visual: { kind: 'plot', fn: 'linear', params: [1000, 0.5], domain: [-2, 1] } };
  assert.deepEqual(validateBoard(plot, numericScene).problems, []);
  const line: Board = { ...goodBoard(), visual: { kind: 'number-line', min: -2, max: 1000, ticks: 6, points: [{ x: 0.5 }], interval: [-2, 1] } };
  assert.deepEqual(validateBoard(line, numericScene).problems, []);
});

test('board rejects an exact consecutive visual repeat', () => {
  const previousElements = goodBoard().nodes.map((node) => ({ id: node.id, prim: node.icon === 'label' ? 'box' : 'object', label: node.label, conceptIds: [node.concept], anchor: `mention:${node.mention}` }));
  assert.match(validateBoard(goodBoard(), { ...scene, previousElements }).problems.join(' | '), /repeats the immediately previous board/);
});

test('worked examples are arithmetically checked and visibly marked illustrative', () => {
  const example: Board = { ...goodBoard(), visual: { kind: 'worked-example', steps: [{ operands: [6, 7], operator: '×', result: 42 }] } };
  const compiled = compileBoard(example, scene);
  assert.deepEqual(validateBoard(example, scene).problems, []);
  assert.ok(compiled.spec.elements.some((element) => element.prim === 'text' && element.text === 'Illustrative example' && element.origin === 'illustrative-example'));
  const incorrect: Board = { ...example, visual: { kind: 'worked-example', steps: [{ operands: [6, 7], operator: '×', result: 41 }] } };
  assert.match(validateBoard(incorrect, scene).problems.join(' | '), /does not equal 6 × 7/);
  const divideByZero: Board = { ...example, visual: { kind: 'worked-example', steps: [{ operands: [4, 0], operator: '÷', result: 0 }] } };
  assert.match(validateBoard(divideByZero, scene).problems.join(' | '), /does not equal 4 ÷ 0/);
  const derivationSteps: Extract<Board['visual'], { kind: 'worked-example' }>['steps'] = [
    { operands: [6, 7], operator: '×', result: 42 },
    { operands: [42, 2], operator: '÷', result: 21 },
  ];
  const derivation: Board = { ...example, visual: { kind: 'worked-example', steps: [...derivationSteps] } };
  assert.equal(compileBoard(derivation, scene).spec.elements.filter((element) => element.prim === 'formula').length, 2);
  const disconnected: Board = { ...derivation, visual: { kind: 'worked-example', steps: [derivationSteps[0], { operands: [2, 3], operator: '+', result: 5 }] } };
  assert.match(validateBoard(disconnected, scene).problems.join(' | '), /does not use the prior result/);
});

test('typed comparison boards require compare layout and distinct options', () => {
  const comparison: Board = { ...goodBoard(), layout: 'compare', visual: { kind: 'comparison' }, nodes: goodBoard().nodes.slice(0, 2) };
  // Keep only source concepts needed by the selected comparison nodes.
  const comparisonScene = { ...scene, teachingContext: { ...scene.teachingContext!, relations: [] }, planningContext: undefined };
  assert.ok(validateBoard(comparison, comparisonScene).problems.every((problem) => !problem.includes('comparison form')));
  const wrongLayout = { ...comparison, layout: 'flow' as const };
  assert.ok(validateBoard(wrongLayout, comparisonScene).problems.some((problem) => problem.includes('comparison form requires compare layout')));
});

test('board prompt carries the scene data and per-mention candidates, never icon ids', () => {
  const prompt = buildBoardPrompt(scene);
  assert.match(prompt.user, /"iconSuggestions": \[\s*"flour"\s*\]/);
  assert.match(prompt.user, /"mustShow"/);
  assert.ok(!prompt.user.includes('lib:flour'));
  assert.match(prompt.system, /illustrative, not about this lesson/);
});

test('rainbow arc prompt handles many mentions for one source concept and retains process-role validation on repair', () => {
  // Mirrors the authorized rainbow lesson's source-grounded scene shape: five spoken
  // mentions all unpack one cited concept, rather than five separate concepts.
  const concept = scene.teachingContext!.concepts![0]!;
  const rainbowScene: PlannerSceneInput = {
    ...scene,
    sceneId: 'rainbow_arc_color_order',
    plainText: 'Different drops send different colors: higher raindrops send red light, while lower ones send violet. On the rainbow arc, red is outside and violet is inside.',
    mentions: [
      { id: 'higher_drops', phrase: 'higher raindrops' },
      { id: 'red_light', phrase: 'red light' },
      { id: 'rainbow_arc', phrase: 'rainbow arc' },
      { id: 'outer_edge', phrase: 'outside' },
      { id: 'inner_edge', phrase: 'inside' },
    ],
    teachingContext: {
      ...scene.teachingContext!,
      displayText: 'Red Outside, Violet Inside',
      visualIntent: 'Show one cited concept: the color order on a rainbow arc.',
      concepts: [{ ...concept, id: 'colored_arc', label: 'Rainbow arc' }],
      relations: [],
    },
    planningContext: {
      ...scene.planningContext!,
      sceneContract: { ...scene.planningContext!.sceneContract, requiredConceptIds: ['colored_arc'] },
    },
  };
  const prompt = buildBoardPrompt(rainbowScene);
  assert.match(prompt.user, /"mustShow": \[\s*"colored_arc"\s*\]/);
  assert.match(prompt.system, /up to 3 nodes when the narration names distinct instances/);
  assert.match(prompt.system, /visual\.kind "process" must include at least one node whose role is "process"/);
});

test('planBoardScene repairs once on a rule violation and returns the compiled scene with icon pins', async () => {
  const replies = [{ ...goodBoard(), nodes: goodBoard().nodes.map((node, i) => (i === 0 ? { ...node, label: 'cold flour tank' } : node)) }, goodBoard()];
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

test('with an icon catalog, any catalog icon is admissible and its basis is recorded', () => {
  const catalog = [{ id: 'lib:flour', name: 'flour' }, { id: 'lib:key', name: 'key' }, { id: 'lib:water', name: 'water' }, { id: 'lib:dough', name: 'dough' }];
  const input = { ...scene, iconCatalog: catalog } as PlannerSceneInput;
  const enums = boardEnums(input);
  assert.ok(enums.icons.includes('key'));
  const board = goodBoard();
  board.nodes[2] = { ...board.nodes[2], icon: 'key' }; // metaphor for "mixing"
  const result = validateBoard(board, input);
  assert.deepEqual(result.problems, []);
  const byId = Object.fromEntries(result.spec!.elements.map((e) => [e.id, e]));
  assert.equal(byId.n1.iconBasis, 'retrieval');
  assert.equal(byId.n3.iconBasis, 'metaphor');
});

test('icons outside the catalog are still rejected with near-name hints', () => {
  const input = { ...scene, iconCatalog: [{ id: 'lib:flour', name: 'flour' }] } as PlannerSceneInput;
  const board = goodBoard();
  board.nodes[0] = { ...board.nodes[0], icon: 'unicorn' };
  const result = validateBoard(board, input);
  assert.ok(result.problems.some((p) => p.includes('not in the icon catalog')));
});

test('prompt lists the catalog once and permits teacher metaphors', () => {
  const input = { ...scene, iconCatalog: [{ id: 'lib:key', name: 'key' }, { id: 'lib:flour', name: 'flour' }] } as PlannerSceneInput;
  const { system, user } = buildBoardPrompt(input);
  assert.match(system, /visual metaphor a teacher would sketch/);
  assert.doesNotMatch(system, /Never invent a metaphor/);
  assert.match(user, /"key"/);
  const catalogBlock = user.match(/<icon_catalog[^>]*>([\s\S]*)<\/icon_catalog>/)?.[1] ?? '';
  assert.equal(catalogBlock.split('"key"').length - 1, 1, 'the cacheable catalog block lists each name once (few-shot boards may reuse the name)');
});

test('a large catalog is admissible in full, checked in code rather than a provider enum', () => {
  const iconCatalog = Array.from({ length: 70 }, (_, i) => ({ id: `lib:icon${i}`, name: `icon${i}` }));
  const big: PlannerSceneInput = { ...scene, iconCatalog };
  const enums = boardEnums(big);
  assert.equal(enums.icons.length, 70);
  const json = JSON.stringify(z.toJSONSchema(boardSchema(enums)));
  assert.ok(!json.includes('"icon69"'), 'the provider schema carries no oversized icon enum');
  const board = goodBoard();
  for (const index of [0, 1, 3]) board.nodes[index].icon = 'label';
  board.nodes[0].icon = 'icon7';
  const checked = validateBoard(board, big);
  assert.deepEqual(checked.problems, []);
  assert.equal(checked.iconAssets?.n1, 'lib:icon7');
  assert.equal(checked.spec!.elements.find((element) => element.id === 'n1')!.iconBasis, 'metaphor');
  board.nodes[0].icon = 'icon99';
  assert.match(validateBoard(board, big).problems.join(' | '), /icon "icon99" is not in the icon catalog/);
});

test('conceptForMention matches a mention to its scene concept by id, then by shared label words', () => {
  assert.equal(conceptForMention(scene, { id: 'src_b', phrase: 'anything' })?.id, 'src_b');
  assert.equal(conceptForMention(scene, { id: 'm_x', phrase: 'the doughs rest' })?.label, 'dough');
  assert.equal(conceptForMention(scene, { id: 'm_y', phrase: 'unrelated words' }), undefined);
  assert.equal(conceptForMention({ teachingContext: undefined }, { id: 'm_a', phrase: 'flour' }), undefined);
});

test('icon labels wrap onto at most two balanced lines, so nodes stay narrow and icons can grow', async () => {
  const { labelLines, labelBlockHeight, OBJECT_LABEL_H, OBJECT_LABEL_LINE_H } = await import('../catalog/ladder.js');
  assert.deepEqual(labelLines('Leaf'), ['Leaf']);
  assert.deepEqual(labelLines('Carbon dioxide'), ['Carbon', 'dioxide']);
  assert.deepEqual(labelLines('Self-critique and revision'), ['Self-critique', 'and revision']);
  assert.equal(labelBlockHeight('Carbon dioxide'), OBJECT_LABEL_H + OBJECT_LABEL_LINE_H);
});

test('a heading with an unsupported number falls back to the checked model title', () => {
  const numbered: PlannerSceneInput = { ...scene, teachingContext: { ...scene.teachingContext!, displayText: 'Step 2: mixing Makes dough' } };
  const board = { ...goodBoard(), title: 'Mixing makes dough' };
  const checked = validateBoard(board, numbered);
  assert.equal(checked.spec?.title, 'Mixing makes dough');
  assert.deepEqual(checked.problems, []);
});

test('a heading with an unsupported number WORD falls back to the repairable model title (F1)', () => {
  const numbered: PlannerSceneInput = { ...scene, teachingContext: { ...scene.teachingContext!, displayText: 'Three mixing steps' } };
  const board = { ...goodBoard(), title: 'Mixing makes dough' };
  const checked = validateBoard(board, numbered);
  assert.equal(checked.spec?.title, 'Mixing makes dough', 'unsupported heading number must not become a code-owned title the repair loop cannot edit');
  assert.deepEqual(checked.problems, []);
  // A supported heading number stays code-owned.
  const supportedRef = { sourceId: 'src_doc', spanId: 'src_count', startChar: 300, endChar: 320, startLine: 3, endLine: 3, quote: 'the three mixing steps' };
  const supported: PlannerSceneInput = {
    ...scene,
    teachingContext: {
      ...scene.teachingContext!,
      displayText: 'Three mixing steps',
      sourceEvidenceRefs: [...scene.teachingContext!.sourceEvidenceRefs!, supportedRef],
    },
  };
  assert.equal(validateBoard(board, supported).spec?.title, 'Three mixing steps');
  // A numeric model title that lacks evidence is still strictly rejected, so the repair has a signal to fix.
  const numericBoard = { ...goodBoard(), title: 'Three mixing steps' };
  assert.match(validateBoard(numericBoard, numbered).problems.join(' | '), /numeric value "Three"/);
});

test('fallback with converging inputs but no output refuses the convergence layout (F2)', () => {
  const noOutput: PlannerSceneInput = {
    ...scene,
    teachingContext: { ...scene.teachingContext!, relations: scene.teachingContext!.relations!.slice(0, 2) },
  };
  const board = fallbackBoard(noOutput);
  assert.notEqual(board.layout, 'convergence', 'inputs+operator with no output must not claim convergence topology');
  assert.equal(board.layout, 'list');
  assert.equal(compileBoard(board, noOutput).spec.template, 'list_icon');
});

test('P2e: planned convergence without an output role downgrades to list (same rule as fallback)', async () => {
  const { resolveBoardLayout } = await import('../planner/board.js');
  const { typedBoardAdequacyFailures } = await import('../validation/gates.js');
  const planned = goodBoard();
  planned.layout = 'convergence';
  planned.nodes = planned.nodes.map((node) => (node.role === 'output' ? { ...node, role: 'input' as const } : node));
  assert.equal(resolveBoardLayout('convergence', planned.nodes), 'list');
  assert.equal(resolveBoardLayout('convergence', goodBoard().nodes), 'convergence');
  const compiled = compileBoard(planned, scene);
  assert.equal(compiled.spec.template, 'list_icon');
  assert.equal(compiled.spec.boardIntent?.layout, 'list');
  const laidOut = {
    sceneId: compiled.spec.sceneId,
    template: compiled.spec.template,
    elements: compiled.spec.elements.map((element, index) => ({
      id: element.id, element, visual: { paths: [], fills: [], texts: [] },
      intrinsicSize: { w: 20, h: 20 }, strokeLength: 0, bbox: { x: index * 30, y: 0, w: 20, h: 20 },
    })),
    edges: compiled.spec.edges.map((edge) => ({ ...edge, points: [] })),
    occupancy: 0.5, carryOver: [], focus: [], boardIntent: compiled.spec.boardIntent,
  };
  assert.deepEqual(typedBoardAdequacyFailures(laidOut as never), [], 'downgraded planned board must not hit board-role-incomplete');
  const withOutput = validateBoard(goodBoard(), scene);
  assert.deepEqual(withOutput.problems, []);
  assert.equal(withOutput.spec?.template, 'convergence');
});

test('label-only nodes compile to deterministic pastel boxes, not bare text', () => {
  const r1 = compileBoard(goodBoard(), scene);
  const n3 = r1.spec.elements.find((e) => e.id === 'n3')!;
  assert.equal(n3.prim, 'box');
  assert.equal((n3 as { text?: string }).text, 'mixing');
  assert.equal(n3.fill, 'blue'); // process role
  const r2 = compileBoard(goodBoard(), scene);
  assert.deepEqual(r1.spec, r2.spec);
});

test('topic swap keeps box colours data-derived', () => {
  const other = makeScene({ a: 'sand', b: 'lime', p: 'heating', o: 'glass' }, 'alt');
  const spec = compileBoard(goodBoard({ a: 'sand', b: 'lime', p: 'heating', o: 'glass' }, 'alt'), other).spec;
  assert.equal(spec.elements.find((e) => e.id === 'n3')!.prim, 'box');
});

test('a catalog icon literally named "label" is never offered as a pickable icon; choosing "label" still yields a box', () => {
  const catalog = [{ id: 'lib:label', name: 'label' }, { id: 'lib:flour', name: 'flour' }, { id: 'lib:water', name: 'water' }, { id: 'lib:dough', name: 'dough' }];
  const input = { ...scene, iconCatalog: catalog } as PlannerSceneInput;
  const enums = boardEnums(input);
  assert.ok(!enums.icons.includes('label'), 'the LABEL_ONLY sentinel must never appear as a pickable catalog icon');
  assert.ok(!('label' in enums.iconAssetIds));
  const compiled = compileBoard(goodBoard(), input); // n3 already uses icon:'label'
  assert.equal(compiled.spec.elements.find((e) => e.id === 'n3')!.prim, 'box');
});

test('duplicate catalog names: a retrieval hint for the non-kept id still records iconBasis "retrieval"', () => {
  const catalog = [{ id: 'lib:brain1', name: 'brain' }, { id: 'lib:brain2', name: 'brain' }, { id: 'lib:flour', name: 'flour' }, { id: 'lib:water', name: 'water' }, { id: 'lib:dough', name: 'dough' }];
  const input = { ...scene, iconCatalog: catalog, candidates: { ...scene.candidates, m_p: [{ id: 'lib:brain2', name: 'brain', score: 0.9 }] } } as PlannerSceneInput;
  const enums = boardEnums(input);
  assert.equal(enums.iconAssetIds.brain, 'lib:brain1', 'dedup keeps the first-seen id for a repeated catalog name');
  assert.deepEqual(enums.candidatesByMention.m_p, ['brain'], 'a retrieval hint naming the dropped duplicate id must still count by name');
  const board = goodBoard();
  board.nodes[2] = { ...board.nodes[2], icon: 'brain' };
  const result = validateBoard(board, input);
  assert.deepEqual(result.problems, []);
  assert.equal(result.spec!.elements.find((e) => e.id === 'n3')!.iconBasis, 'retrieval');
});

test('fallback title routes through the same unsupported-number rule, never reintroducing a gate-rejected numeric (regen F1)', () => {
  const numbered: PlannerSceneInput = { ...scene, teachingContext: { ...scene.teachingContext!, displayText: 'Three mixing steps' } };
  const board = fallbackBoard(numbered);
  assert.doesNotMatch(board.title, /\bthree\b/i, `fallback title must not carry the unsupported number word: "${board.title}"`);
  const problems = validateBoard(board, numbered).problems.join(' | ');
  assert.doesNotMatch(problems, /numeric value/, 'fallback must not reintroduce a numeric violation the gate will reject');
  assert.equal(compileBoard(board, numbered).spec.title, board.title);
  // A digit heading is repaired the same way.
  const digit: PlannerSceneInput = { ...scene, teachingContext: { ...scene.teachingContext!, displayText: '3 mixing steps' } };
  assert.doesNotMatch(validateBoard(fallbackBoard(digit), digit).problems.join(' | '), /numeric value/);
});

test('validator messages instruct a minimal repair: grounded title words and a kept process role (regen repair drift)', () => {
  // Numbered heading so the model title (not the code-owned heading) is the checked field — the regen repair shape.
  const numbered: PlannerSceneInput = { ...scene, teachingContext: { ...scene.teachingContext!, displayText: 'Three mixing steps' } };
  const drift: Board = {
    ...goodBoard(),
    title: 'Mixing differs',
    layout: 'list',
    visual: { kind: 'process' },
    nodes: goodBoard().nodes.map((node) => ({ ...node, role: 'item' as const })),
  };
  const problems = validateBoard(drift, numbered).problems;
  const titleProblem = problems.find((problem) => problem.includes('title words'));
  assert.ok(titleProblem, `expected a title-grounding problem, got: ${problems.join(' | ')}`);
  assert.match(titleProblem, /replace them with words from those sources/);
  const roleProblem = problems.find((problem) => problem.includes('process-role node'));
  assert.ok(roleProblem, `expected a process-role problem, got: ${problems.join(' | ')}`);
  assert.match(roleProblem, /keep at least one process-role node/);
});
