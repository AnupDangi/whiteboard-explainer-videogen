import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlannerSceneInput } from '../planner/prompt.js';
import { compileBoard, fallbackBoard } from '../planner/board.js';
import {
  REPRESENTATION_LADDER,
  STATE_STRUCTURES,
  STRUCTURE_TEMPLATE,
  TEXT_MAX_WORDS,
  TOPOLOGY_STRUCTURES,
  boardLayoutForStructure,
  capTextWords,
  resolveRepresentation,
} from '../plan/visualSemantics.js';

test('representation ladder order is literal, metaphor, state, topology, labeledPrimitive, text', () => {
  assert.deepEqual([...REPRESENTATION_LADDER], ['literal', 'metaphor', 'state', 'topology', 'labeledPrimitive', 'text']);
  assert.equal(TEXT_MAX_WORDS, 8);
});

test('text rung caps labels at eight words', () => {
  const long = 'one two three four five six seven eight nine ten eleven twelve';
  assert.equal(capTextWords(long).split(' ').length, 8);
  assert.equal(capTextWords(long), 'one two three four five six seven eight');
  assert.equal(capTextWords('short claim fits'), 'short claim fits');
  const decided = resolveRepresentation('later work builds on this', [], '');
  assert.equal(decided.representation, 'text');
  assert.ok(capTextWords('later work builds on this').split(' ').length <= TEXT_MAX_WORDS);
});

test('visual-semantics module carries no lesson-topic vocabulary', () => {
  // Banned words are drawn from the frozen benchmark's lesson topics; the
  // module must decide on generic role cues only.
  const banned = [
    'induction', 'deduction', 'abduction', 'abductive',
    'photosynthesis', 'doughnut',
    'sensory', 'grounding', 'multimodal',
    'llm', 'scientific', 'invention', 'premise', 'reasoning', 'jump',
  ];
  const source = readFileSync(
    resolve('src/experimental/hypothesis/v1_claude/plan/visualSemantics.ts'),
    'utf8',
  ).toLowerCase();
  assert.ok(source.length > 0);
  for (const word of banned) {
    assert.ok(!source.includes(word), `module source must not contain lesson-topic word "${word}"`);
  }
});

test('resolveRepresentation climbs the ladder on generic cues only', () => {
  assert.equal(resolveRepresentation('the gate stands open', ['gate', 'key']).representation, 'literal');
  assert.equal(resolveRepresentation('verify the amount before release', ['check', 'meter']).representation, 'metaphor');
  const state = resolveRepresentation('only two may pass at once', []);
  assert.equal(state.structure, 'constraint');
  assert.equal(state.representation, 'state');
  const topology = resolveRepresentation('compare alpha with beta', []);
  assert.equal(topology.structure, 'comparison');
  assert.equal(topology.representation, 'topology');
  const boxed = resolveRepresentation('later work builds on this', [], 'backing material restated here');
  assert.equal(boxed.representation, 'labeledPrimitive');
  const text = resolveRepresentation('later work builds on this', [], '');
  assert.equal(text.representation, 'text');
  for (const decided of [state, topology, boxed, text]) {
    assert.ok(decided.rationale.length > 0);
  }
});

test('literal rung matches multi-word catalog names by consecutive token subsequence', () => {
  // Fail-pre: tokens.has(name) only matched single-word names.
  const hit = resolveRepresentation('the store front stands open', ['store front']);
  assert.equal(hit.representation, 'literal');
  const miss = resolveRepresentation('the store is near the front gate', ['store front']);
  assert.notEqual(miss.representation, 'literal', 'non-consecutive words must not count as a literal match');
});

test('state and topology structures partition the full structure set', () => {
  assert.deepEqual(
    [...STATE_STRUCTURES, ...TOPOLOGY_STRUCTURES].sort(),
    ['accumulation', 'cause', 'comparison', 'constraint', 'exception', 'feedback', 'hierarchy', 'selection', 'sequence', 'threshold', 'tradeoff', 'transformation'],
  );
});

test('structure maps to the documented topology table', () => {
  assert.deepEqual(STRUCTURE_TEMPLATE, {
    comparison: 'compare_2',
    cause: 'convergence',
    transformation: 'chain',
    constraint: 'threshold',
    tradeoff: 'weighted_blend',
    sequence: 'chain',
    hierarchy: 'layered_stack',
    selection: 'list_icon',
    feedback: 'cycle',
    accumulation: 'convergence',
    threshold: 'threshold',
    exception: 'list_icon',
  });
  const flat = { fanOut: 0, fanIn: 0, edges: 0 };
  assert.equal(boardLayoutForStructure('comparison', flat, 2), 'compare');
  assert.equal(boardLayoutForStructure('comparison', flat, 4), 'list');
  assert.equal(boardLayoutForStructure('sequence', flat, 3), 'flow');
  assert.equal(boardLayoutForStructure('feedback', flat, 3), 'cycle');
  assert.equal(boardLayoutForStructure('hierarchy', flat, 3), 'hub');
  assert.equal(boardLayoutForStructure('cause', { fanOut: 2, fanIn: 1, edges: 2 }, 3), 'fan_out');
  assert.equal(boardLayoutForStructure('cause', { fanOut: 1, fanIn: 2, edges: 2 }, 4), 'convergence');
  assert.equal(boardLayoutForStructure('cause', { fanOut: 1, fanIn: 1, edges: 2 }, 3), 'flow');
  assert.equal(boardLayoutForStructure('constraint', flat, 2), 'list');
});

