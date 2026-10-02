import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneNarrationDraftSchema, type SceneNarrationDraft } from '../narration/beat-narration/types.js';
import { validateSceneNarration, type NarrationContext } from '../narration/beat-narration/validate.js';
import { compileSceneNarration } from '../narration/beat-narration/compile.js';
import { beatIntervals } from '../narration/beat-narration/intervals.js';
import { buildNarrationPrompt } from '../narration/beat-narration/prompt.js';
import { writeBeatNarration } from '../narration/beat-narration/generate.js';
import { tokenizeWords } from '../narration/align.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import type { ModelClient } from '../llm/modelClient.js';

const planBeat = (n: number, claimIds: string[]): TeachingBeat => ({
  beatId: `scene.b${n}`, sceneId: 'scene', order: n, claimIds, learnerDelta: 'delta', beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'spatial_model',
  entities: [{ conceptId: 'frame' }], relationships: [], misconceptionIds: [], narrationGoal: 'Make clear that a call pushes a frame.', visualInvariant: 'a frame is visible', mutedMeaning: 'a pile grows',
  narrationOnly: false, persistence: 'scene', pauseIntent: 'micro', evidenceSpanIds: ['s1'],
});
const beats = [planBeat(1, ['c1']), planBeat(2, ['c2'])];
const ctx: NarrationContext = { sceneId: 'scene', beats, allowedNumbers: new Set(['3']), durationSec: 20, emphasisCandidates: ['frame', 'stack'] };
const draft = (over: Partial<SceneNarrationDraft['beats'][number]>[] = []): SceneNarrationDraft => SceneNarrationDraftSchema.parse({
  beats: [
    { beatId: 'scene.b1', sentences: ['Every call pushes a new frame onto the stack.', 'The frame remembers where to return.'], claimSentences: [{ claimId: 'c1', sentenceIndex: 0 }], emphasisTerms: ['frame'], ...(over[0] ?? {}) },
    { beatId: 'scene.b2', sentences: ['When a call returns, its frame is popped off the top.'], claimSentences: [{ claimId: 'c2', sentenceIndex: 0 }], emphasisTerms: [], ...(over[1] ?? {}) },
  ],
});

test('the narration draft is strict and bounded', () => {
  assert.equal(SceneNarrationDraftSchema.safeParse({ beats: [] }).success, false);
  assert.equal(SceneNarrationDraftSchema.safeParse({ beats: [{ beatId: 'x', sentences: [], claimSentences: [], emphasisTerms: [] }] }).success, false);
  assert.equal(SceneNarrationDraftSchema.safeParse({ beats: [{ beatId: 'x', sentences: ['a.'], claimSentences: [], emphasisTerms: [], extra: 1 }] }).success, false);
  assert.ok(draft());
});

test('a faithful narration of every beat is valid', () => {
  assert.deepEqual(validateSceneNarration(draft(), ctx), []);
});

test('problems carry pointers: wrong or missing beat ids, uncovered claims, bad anchors, screen references, stage directions, repeats, unsupported numbers', () => {
  const bad = draft([
    { beatId: 'scene.b9', sentences: ['Look at the box on the left.', 'Now draw an arrow.', 'It holds 7 frames.'], claimSentences: [{ claimId: 'ghost', sentenceIndex: 3 }] },
    { sentences: ['Look at the box on the left.'], claimSentences: [] },
  ]);
  const byPath = new Map(validateSceneNarration(bad, ctx).map((p) => [(p as { path: string }).path, (p as { message: string }).message]));
  assert.match(byPath.get('/beats/0/beatId')!, /scene\.b1/);
  assert.match(byPath.get('/beats/0/sentences/0')!, /screen/);
  assert.match(byPath.get('/beats/0/sentences/1')!, /stage direction/);
  assert.match(byPath.get('/beats/0/sentences/2')!, /number 7/);
  assert.match(byPath.get('/beats/0/claimSentences/0/claimId')!, /unknown claim/);
  assert.match(byPath.get('/beats/1/claimSentences')!, /claim c2/);
  assert.match(byPath.get('/beats/1/sentences/0')!, /repeats|screen/);
});

test('a scene far over its spoken budget is a problem; a mild overrun is only a warning because audio sets the clock', () => {
  const long = Array.from({ length: 4 }, (_, i) => `Sentence number ${i} says that a call pushes one frame onto the stack and then waits for the base case to return a value.`);
  const over = draft([{ sentences: long, claimSentences: [{ claimId: 'c1', sentenceIndex: 0 }] }, { sentences: long.map((s) => `${s} More.`), claimSentences: [{ claimId: 'c2', sentenceIndex: 0 }] }]);
  assert.ok(validateSceneNarration(over, { ...ctx, allowedNumbers: new Set(['0', '1', '2', '3']), durationSec: 10 }).some((p) => (p as { path: string }).path === '/beats' && /too long/.test((p as { message: string }).message)));
  assert.deepEqual(validateSceneNarration(draft(), { ...ctx, durationSec: 12 }), [], 'about 25 words in 12 s is within the 1.5x ceiling');
});

