import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { PlannerSceneInput } from '../planner/prompt.js';
import { goodBoard, makeScene, WORDS } from './support/boardScene.js';
import { boardEnums, boardProblems, boardSchema, buildBoardPrompt, compileBoard, conceptForMention, fallbackBoard, planBoardScene, validateBoard, type Board } from '../planner/board.js';
import type { MoleculeGraph } from '../render/chemistry.js';

const scene = makeScene(WORDS);

test('board enums contain only scene-local mention and concept IDs', () => {
  const enums = boardEnums(scene);
  assert.deepEqual(enums.mentionIds, ['m_a', 'm_b', 'm_p', 'm_o']);
  assert.deepEqual(enums.conceptIds, ['src_a', 'src_b', 'src_p', 'src_o']);
  const json = JSON.stringify(z.toJSONSchema(boardSchema(enums)));
  for (const value of ['m_a', 'src_p', 'literal', 'metaphor', 'convergence']) assert.ok(json.includes(`"${value}"`), value);
  assert.ok(!json.includes('"lib:flour"'), 'asset IDs never enter the model schema');
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
  assert.deepEqual(spec.elements.filter((element) => element.prim === 'object').map((element) => element.concept), ['flour', 'water', 'dough'], 'compiled object nouns come from the source graph');
});

test('unknown legacy layout roles are derived from source relations while semantic validation stays strict', () => {
  const malformed = goodBoard();
  malformed.nodes = malformed.nodes.map((node, index) => ({ ...node, role: (index === 1 ? 'root' : 'mechanism') as Board['nodes'][number]['role'] }));
  const checked = validateBoard(malformed, scene);
  assert.deepEqual(checked.problems, []);
  assert.deepEqual(checked.board?.nodes.map((node) => node.role), ['input', 'input', 'process', 'output']);
  assert.equal(checked.spec?.edges.length, 3);

  const specialized = { ...malformed, layout: 'timeline' as const };
  const strict = validateBoard(specialized, scene);
  assert.ok(strict.problems.some((problem) => problem.includes('Invalid option')));
});

test('all five full-plan structural layouts compile to their matching first-class templates and slots', () => {
  const cases: Array<[Board['layout'], string, string[], Board['nodes'][number]['role'][], number?]> = [
    ['hierarchy_tree', 'hierarchy_tree', ['root', 'branch', 'branch', 'leaf'], ['root', 'branch', 'branch', 'leaf']],
    ['decision_tree', 'decision_tree', ['root', 'branch', 'branch', 'outcome'], ['root', 'branch', 'branch', 'outcome']],
    ['timeline', 'timeline', ['event', 'event', 'event', 'event'], ['event', 'event', 'event', 'event']],
    ['rule_exception', 'rule_exception', ['rule', 'exception', 'consequence'], ['rule', 'exception', 'consequence'], 3],
    ['claim_evidence', 'claim_evidence', ['claim', 'evidence', 'evidence', 'evidence'], ['claim', 'evidence', 'evidence', 'evidence']],
  ];
  for (const [layout, template, slots, roles, nodeCount] of cases) {
    const base = goodBoard();
    const board = { ...base, layout, nodes: base.nodes.slice(0, nodeCount).map((node, index) => ({ ...node, role: roles[index]! })) };
    const compiled = compileBoard(board, scene).spec;
    assert.equal(compiled.template, template, `${layout} must not be projected onto an unrelated geometry`);
    assert.deepEqual(compiled.elements.filter((element) => element.conceptIds?.length).map((element) => element.slot), slots);
  }
});

