import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBoard } from '../planner/board.js';
import { makeScene, goodBoard, WORDS } from './support/boardScene.js';
const scene = makeScene(WORDS);

test('a source-grounded contains relation adds a dashed container around both concepts and keeps the factual edge', () => {
  const input = structuredClone(scene) as typeof scene;
  const relations = input.teachingContext!.relations!;
  assert.ok(relations.length > 0);
  const tweaked = { ...input, teachingContext: { ...input.teachingContext!, relations: relations.map((relation, index) => (index === 0 ? { ...relation, type: 'contains' } : relation)) } } as typeof scene;
  const compiled = compileBoard(goodBoard(), tweaked);
  const container = compiled.spec.elements.find((element) => element.prim === 'container') as { children: string[]; style: string } | undefined;
  assert.ok(container, 'container emitted');
  assert.equal(container!.style, 'dashed');
  assert.ok(container!.children.length >= 2);
  assert.ok(compiled.spec.edges.some((edge) => edge.factualRelation?.type === 'contains'), 'factual edge retained');
});

test('no contains relation, no container (topic-independent)', () => {
  const compiled = compileBoard(goodBoard(), scene);
  assert.equal(compiled.spec.elements.filter((element) => element.prim === 'container').length, 0);
});

import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { runClaudeGates } from '../validate/gates.js';

test('a contained board flows through resolve, layout, timeline and gates with no dangling event or missing evidence', () => {
  const input = makeScene(WORDS);
  const relations = input.teachingContext!.relations!;
  const tweaked = { ...input, teachingContext: { ...input.teachingContext!, relations: relations.map((relation, index) => (index === 0 ? { ...relation, type: 'contains' } : relation)) } } as typeof input;
  const compiled = compileBoard(goodBoard(), tweaked);
  assert.deepEqual(compiled.problems, []);
  const laid = layoutScene(resolveScene(compiled.spec));
  const container = laid.elements.find((element) => element.element.prim === 'container');
  assert.ok(container, 'container laid out');
  const mentions = input.mentions.map((mention, index) => ({ sceneId: input.sceneId, mentionId: mention.id, startMs: 1000 + index * 2500, endMs: 1400 + index * 2500, ambiguous: false, wordRange: [index, index + 1] as [number, number] }));
  const timeline = compileTimelineFull(laid, mentions, 0, 15_000);
  const gates = runClaudeGates(laid, timeline);
  assert.ok(!gates.failures.some((failure) => /lacks valid source evidence|dangling|Unknown element/.test(failure.message + failure.code)), gates.failures.map((failure) => failure.message).join(' | '));
});

import { toNeutralElements, toNeutralEvents } from '../validate/gates.js';

test('a container draw event never reaches the neutral bundle as an unknown element', () => {
  const input = makeScene(WORDS);
  const relations = input.teachingContext!.relations!;
  const tweaked = { ...input, teachingContext: { ...input.teachingContext!, relations: relations.map((relation, index) => (index === 0 ? { ...relation, type: 'contains' } : relation)) } } as typeof input;
  const compiled = compileBoard(goodBoard(), tweaked);
  const laid = layoutScene(resolveScene(compiled.spec));
  const mentions = input.mentions.map((mention, index) => ({ sceneId: input.sceneId, mentionId: mention.id, startMs: 1000 + index * 2500, endMs: 1400 + index * 2500, ambiguous: false, wordRange: [index, index + 1] as [number, number] }));
  const timeline = compileTimelineFull(laid, mentions, 0, 15_000);
  assert.ok(timeline.events.some((event) => event.elementId.startsWith('box_')), 'container is drawn');
  const known = new Set(toNeutralElements(laid).map((element) => element.id));
  for (const event of toNeutralEvents(laid, timeline)) assert.ok(known.has(event.elementId), `${event.elementId} is a neutral element`);
});