test('compile joins sentences into one scene text with exact beat and sentence spans, and derives claim spans from the anchors', () => {
  const c = compileSceneNarration('scene', draft(), beats);
  assert.equal(c.text, 'Every call pushes a new frame onto the stack. The frame remembers where to return. When a call returns, its frame is popped off the top.');
  assert.deepEqual(c.beats.map((b) => b.beatId), ['scene.b1', 'scene.b2']);
  assert.deepEqual(c.beats[0]!.sentenceIds, ['scene.b1.s1', 'scene.b1.s2']);
  assert.deepEqual(c.beats[0]!.speakingStyle, { emphasisTerms: ['frame'] });
  assert.equal(c.beats[1]!.speakingStyle, undefined);
  const first = c.beatSpans[0]!;
  assert.equal(c.text.slice(first.charStart, first.charEnd), 'Every call pushes a new frame onto the stack. The frame remembers where to return.');
  assert.equal(c.text.slice(first.sentenceSpans[1]!.charStart, first.sentenceSpans[1]!.charEnd), 'The frame remembers where to return.');
  assert.deepEqual(c.claimSpans.map((s) => [s.claimId, s.exactText]), [['c1', 'Every call pushes a new frame onto the stack.'], ['c2', 'When a call returns, its frame is popped off the top.']]);
  assert.equal(c.text.slice(c.claimSpans[1]!.plainStart, c.claimSpans[1]!.plainEnd), c.claimSpans[1]!.exactText);
});

test('beat intervals come from the aligned words by token position, not from any estimate', () => {
  const c = compileSceneNarration('scene', draft(), beats);
  const tokens = tokenizeWords(c.text);
  const words = tokens.map((w, i) => ({ w, startMs: i * 300, endMs: i * 300 + 250 }));
  const intervals = beatIntervals(c, words);
  const n1 = tokenizeWords(c.beats[0]!.text ?? '').length;
  assert.equal(intervals[0]!.startMs, 0);
  assert.equal(intervals[0]!.endMs, (n1 - 1) * 300 + 250);
  assert.equal(intervals[1]!.startMs, n1 * 300);
  assert.equal(intervals[1]!.endMs, (tokens.length - 1) * 300 + 250);
  assert.equal(intervals[0]!.sentences[0]!.sentenceId, 'scene.b1.s1');
  assert.equal(intervals[0]!.sentences[1]!.startMs, tokenizeWords(c.beatSpans[0]!.sentenceSpans[0] ? c.text.slice(c.beatSpans[0]!.sentenceSpans[0]!.charStart, c.beatSpans[0]!.sentenceSpans[0]!.charEnd) : '').length * 300);
  assert.throws(() => beatIntervals(c, words.slice(1)), /do not match/);
});

test('the narration prompt carries the beat plan and the teaching rules and no topic knowledge', () => {
  const { system, user } = buildNarrationPrompt(ctx, { title: 'T', goal: 'g' }, 'SOURCE EXCERPT');
  assert.match(system, /audio/i);
  assert.match(system, /never refer to the screen/i);
  assert.match(user, /scene\.b1/);
  assert.match(user, /Make clear that a call pushes a frame/);
  assert.match(user, /SOURCE EXCERPT/);
});

const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0.0002 };
const scripted = (replies: string[]): { client: ModelClient; requests: Array<{ schemaName: string }> } => {
  const requests: Array<{ schemaName: string }> = [];
  return { requests, client: { provider: 'fake', chat: async (r) => { requests.push({ schemaName: r.schemaName }); return { content: replies[requests.length - 1] ?? '{}', finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage }; } } };
};
const goodJson = JSON.stringify(draft());

test('writeBeatNarration returns compiled narration and records a stage report', async () => {
  const { client } = scripted([goodJson]);
  const result = await writeBeatNarration({ ctx, scene: { title: 'T', goal: 'g' }, sourceExcerpt: 'x' }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client });
  assert.equal(result.value?.text.startsWith('Every call pushes'), true);
  assert.equal(result.reports[0]!.stage, 'beat-narration');
  assert.equal(result.reports[0]!.firstTryValid, true);
});

test('a screen reference is repaired by patching that one sentence', async () => {
  const bad = JSON.stringify(draft([{ sentences: ['Look at the box on the left.', 'The frame remembers where to return.'] }]));
  const patch = JSON.stringify({ patches: [{ op: 'replace', path: '/beats/0/sentences/0', valueJson: JSON.stringify('Every call pushes a new frame onto the stack.') }] });
  const { client, requests } = scripted([bad, patch]);
  const result = await writeBeatNarration({ ctx, scene: { title: 'T', goal: 'g' }, sourceExcerpt: 'x' }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client });
  assert.equal(result.value?.beats[0]!.sentenceIds.length, 2);
  assert.equal(requests[1]!.schemaName, 'json_patch');
});

test('speech with a symbol the voice and aligner cannot read is a pointer problem naming the spoken word', () => {
  const symbolic = draft([{ sentences: ['The time constant tau equals R times C, written τ.'] }]);
  const problems = validateSceneNarration(symbolic, ctx) as Array<{ path: string; message: string }>;
  assert.ok(problems.some((p) => p.path === '/beats/0/sentences/0' && /cannot be spoken or aligned/.test(p.message)));
});