test('timeline order is pinned to narrated mention order', () => {
  const board = { ...goodBoard(), layout: 'timeline' as const, nodes: goodBoard().nodes.map((node) => ({ ...node, role: 'event' as const })) };
  const refs = [
    { sourceId: 'src_doc', spanId: 'src_precedes_a', startChar: 500, endChar: 500 + 'flour precedes water'.length, startLine: 11, endLine: 11, quote: 'flour precedes water' },
    { sourceId: 'src_doc', spanId: 'src_precedes_b', startChar: 530, endChar: 530 + 'water precedes mixing'.length, startLine: 12, endLine: 12, quote: 'water precedes mixing' },
    { sourceId: 'src_doc', spanId: 'src_precedes_c', startChar: 560, endChar: 560 + 'mixing precedes dough'.length, startLine: 13, endLine: 13, quote: 'mixing precedes dough' },
  ];
  const input = { ...scene, teachingContext: { ...scene.teachingContext!, sourceEvidenceRefs: [...scene.teachingContext!.sourceEvidenceRefs!, ...refs], relations: [
    { from: 'src_a', to: 'src_b', type: 'precedes', evidenceRefs: [refs[0]!] },
    { from: 'src_b', to: 'src_p', type: 'precedes', evidenceRefs: [refs[1]!] },
    { from: 'src_p', to: 'src_o', type: 'precedes', evidenceRefs: [refs[2]!] },
  ] } };
  assert.deepEqual(boardProblems(board, input, boardEnums(input)), []);
  const reversed = { ...board, nodes: [...board.nodes].reverse() };
  assert.ok(boardProblems(reversed, input, boardEnums(input)).some((problem) => problem.includes('mention order in the narration')));
  assert.ok(boardProblems(reversed, input, boardEnums(input)).some((problem) => problem.includes('precedes relation')));
});

