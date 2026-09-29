import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { PlannerSceneInput } from '../planner/prompt.js';
import { goodBoard, makeScene, WORDS } from './support/boardScene.js';
import { boardEnums, boardProblems, boardSchema, buildBoardPrompt, compileBoard, conceptForMention, fallbackBoard, planBoardScene, validateBoard, type Board } from '../planner/board.js';

const scene = makeScene(WORDS);

test('board enums come only from the scene: mentions, concepts, and candidates above the hint floor', () => {
  const enums = boardEnums(scene);
  assert.deepEqual(enums.mentionIds, ['m_a', 'm_b', 'm_p', 'm_o']);
  assert.deepEqual(enums.conceptIds, ['src_a', 'src_b', 'src_p', 'src_o']);
  assert.deepEqual(enums.icons.slice(0, 3), ['flour', 'water', 'dough']);
  assert.ok(enums.icons.includes('role:filter'), 'semantic roles are offered alongside catalog icons');
  assert.ok(enums.icons.includes('role:loop'));
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
  assert.deepEqual(spec.edges.map((edge) => edge.label ?? null), [null, null, null], 'geometry carries the relation; no verb label is emitted');
  assert.deepEqual(checked.iconAssets, { n1: 'lib:flour', n2: 'lib:water', n4: 'lib:dough' });
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

test('board rejects duplicate source-concept nodes even when node ids differ', () => {
  const duplicate = goodBoard();
  duplicate.nodes[1] = { ...duplicate.nodes[1]!, concept: duplicate.nodes[0]!.concept, mention: duplicate.nodes[0]!.mention };
  assert.match(validateBoard(duplicate, scene).problems.join(' | '), /duplicate concept src_a/);
});

// Two unrelated vocabularies through the same rules (topic-swap).
for (const words of [WORDS, { a: 'coal', b: 'petrol', p: 'burning', o: 'heat' }]) {
  test(`a concept may appear as distinct concrete examples, and each example gets the relation arrow (${words.a})`, () => {
    // One source concept (src_a) that the narration names through two different mentions.
    const base = makeScene(words);
    const input: PlannerSceneInput = { ...base, teachingContext: { ...base.teachingContext!, concepts: base.teachingContext!.concepts!.filter((concept) => concept.id !== 'src_b'), relations: base.teachingContext!.relations!.filter((relation) => relation.from !== 'src_b') } };
    const board: Board = { ...goodBoard(words), nodes: goodBoard(words).nodes.map((node) => (node.id === 'n2' ? { ...node, concept: 'src_a', icon: 'label' } : node)) };
    const checked = validateBoard(board, input);
    assert.deepEqual(checked.problems, []);
    assert.deepEqual(checked.spec!.edges.map((edge) => [edge.from, edge.to, edge.label]), [['n1', 'n3', undefined], ['n2', 'n3', undefined], ['n3', 'n4', undefined]]);
    const sameExample = { ...board, nodes: board.nodes.map((node) => (node.id === 'n2' ? { ...node, mention: 'm_a', label: words.a } : node)) };
    assert.match(validateBoard(sameExample, input).problems.join(' | '), /duplicate concept src_a/);
  });
}

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

for (const [words, prefix] of [[WORDS, 'src'], [{ a: 'sand', b: 'lime', p: 'heating', o: 'glass' }, 'alt']] as const) {
  test(`neutral diagram shapes compile with concept evidence and cited arrows (${prefix})`, () => {
    const input = makeScene(words, prefix);
    const board = goodBoard(words, prefix);
    board.nodes[0]!.icon = 'diagram:circle';
    board.nodes[3]!.icon = 'diagram:rectangle';
    const checked = validateBoard(board, input);
    assert.deepEqual(checked.problems, []);
    const first = checked.spec!.elements.find((element) => element.id === 'n1')!;
    const last = checked.spec!.elements.find((element) => element.id === 'n4')!;
    assert.equal(first.prim, 'shape');
    assert.equal(last.prim, 'shape');
    assert.equal(first.prim === 'shape' ? first.kind : '', 'circle');
    assert.equal(last.prim === 'shape' ? last.kind : '', 'rectangle');
    assert.ok(first.evidenceRefs?.length);
    assert.ok(checked.spec!.edges.every((edge) => edge.factualRelation?.evidenceRefs.length));
    assert.deepEqual(checked.iconAssets, { n2: `lib:${words.b}` });
  });
}

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
  const previousElements = goodBoard().nodes.map((node) => ({ id: node.id, prim: node.icon === 'label' ? 'box' : 'object', label: node.label, conceptIds: [node.concept] }));
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
  assert.match(prompt.system, /relationType/);
  assert.match(prompt.system, /"schemaVersion":"claude-board\/v3"/);
  assert.doesNotMatch(prompt.system, /"schemaVersion":"claude-board\/v2"/);
  assert.match(prompt.system, /"visualIntents":\[\]/);
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
  assert.match(prompt.system, /Normally one node per concept\. When the narration names different concrete examples of one concept/);
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
  // Donor boardBank.v2 demonstrates the key-as-lookup metaphor inside the
  // illustrative structure examples, so a raw name count spans examples too.
  // The cacheable contract is the catalog block: exactly one <icon_catalog>
  // ahead of the per-scene data, carrying every enabled name.
  assert.equal(user.split('<icon_catalog').length - 1, 1, 'the catalog block appears once ahead of the per-scene data');
  assert.match(user, /<icon_catalog count="2"[\s\S]*"key"[\s\S]*"flour"[\s\S]*<\/icon_catalog>/);
});

