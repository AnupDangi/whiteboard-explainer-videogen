import type { PlannerSceneInput } from '../../planner/prompt.js';
import type { ScenePlanningContext } from '../../planner/context.js';
import { BOARD_SCHEMA_VERSION, type Board } from '../../planner/board.js';

// Synthetic, topic-neutral scene: two inputs combine through a process into an output.
export function makeScene(words: { a: string; b: string; p: string; o: string }, prefix = 'src'): PlannerSceneInput {
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

export const WORDS = { a: 'flour', b: 'water', p: 'mixing', o: 'dough' };
export const goodBoard = (w = WORDS, prefix = 'src'): Board => ({
  schemaVersion: BOARD_SCHEMA_VERSION,
  title: 'ignored when the heading fits',
  layout: 'convergence',
  visual: { kind: 'process' },
  nodes: [
    { id: 'n1', mention: 'm_a', concept: `${prefix}_a`, representation: { kind: 'literal' }, label: w.a, role: 'input' },
    { id: 'n2', mention: 'm_b', concept: `${prefix}_b`, representation: { kind: 'literal' }, label: w.b, role: 'input' },
    { id: 'n3', mention: 'm_p', concept: `${prefix}_p`, representation: { kind: 'labelled' }, label: w.p, role: 'process' },
    { id: 'n4', mention: 'm_o', concept: `${prefix}_o`, representation: { kind: 'literal' }, label: w.o, role: 'output' },
  ],
});