test('hierarchy requires source-backed parent edges and rule-exception works without an unstated consequence', () => {
  const refs = [
    { sourceId: 'src_doc', spanId: 'src_contains_a', startChar: 300, endChar: 325, startLine: 6, endLine: 6, quote: 'flour contains water' },
    { sourceId: 'src_doc', spanId: 'src_contains_b', startChar: 330, endChar: 356, startLine: 7, endLine: 7, quote: 'flour contains mixing' },
    { sourceId: 'src_doc', spanId: 'src_contains_c', startChar: 360, endChar: 385, startLine: 8, endLine: 8, quote: 'water contains dough' },
  ];
  const hierarchyInput = { ...scene, teachingContext: { ...scene.teachingContext!, sourceEvidenceRefs: [...scene.teachingContext!.sourceEvidenceRefs!, ...refs], relations: [
    { from: 'src_a', to: 'src_b', type: 'contains', evidenceRefs: [refs[0]!] },
    { from: 'src_a', to: 'src_p', type: 'contains', evidenceRefs: [refs[1]!] },
    { from: 'src_b', to: 'src_o', type: 'contains', evidenceRefs: [refs[2]!] },
  ] } };
  const hierarchy = { ...goodBoard(), layout: 'hierarchy_tree' as const, nodes: goodBoard().nodes.map((node, index) => ({ ...node, role: (['root', 'branch', 'branch', 'leaf'] as const)[index]! })) };
  assert.deepEqual(boardProblems(hierarchy, hierarchyInput, boardEnums(hierarchyInput)), []);
  const unsupportedTree = { ...hierarchy, nodes: hierarchy.nodes.map((node) => node.concept === 'src_o' ? { ...node, role: 'branch' as const } : node) };
  assert.ok(boardProblems(unsupportedTree, hierarchyInput, boardEnums(hierarchyInput)).some((problem) => problem.includes('source-backed contains relation')));
  const missingParent = { ...hierarchyInput, teachingContext: { ...hierarchyInput.teachingContext!, relations: hierarchyInput.teachingContext!.relations.map((relation) => relation.to === 'src_p' ? { ...relation, type: 'feeds' } : relation) } };
  assert.ok(boardProblems(hierarchy, missingParent, boardEnums(missingParent)).some((problem) => problem.includes('source-backed contains relation')));

  const ruleQuote = 'the rule excepts water when flour is dry';
  const ruleRef = { sourceId: 'src_doc', spanId: 'src_rule_exception', startChar: 400, endChar: 400 + ruleQuote.length, startLine: 10, endLine: 10, quote: ruleQuote };
  const ruleInput = { ...scene, planningContext: undefined, teachingContext: { ...scene.teachingContext!, sourceEvidenceRefs: [...scene.teachingContext!.sourceEvidenceRefs!, ruleRef], relations: [{ from: 'src_a', to: 'src_b', type: 'excepts', evidenceRefs: [ruleRef] }] } };
  const ruleBoard: Board = { ...goodBoard(), layout: 'rule_exception', nodes: goodBoard().nodes.slice(0, 2).map((node, index) => ({ ...node, role: (['rule', 'exception'] as const)[index]! })) };
  assert.deepEqual(boardProblems(ruleBoard, ruleInput, boardEnums(ruleInput)), []);
  assert.equal(compileBoard(ruleBoard, ruleInput).spec.edges[0]?.label, 'EXCEPTS');
  const misleadingRuleInput = { ...ruleInput, teachingContext: { ...ruleInput.teachingContext!, relations: [{ from: 'src_a', to: 'src_b', type: 'opposes', evidenceRefs: [ruleRef] }] } };
  assert.ok(boardProblems(ruleBoard, misleadingRuleInput, boardEnums(misleadingRuleInput)).some((problem) => problem.includes('explicit source-backed excepts relation')));

  const supportQuote = 'water supports the mixing claim';
  const supportRef = { sourceId: 'src_doc', spanId: 'src_supports', startChar: 440, endChar: 440 + supportQuote.length, startLine: 11, endLine: 11, quote: supportQuote };
  const claimInput = { ...ruleInput, teachingContext: { ...ruleInput.teachingContext!, sourceEvidenceRefs: [...ruleInput.teachingContext!.sourceEvidenceRefs!, supportRef], relations: [{ from: 'src_b', to: 'src_a', type: 'supports', evidenceRefs: [supportRef] }] } };
  const claimBoard: Board = { ...goodBoard(), layout: 'claim_evidence', nodes: goodBoard().nodes.slice(0, 2).map((node, index) => ({ ...node, role: (['claim', 'evidence'] as const)[index]! })) };
  assert.deepEqual(boardProblems(claimBoard, claimInput, boardEnums(claimInput)), []);
  assert.equal(compileBoard(claimBoard, claimInput).spec.edges[0]?.label, 'SUPPORTS');
  const oppositionInput = { ...claimInput, teachingContext: { ...claimInput.teachingContext!, relations: [{ from: 'src_b', to: 'src_a', type: 'opposes', evidenceRefs: [supportRef] }] } };
  assert.ok(boardProblems(claimBoard, oppositionInput, boardEnums(oppositionInput)).some((problem) => problem.includes('explicit source-backed supports relation')));
});