// Topic-neutral scene builder: every fact comes from its own evidence refs.
function makeInput(opts: {
  sceneId: string;
  heading: string;
  plainText: string;
  concepts: Array<{ id: string; label: string }>;
  mentions: Array<{ id: string; phrase: string }>;
  relations?: Array<{ from: string; to: string; type: string }>;
}): PlannerSceneInput {
  const ref = (id: string, quote: string, start: number) => ({
    sourceId: 'vsr_doc', spanId: `vsr_${id}`, startChar: start, endChar: start + quote.length,
    startLine: 1, endLine: 1, quote,
  });
  const conceptRefs = new Map(opts.concepts.map((concept, i) => [concept.id, ref(`c${i}`, `${concept.label} shown`, i * 40)]));
  const relationRefs = new Map((opts.relations ?? []).map((relation, i) => [`${relation.from}>${relation.to}`, ref(`r${i}`, `${relation.from} ${relation.type} ${relation.to}`, 500 + i * 40)]));
  return {
    sceneId: opts.sceneId,
    raw: opts.plainText,
    plainText: opts.plainText,
    mentions: opts.mentions,
    teachingContext: {
      requireEvidence: true,
      sourceId: 'vsr_doc',
      displayText: opts.heading,
      sourceEvidenceRefs: [...conceptRefs.values(), ...relationRefs.values()],
      concepts: opts.concepts.map((concept) => ({
        id: concept.id, label: concept.label, kind: 'entity',
        definition: `${concept.label} definition`, evidenceRefs: [conceptRefs.get(concept.id)!],
      })),
      relations: (opts.relations ?? []).map((relation) => ({
        from: relation.from, to: relation.to, type: relation.type,
        evidenceRefs: [relationRefs.get(`${relation.from}>${relation.to}`)!],
      })),
    },
    candidates: {},
  };
}

test('fallbackBoard picks compare layout for a comparison claim', () => {
  const input = makeInput({
    sceneId: 'vsr_compare',
    heading: 'Alpha or Beta',
    plainText: 'compare alpha with beta',
    concepts: [{ id: 'c_a', label: 'Alpha' }, { id: 'c_b', label: 'Beta' }],
    mentions: [{ id: 'm_a', phrase: 'alpha' }, { id: 'm_b', phrase: 'beta' }],
    relations: [{ from: 'c_a', to: 'c_b', type: 'compares' }],
  });
  const board = fallbackBoard(input);
  assert.equal(board.layout, 'compare');
  assert.equal(board.visual.kind, 'comparison');
  const compiled = compileBoard(board, input);
  assert.equal(compiled.spec.template, 'compare_2');
  assert.equal(compiled.spec.edges.length, 1);
});

test('fallbackBoard keeps chain layout for sequence claims and convergence for fan claims', () => {
  const chain = makeInput({
    sceneId: 'vsr_chain',
    heading: 'Warming then settling',
    plainText: 'first warming, then rising, then settling',
    concepts: [{ id: 'm1', label: 'Warming' }, { id: 'm2', label: 'Rising' }, { id: 'm3', label: 'Settling' }],
    mentions: [{ id: 'm1', phrase: 'warming' }, { id: 'm2', phrase: 'rising' }, { id: 'm3', phrase: 'settling' }],
    relations: [{ from: 'm1', to: 'm2', type: 'feeds' }, { from: 'm2', to: 'm3', type: 'feeds' }],
  });
  assert.equal(fallbackBoard(chain).layout, 'flow');
  assert.equal(compileBoard(fallbackBoard(chain), chain).spec.template, 'chain');

  const fan = makeInput({
    sceneId: 'vsr_fan',
    heading: 'Blending makes paste',
    plainText: 'grit and water go into blending, which makes paste',
    concepts: [{ id: 'f_a', label: 'Grit' }, { id: 'f_b', label: 'Water' }, { id: 'f_p', label: 'Blending' }, { id: 'f_o', label: 'Paste' }],
    mentions: [{ id: 'n_a', phrase: 'grit' }, { id: 'n_b', phrase: 'water' }, { id: 'n_p', phrase: 'blending' }, { id: 'n_o', phrase: 'paste' }],
    relations: [
      { from: 'f_a', to: 'f_p', type: 'feeds' },
      { from: 'f_b', to: 'f_p', type: 'feeds' },
      { from: 'f_p', to: 'f_o', type: 'produces' },
    ],
  });
  assert.equal(fallbackBoard(fan).layout, 'convergence');
});

test('fallbackBoard defaults abstract claims to a list board', () => {
  const input = makeInput({
    sceneId: 'vsr_abstract',
    heading: 'Later work',
    plainText: 'later work builds on this',
    concepts: [{ id: 'm_d', label: 'Later work' }],
    mentions: [{ id: 'm_d', phrase: 'later work' }],
  });
  const board = fallbackBoard(input);
  assert.equal(board.layout, 'list');
  assert.equal(compileBoard(board, input).spec.template, 'list_icon');
});