test('a large catalog is admissible in full, checked in code rather than a provider enum', () => {
  const iconCatalog = Array.from({ length: 70 }, (_, i) => ({ id: `lib:icon${i}`, name: `icon${i}` }));
  const big: PlannerSceneInput = { ...scene, iconCatalog };
  const enums = boardEnums(big);
  assert.equal(enums.icons.filter((name) => !name.startsWith('role:')).length, 70);
  assert.ok(enums.icons.includes('role:filter'), 'roles ride along for code-side checks');
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

test('role: icons compile to semantic-role elements the R2 ladder draws', () => {
  const board: Board = {
    ...goodBoard(),
    nodes: goodBoard().nodes.map((node, i) => (i === 0 ? { ...node, icon: 'role:filter' } : node)),
  };
  const checked = validateBoard(board, scene);
  assert.deepEqual(checked.problems, []);
  const el = checked.spec!.elements.find((e) => e.id === 'n1')!;
  assert.equal(el.prim, 'object');
  assert.equal((el as { semanticRole?: string }).semanticRole, 'filter');
  assert.deepEqual((el as { conceptIds?: string[] }).conceptIds, ['src_a'], 'role serves the source concept, not the role name');
});

test('role: icons reject names outside the semantic role list', () => {
  const board: Board = {
    ...goodBoard(),
    nodes: goodBoard().nodes.map((node, i) => (i === 0 ? { ...node, icon: 'role:teleport' } : node)),
  };
  const checked = validateBoard(board, scene);
  // Small catalogs carry the role list in the provider enum, so an invented
  // role fails at the schema boundary before boardProblems ever runs.
  assert.ok(
    checked.problems.some((p) => p.includes('role:teleport')) || checked.spec === undefined,
    JSON.stringify(checked.problems),
  );
});

test('planner prompt documents the semantic role vocabulary', () => {
  const { system } = buildBoardPrompt(scene);
  assert.ok(system.includes('role:filter'), 'prompt shows the role: syntax');
  assert.ok(system.includes('bottleneck'), 'prompt lists role names');
});

test('fallback board synthesizes one visual intent per essential claim over shown nodes', () => {
  const claimed = makeScene(WORDS);
  const contract = claimed.planningContext!.sceneContract as unknown as { essentialClaims: unknown };
  (contract as Record<string, unknown>).essentialClaims = [
    { id: 'mixing_claim', statement: 'Mixing combines flour and water.', conceptIds: ['src_a', 'src_b', 'src_p'], relations: [{ from: 'src_a', to: 'src_p', type: 'feeds' }], evidenceSpanIds: ['src_a', 'src_b', 'src_ap'] },
  ];
  const fb = fallbackBoard(claimed);
  assert.equal(fb.visualIntents?.length, 1);
  const intent = fb.visualIntents![0]!;
  assert.equal(intent.claimId, 'mixing_claim');
  assert.equal(intent.strategy, 'literal');
  assert.ok(intent.targets.length > 0, 'fallback depicts what it shows');
  assert.ok(intent.targets.every((t) => (t.evidenceSpanIds ?? []).length > 0), 'every fallback target cites claim spans');
});

test('claim-target proximity: depictions far from their claim text are flagged for repair', () => {
  const claimed = makeScene(WORDS);
  const contract = claimed.planningContext!.sceneContract as unknown as { essentialClaims: unknown };
  (contract as Record<string, unknown>).essentialClaims = [
    { id: 'mixing_claim', statement: 'Mixing combines flour and water.', conceptIds: ['src_a', 'src_b', 'src_p'], relations: [], evidenceSpanIds: ['src_a'] },
  ];
  claimed.plainText = 'Mixing combines flour and water into dough. Much later, something unrelated happens far away in the kitchen.';
  claimed.claimSpans = [{ claimId: 'mixing_claim', exactText: 'Mixing combines flour and water', plainStart: 0, plainEnd: 31 }];
  claimed.mentions = [
    ...claimed.mentions,
    { id: 'm_far', phrase: 'something unrelated happens far away' },
  ];
  const board = goodBoard();
  board.nodes.push({ id: 'n5', mention: 'm_far', concept: 'src_o', icon: 'label', label: 'far away', role: 'item' });
  board.visualIntents = [{ claimId: 'mixing_claim', strategy: 'literal', targets: [{ kind: 'element', elementId: 'n5', evidenceSpanIds: ['src_a'] }] }];
  const problems = boardProblems(board, claimed, boardEnums(claimed));
  assert.ok(problems.some((p) => p.includes('never names it nearby')), JSON.stringify(problems));
  const near = goodBoard();
  near.visualIntents = [{ claimId: 'mixing_claim', strategy: 'literal', targets: [{ kind: 'element', elementId: 'n1', evidenceSpanIds: ['src_a'] }] }];
  assert.ok(!boardProblems(near, claimed, boardEnums(claimed)).some((p) => p.includes('never names it nearby')));
});