test('decision tree labels each directed branch from the cited relation span', () => {
  const whenQuote = 'flour branches to mixing when dry';
  const otherwiseQuote = 'flour branches to water otherwise';
  const helperQuote = 'water requires mixing';
  const when = { sourceId: 'src_doc', spanId: 'src_when', startChar: 200, endChar: 200 + whenQuote.length, startLine: 3, endLine: 3, quote: whenQuote };
  const otherwise = { sourceId: 'src_doc', spanId: 'src_otherwise', startChar: 230, endChar: 230 + otherwiseQuote.length, startLine: 4, endLine: 4, quote: otherwiseQuote };
  const helper = { sourceId: 'src_doc', spanId: 'src_helper', startChar: 250, endChar: 250 + helperQuote.length, startLine: 5, endLine: 5, quote: helperQuote };
  const result = { sourceId: 'src_doc', spanId: 'src_result', startChar: 285, endChar: 312, startLine: 6, endLine: 6, quote: 'mixing produces dough' };
  const input = { ...scene, teachingContext: { ...scene.teachingContext!, sourceEvidenceRefs: [...scene.teachingContext!.sourceEvidenceRefs!, when, otherwise, helper, result], relations: [
    { from: 'src_a', to: 'src_p', type: 'branches', evidenceRefs: [when] },
    { from: 'src_a', to: 'src_b', type: 'branches', evidenceRefs: [otherwise] },
    { from: 'src_p', to: 'src_o', type: 'produces', evidenceRefs: [result] },
    { from: 'src_b', to: 'src_o', type: 'produces', evidenceRefs: [result] },
    { from: 'src_b', to: 'src_p', type: 'requires', evidenceRefs: [helper] },
  ] } };
  const board: Board = { ...goodBoard(), layout: 'decision_tree', nodes: [
    { ...goodBoard().nodes[0]!, role: 'root' },
    { ...goodBoard().nodes[2]!, role: 'branch', branchCondition: 'when dry' },
    { ...goodBoard().nodes[1]!, role: 'branch', branchCondition: 'otherwise' },
    { ...goodBoard().nodes[3]!, role: 'outcome' },
  ] };
  const checked = validateBoard(board, input);
  assert.deepEqual(checked.problems, []);
  assert.deepEqual(checked.spec!.edges.map((edge) => edge.label ?? null), ['when dry', 'otherwise', null, null, null]);
  const invented = { ...board, nodes: board.nodes.map((node) => node.role === 'branch' ? { ...node, branchCondition: 'when sunny' } : node) };
  assert.ok(validateBoard(invented, input).problems.some((problem) => problem.includes('branchCondition')));
});

test('board rules reject invented content words and missing relation concepts; shared mention is allowed', () => {
  const bad = goodBoard();
  bad.nodes[0].representation = { kind: 'metaphor' };
  bad.nodes[1].label = 'cold water tank';
  const problems = validateBoard(bad, scene).problems.join(' | ');
  assert.doesNotMatch(problems, /asset|icon catalog/i, 'representation intent carries no asset selection');
  assert.match(problems, /label words \[cold, tank\]/);
  const shared = goodBoard();
  shared.nodes[3].mention = 'm_p';
  shared.nodes[3].representation = { kind: 'labelled' };
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
  renamed.nodes[2].representation = { kind: 'labelled' };
  const checked = validateBoard({ ...renamed, nodes: renamed.nodes.map((node) => (node.id === 'n3' ? { ...node, label: 'mixing' } : node)) }, scene);
  assert.deepEqual(checked.problems, []);
  const persistent = checked.spec!.elements.find((element) => element.id === 'n3')!;
  assert.equal(persistent.prim === 'box' ? persistent.text : persistent.label, 'mixing');
  const unsupported = { ...goodBoard(), nodes: [{ ...goodBoard().nodes[0], representation: { kind: 'unknown' } }] };
  assert.ok(validateBoard(unsupported, scene).problems.some((problem) => problem.startsWith('nodes.0.representation')));
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
  assert.deepEqual(board.nodes.map((node) => [node.concept, node.representation.kind, node.role]), [
    ['src_a', 'literal', 'input'], ['src_b', 'literal', 'input'], ['src_p', 'literal', 'process'], ['src_o', 'literal', 'output'],
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
    const board: Board = { ...goodBoard(words), nodes: goodBoard(words).nodes.map((node) => (node.id === 'n2' ? { ...node, concept: 'src_a', representation: { kind: 'labelled' } } : node)) };
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

test('typed code visual reaches S7 only from an exact cited source excerpt', () => {
  const source = 'if x < y:\n    result = x + 1';
  const codeRef = {
    sourceId: 'src_doc', spanId: 'src_code', startChar: 180, endChar: 180 + source.length,
    startLine: 4, endLine: 5, quote: source,
  };
  const input: PlannerSceneInput = {
    ...scene,
    teachingContext: { ...scene.teachingContext!, sourceEvidenceRefs: [...scene.teachingContext!.sourceEvidenceRefs!, codeRef] },
  };
  const board: Board = { ...goodBoard(), visual: { kind: 'code', language: 'python', source } };
  const compiled = validateBoard(board, input);
  assert.deepEqual(compiled.problems, []);
  const element = compiled.spec!.elements.find((item) => item.prim === 'code');
  assert.ok(element && element.prim === 'code');
  assert.equal(element?.source, source);
  assert.ok(element?.evidenceRefs?.some((ref) => ref.spanId === 'src_code'), 'the code visual pins the exact supporting source span');

  const unsupported = validateBoard({ ...board, visual: { ...board.visual, source: 'if x > y:\n    result = x + 1' } }, input);
  assert.ok(unsupported.problems.some((problem) => problem.includes('verbatim text inside one cited source evidence quote')));
});

test('typed molecule visual reaches S7 only when its exact bond notation matches one cited source quote', () => {
  const notation = '[H]-[O]-[H]';
  const chemistryRef = {
    sourceId: 'src_doc', spanId: 'src_chemistry', startChar: 240, endChar: 270,
    startLine: 8, endLine: 8, quote: `Water structure: ${notation}`,
  };
  const input: PlannerSceneInput = {
    ...scene,
    teachingContext: { ...scene.teachingContext!, sourceEvidenceRefs: [...scene.teachingContext!.sourceEvidenceRefs!, chemistryRef] },
  };
  const molecule: MoleculeGraph = {
    atoms: [{ id: 'oxygen', element: 'O' }, { id: 'hydrogen_a', element: 'H' }, { id: 'hydrogen_b', element: 'H' }],
    bonds: [{ from: 'oxygen', to: 'hydrogen_a', order: 1 }, { from: 'oxygen', to: 'hydrogen_b', order: 1 }],
  };
  const board: Board = { ...goodBoard(), visual: { kind: 'molecule', molecule, structureNotation: notation } };
  const checked = validateBoard(board, input);
  assert.deepEqual(checked.problems, []);
  const compiled = checked.spec!.elements.find((element) => element.prim === 'molecule');
  assert.equal(compiled?.prim, 'molecule');
  assert.ok(compiled?.evidenceRefs?.some((ref) => ref.spanId === 'src_chemistry'));

  const unsupported = validateBoard({ ...board, visual: { ...board.visual, structureNotation: '[H]-[H]' } }, input);
  assert.ok(unsupported.problems.some((problem) => problem.includes('exact cited structural notation')));
});

for (const [words, prefix] of [[WORDS, 'src'], [{ a: 'sand', b: 'lime', p: 'heating', o: 'glass' }, 'alt']] as const) {
  test(`neutral diagram shapes compile with concept evidence and cited arrows (${prefix})`, () => {
    const input = makeScene(words, prefix);
    const board = goodBoard(words, prefix);
    board.nodes[0]!.representation = { kind: 'shape', shape: 'circle' };
    board.nodes[3]!.representation = { kind: 'shape', shape: 'rectangle' };
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
  const previousElements = goodBoard().nodes.map((node) => ({ id: node.id, prim: node.representation.kind === 'labelled' ? 'box' : node.representation.kind === 'shape' ? 'shape' : 'object', label: node.label, conceptIds: [node.concept] }));
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

test('board prompt carries scene data but never asset candidates or IDs', () => {
  const prompt = buildBoardPrompt(scene);
  assert.doesNotMatch(prompt.user, /iconSuggestions|icon_catalog|lib:flour/);
  assert.match(prompt.user, /"mustShow"/);
  assert.ok(!prompt.user.includes('lib:flour'));
  assert.match(prompt.system, /illustrative, not about this lesson/);
  assert.match(prompt.system, /relationType/);
  assert.match(prompt.system, /"schemaVersion":"claude-board\/v5-representation-intent"/);
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
  assert.match(prompt.system, /For the legacy process\/list layouts, include a process role when visual\.kind is process/);
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
  assert.equal((result.spec?.elements.find((element) => element.id === 'n1') as { concept?: string } | undefined)?.concept, 'flour');
});

test('S6 uses two bounded repairs for a bad node ID followed by missing claim coverage', async () => {
  const contracted = makeScene(WORDS);
  contracted.claimSpans = [{ claimId: 'claim-1', exactText: contracted.plainText, plainStart: 0, plainEnd: contracted.plainText.length }];
  contracted.planningContext = {
    ...contracted.planningContext!,
    sceneContract: {
      ...contracted.planningContext!.sceneContract,
      essentialClaims: [{ id: 'claim-1', statement: 'Flour feeds mixing', conceptIds: ['src_a', 'src_p'], relations: [{ from: 'src_a', to: 'src_p', type: 'feeds' }], evidenceSpanIds: ['src_ap'] }],
    },
  };
  const final = goodBoard();
  final.visualIntents = [{ claimId: 'claim-1', strategy: 'process', targets: [
    { kind: 'element', elementId: 'n1', evidenceSpanIds: ['src_ap'] },
    { kind: 'element', elementId: 'n3', evidenceSpanIds: ['src_ap'] },
    { kind: 'edge', fromElementId: 'n1', toElementId: 'n3', relationType: 'feeds', evidenceSpanIds: ['src_ap'] },
  ] }];
  const structural = { ...goodBoard(), nodes: goodBoard().nodes.map((node, index) => index === 1 ? { ...node, id: 'n1' } : node) };
  const replies = [structural, goodBoard(), final];
  const prompts: string[] = [];
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    prompts.push(String(init?.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(replies[calls++]) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 40, cost: 0.001 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await planBoardScene(contracted, { model: 'test/board', apiKey: 'test-only', remainingBudgetUsd: 0.05, fetcher, fallback: false });
  assert.equal(calls, 3);
  assert.equal(result.usage.repairs, 2);
  assert.equal(result.fallback, false);
  assert.deepEqual(result.failures.filter((failure) => failure.hard), []);
  assert.equal(result.spec?.boardIntent?.visualIntents[0]?.claimId, 'claim-1');
  assert.match(prompts[1]!, /Repair phase 1 of 2/);
  assert.match(prompts[1]!, /do not attempt claim or relation repair yet/);
  assert.match(prompts[2]!, /Repair phase 2 of 2/);
  assert.match(prompts[2]!, /requires exactly one visual intent/);
  assert.match(prompts[2]!, /exact spokenClaimSpans supplied for each claim/);
});

test('S6 exhausts two repairs with a hard failure when claim coverage remains missing', async () => {
  const contracted = makeScene(WORDS);
  contracted.claimSpans = [{ claimId: 'claim-1', exactText: contracted.plainText, plainStart: 0, plainEnd: contracted.plainText.length }];
  contracted.planningContext = {
    ...contracted.planningContext!,
    sceneContract: {
      ...contracted.planningContext!.sceneContract,
      essentialClaims: [{ id: 'claim-1', statement: 'Flour feeds mixing', conceptIds: ['src_a', 'src_p'], relations: [{ from: 'src_a', to: 'src_p', type: 'feeds' }], evidenceSpanIds: ['src_ap'] }],
    },
  };
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(goodBoard()) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 40, cost: 0.001 } }), { status: 200 });
  };
  const result = await planBoardScene(contracted, { model: 'test/board', apiKey: 'test-only', remainingBudgetUsd: 0.05, fetcher, fallback: false });
  assert.equal(calls, 3);
  assert.equal(result.spec, undefined);
  assert.equal(result.usage.repairs, 2);
  assert.ok(result.failures.some((failure) => failure.hard && failure.code === 'planner-repair-failed'));
});

test('typed representations preserve source referents and never encode asset choices', () => {
  const input = { ...scene, claimSpans: [{ claimId: 'claim-a', exactText: scene.plainText, plainStart: 0, plainEnd: scene.plainText.length }], iconCatalog: [{ id: 'lib:key', name: 'key' }], candidates: { m_a: [{ id: 'lib:wrong', name: 'rocket', score: 0.99 }] } } as PlannerSceneInput;
  const board = goodBoard();
  board.nodes[0] = { ...board.nodes[0], representation: { kind: 'metaphor' } };
  const result = validateBoard(board, input);
  assert.deepEqual(result.problems, []);
  const object = result.spec!.elements.find((element) => element.id === 'n1')!;
  assert.equal(object.prim, 'object');
  assert.equal(object.concept, 'flour');
  assert.deepEqual(object.conceptIds, ['src_a']);
  assert.equal(object.visualStrategy, 'metaphor');
  const { system, user } = buildBoardPrompt(input);
  assert.doesNotMatch(`${system} ${user}`, /lib:key|lib:wrong|rocket|icon_catalog|iconSuggestions/);
  assert.match(user, /"id": "src_a"/);
  assert.match(system, /contract statement is a summary/);
  assert.match(user, new RegExp(`"exactText": "${scene.plainText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('typed semantic role and shape intents compile without replacing the source concept', () => {
  const board = goodBoard();
  board.nodes[0] = { ...board.nodes[0], representation: { kind: 'semantic-role', role: 'filter' } };
  board.nodes[1] = { ...board.nodes[1], representation: { kind: 'shape', shape: 'circle' } };
  const result = validateBoard(board, scene);
  assert.deepEqual(result.problems, []);
  const role = result.spec!.elements.find((element) => element.id === 'n1')!;
  assert.equal(role.prim, 'object');
  assert.equal(role.concept, 'flour');
  assert.equal(role.semanticRole, 'filter');
  assert.equal(role.visualStrategy, 'semantic-core');
  const shape = result.spec!.elements.find((element) => element.id === 'n2')!;
  assert.equal(shape.prim, 'shape');
  assert.deepEqual(shape.conceptIds, ['src_b']);
});

test('distinct spoken instances of one source concept retain distinct S7 referents', () => {
  const board = goodBoard();
  board.nodes[1] = { ...board.nodes[1], concept: 'src_a', label: 'water' };
  const compiled = compileBoard(board, scene).spec;
  const first = compiled.elements.find((element) => element.id === 'n1') as { concept?: string; conceptIds?: string[] };
  const second = compiled.elements.find((element) => element.id === 'n2') as { concept?: string; conceptIds?: string[] };
  assert.equal(first.concept, 'flour');
  assert.equal(second.concept, 'water');
  assert.deepEqual(first.conceptIds, ['src_a']);
  assert.deepEqual(second.conceptIds, ['src_a']);
});

test('unsupported representation variants and semantic roles fail at the schema boundary', () => {
  const base = goodBoard();
  const invalid = { ...base, nodes: [{ ...base.nodes[0], representation: { kind: 'semantic-role', role: 'teleport' } }] };
  const checked = validateBoard(invalid, scene);
  assert.ok(checked.problems.some((problem) => problem.includes('representation')));
});

test('board prompt emits neither retrieved candidates nor Asset Lab icon catalogs', () => {
  const input = { ...scene, iconCatalog: [{ id: 'lib:key', name: 'key' }], candidates: { m_a: [{ id: 'lib:flour', name: 'flour', score: 0.99 }] } } as PlannerSceneInput;
  const { system, user } = buildBoardPrompt(input);
  assert.doesNotMatch(`${system} ${user}`, /lib:key|lib:flour|icon_catalog|iconSuggestions|icon candidates/);
  assert.match(system, /never choose an asset/);
  assert.match(user, /"id": "m_a"/);
});

test('conceptForMention matches a mention to its scene concept by id, then by shared label words', () => {
  assert.equal(conceptForMention(scene, { id: 'src_b', phrase: 'anything' })?.id, 'src_b');
  assert.equal(conceptForMention(scene, { id: 'm_x', phrase: 'the doughs rest' })?.label, 'dough');
  assert.equal(conceptForMention(scene, { id: 'm_y', phrase: 'unrelated words' }), undefined);
  assert.equal(conceptForMention({ teachingContext: undefined }, { id: 'm_a', phrase: 'flour' }), undefined);
});

test('icon labels wrap onto at most two balanced lines, so nodes stay narrow and icons can grow', async () => {
  const { labelLines, labelBlockHeight, OBJECT_LABEL_H, OBJECT_LABEL_LINE_H } = await import('../assets/ladder.js');
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

test('compiled icon referents stay within the bounded query contract for long spoken phrases', () => {
  const longPhrase = 'the thermostat controller mechanism that measures current indoor room temperature';
  const input = { ...scene, mentions: scene.mentions.map((mention) => mention.id === 'm_a' ? { ...mention, phrase: longPhrase } : mention) };
  const compiled = compileBoard(goodBoard(), input);
  const referent = (compiled.spec.elements.find((element) => element.id === 'n1') as { concept?: string }).concept!;
  assert.ok(referent.length <= 48);
  const spoken = new Set(longPhrase.toLowerCase().split(' '));
  assert.ok(referent.split(' ').every((word) => spoken.has(word)), 'referent words come from the spoken phrase');
  assert.deepEqual(compiled.problems, []);
});

test('topic swap keeps box colours data-derived', () => {
  const other = makeScene({ a: 'sand', b: 'lime', p: 'heating', o: 'glass' }, 'alt');
  const spec = compileBoard(goodBoard({ a: 'sand', b: 'lime', p: 'heating', o: 'glass' }, 'alt'), other).spec;
  assert.equal(spec.elements.find((e) => e.id === 'n3')!.prim, 'box');
});

test('planner prompt documents typed semantic representation roles', () => {
  const { system } = buildBoardPrompt(scene);
  assert.ok(system.includes('semantic-role'), 'prompt shows the typed representation syntax');
  assert.ok(system.includes('filter'), 'prompt shows supported roles');
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
  claimed.plainText = 'Mixing combines flour and water into dough. The mixture rests while the baker prepares the oven, cleans the counter, measures more ingredients, and preheats everything thoroughly. Much later, something unrelated happens far away.';
  claimed.claimSpans = [{ claimId: 'mixing_claim', exactText: 'Mixing combines flour and water', plainStart: 0, plainEnd: 31 }];
  claimed.mentions = [
    ...claimed.mentions,
    { id: 'm_far', phrase: 'something unrelated happens far away' },
  ];
  const board = goodBoard();
  board.nodes.push({ id: 'n5', mention: 'm_far', concept: 'src_o', representation: { kind: 'labelled' }, label: 'far away', role: 'item' });
  board.visualIntents = [{ claimId: 'mixing_claim', strategy: 'literal', targets: [{ kind: 'element', elementId: 'n5', evidenceSpanIds: ['src_a'] }] }];
  const problems = boardProblems(board, claimed, boardEnums(claimed));
  assert.ok(problems.some((p) => p.includes('never names it nearby')), JSON.stringify(problems));
  const near = goodBoard();
  near.visualIntents = [{ claimId: 'mixing_claim', strategy: 'literal', targets: [{ kind: 'element', elementId: 'n1', evidenceSpanIds: ['src_a'] }] }];
  assert.ok(!boardProblems(near, claimed, boardEnums(claimed)).some((p) => p.includes('never names it nearby')));
});

test('fallback covers required concepts the narration never mentions', () => {
  const claimed = makeScene(WORDS);
  const contract = claimed.planningContext!.sceneContract as unknown as { requiredConceptIds: string[] };
  // src_o (dough) is required but has no mention pointing at it here.
  claimed.mentions = claimed.mentions.filter((m) => m.id !== 'm_o');
  const fb = fallbackBoard(claimed);
  const shown = new Set(fb.nodes.map((n) => n.concept));
  for (const id of contract.requiredConceptIds) assert.ok(shown.has(id), `required concept ${id} shown`);
});
