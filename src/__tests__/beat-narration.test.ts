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
import { deriveClaimIdentity } from '../evidence/claimIdentity.js';

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

test('an anchored claim sentence cannot reverse explicit polarity or comparison cues', () => {
  const canonicalClaims = {
    c1: { statement: 'Not safe during pregnancy.' },
    c2: { statement: 'Voltage is less than 5 V.' },
  };
  const reversedPolarity = draft([{ sentences: ['Safe during pregnancy.', 'The frame remembers where to return.'] }]);
  const polarityProblems = validateSceneNarration(reversedPolarity, { ...ctx, canonicalClaims });
  assert.ok(polarityProblems.some((problem) => (problem as { path: string }).path === '/beats/0/sentences/0' && /polarity must remain negative/.test((problem as { message: string }).message)));

  const comparisonClaim = { c1: { statement: 'Voltage is less than 5 V.' } };
  const reversedComparison = draft([{ sentences: ['Voltage is greater than 5 volts.', 'The frame remembers where to return.'] }]);
  const comparisonProblems = validateSceneNarration(reversedComparison, { ...ctx, allowedNumbers: new Set(['3', '5']), canonicalClaims: comparisonClaim });
  assert.ok(comparisonProblems.some((problem) => (problem as { path: string }).path === '/beats/0/sentences/0' && /comparison must remain lt 5/.test((problem as { message: string }).message)));
});

test('anchored examples and analogies keep their explicit nonfactual framing in narration', () => {
  const example = draft([{ sentences: ['For example, every call is a frame.', 'The frame remembers where to return.'] }]);
  const exampleContext = { ...ctx, canonicalClaims: { c1: { statement: 'For example, every call is a frame.', epistemicType: 'illustrative_example' as const } } };
  assert.deepEqual(validateSceneNarration(example, exampleContext), []);
  const unframedExample = draft([{ sentences: ['Every call is a frame.', 'The frame remembers where to return.'] }]);
  assert.ok(validateSceneNarration(unframedExample, exampleContext).some((problem) => /epistemic framing mismatch: needs explicit example framing/.test((problem as { message: string }).message)));

  const analogy = draft([{ sentences: ['A queue is like a line at a shop.', 'The frame remembers where to return.'] }]);
  const analogyContext = { ...ctx, canonicalClaims: { c1: { statement: 'A queue is like a line at a shop.', epistemicType: 'analogy' as const } } };
  assert.deepEqual(validateSceneNarration(analogy, analogyContext), []);
  const unframedAnalogy = draft([{ sentences: ['A queue stores tasks.', 'The frame remembers where to return.'] }]);
  assert.ok(validateSceneNarration(unframedAnalogy, analogyContext).some((problem) => /epistemic framing mismatch: needs explicit analogy framing/.test((problem as { message: string }).message)));
});

test('claim identity preserves graph concepts and directed predicates with controlled active/passive aliases', () => {
  const graphConcepts = [{ id: 'alpha', label: 'Alpha' }, { id: 'beta', label: 'Beta' }];
  const source = {
    statement: 'Alpha causes Beta.', conceptIds: ['alpha', 'beta'],
    relations: [{ from: 'alpha', to: 'beta', type: 'causes' as const }],
  };
  const identity = deriveClaimIdentity(source, graphConcepts);
  const canonicalClaims = { c1: { statement: source.statement, identity } };

  const aligned = draft([{ sentences: ['Alpha leads to Beta.', 'The frame remembers where to return.'] }]);
  assert.deepEqual(validateSceneNarration(aligned, { ...ctx, canonicalClaims }), []);

  const passive = draft([{ sentences: ['Beta is caused by Alpha.', 'The frame remembers where to return.'] }]);
  assert.deepEqual(validateSceneNarration(passive, { ...ctx, canonicalClaims }), []);

  const subjectSwap = draft([{ sentences: ['Beta causes Alpha.', 'The frame remembers where to return.'] }]);
  assert.ok(validateSceneNarration(subjectSwap, { ...ctx, canonicalClaims }).some((problem) => /identity mismatch: Alpha causes Beta has reversed direction/.test((problem as { message: string }).message)));

  const predicateSwap = draft([{ sentences: ['Alpha supports Beta.', 'The frame remembers where to return.'] }]);
  assert.ok(validateSceneNarration(predicateSwap, { ...ctx, canonicalClaims }).some((problem) => /identity mismatch: Alpha–Beta predicate changed from causes to supports/.test((problem as { message: string }).message)));

  const conceptOnly = deriveClaimIdentity({ statement: 'Alpha and Beta are linked.', conceptIds: ['alpha', 'beta'], relations: [] }, graphConcepts);
  assert.deepEqual(validateSceneNarration(draft([{ sentences: ['Alpha and Beta remain linked.', 'The frame remembers where to return.'] }]), { ...ctx, canonicalClaims: { c1: { statement: 'Alpha and Beta are linked.', identity: conceptOnly } } }), []);
  assert.ok(validateSceneNarration(draft([{ sentences: ['Alpha remains linked.', 'The frame remembers where to return.'] }]), { ...ctx, canonicalClaims: { c1: { statement: 'Alpha and Beta are linked.', identity: conceptOnly } } }).some((problem) => /explicit concept Beta \(beta\) is missing/.test((problem as { message: string }).message)));
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

test('Greek text is allowed while mathematical operators remain a pointer problem', () => {
  const greek = draft([{ sentences: ['The time constant tau equals R times C, written τ.'] }]);
  assert.equal(validateSceneNarration(greek, ctx).some((p) => /cannot be spoken or aligned/.test((p as { message: string }).message)), false);
  const symbolic = draft([{ sentences: ['Heat flows from A → B.'] }]);
  const problems = validateSceneNarration(symbolic, ctx) as Array<{ path: string; message: string }>;
  assert.ok(problems.some((p) => p.path === '/beats/0/sentences/0' && /cannot be spoken or aligned/.test(p.message)));
});

test('Unicode decimal digits are checked against the same factual-number allowlist', () => {
  const devanagari = draft([{ sentences: ['पानी ३ चरणों से गुजरता है।'] }]);
  assert.equal(validateSceneNarration(devanagari, { ...ctx, allowedNumbers: new Set(['3']) }).some((p) => /number 3 is not/.test((p as { message: string }).message)), false);
  assert.ok(validateSceneNarration(devanagari, { ...ctx, allowedNumbers: new Set() }).some((p) => /number 3 is not/.test((p as { message: string }).message)));
});

test('the narration prompt names the language and tells the speaker where the scene sits in one continuous lesson', async () => {
  const { buildNarrationPrompt } = await import('../narration/beat-narration/prompt.js');
  const scene = { title: 'Why it moves', goal: 'explain the flow' };
  const first = buildNarrationPrompt({ ...ctx, language: 'hi', lesson: { title: 'Lesson', sceneIndex: 0, sceneCount: 3, next: { title: 'Balance', goal: 'when it stops' } } }, scene, 'src');
  assert.match(first.system, /idiomatic Hindi/); assert.match(first.system, /FIRST of 3 scenes/); assert.match(first.system, /Open with the question or puzzle/);
  assert.match(first.system, /retaining familiar English technical terms/); assert.match(first.system, /Explain unfamiliar English terms in the requested language/);
  assert.match(first.user, /The next scene will cover: Balance/); assert.doesNotMatch(first.user, /previous scene taught/);
  const last = buildNarrationPrompt({ ...ctx, lesson: { title: 'Lesson', sceneIndex: 2, sceneCount: 3, previous: { title: 'Why it moves', goal: 'flow' } } }, scene, 'src');
  assert.match(last.system, /LAST of 3 scenes/); assert.match(last.system, /two-sentence recap/); assert.match(last.system, /idiomatic English/);
  assert.match(last.system, /Speak in English throughout/);
  assert.match(last.user, /previous scene taught: Why it moves/);
});

test('the spoken-word budget scales with the language: Hindi gets more words per second than English', async () => {
  const { wordsPerSec } = await import('../plan/analyze.js');
  assert.equal(wordsPerSec(), 2.25); assert.equal(wordsPerSec('en'), 2.25); assert.ok(wordsPerSec('hi') > wordsPerSec('en'));
  const sentence = Array.from({ length: 15 }, (_, i) => `word${i}`).join(' ');
  const long = draft([{ sentences: [sentence, `${sentence} a`, `${sentence} b`, `${sentence} c`] }]);
  assert.ok((validateSceneNarration(long, { ...ctx, durationSec: 8 }) as Array<{ message: string }>).some((p) => /too long/.test(p.message)));
  assert.ok(!(validateSceneNarration(long, { ...ctx, durationSec: 12, language: 'hi' }) as Array<{ message: string }>).some((p) => /too long/.test(p.message)));
});

test('CJK narration uses Intl word segmentation for its spoken-word budget', () => {
  const mandarin = SceneNarrationDraftSchema.parse({ beats: [
    { beatId: 'scene.b1', sentences: ['你好世界欢迎大家。'], claimSentences: [{ claimId: 'c1', sentenceIndex: 0 }], emphasisTerms: [] },
    { beatId: 'scene.b2', sentences: ['欢迎大家来到世界。'], claimSentences: [{ claimId: 'c2', sentenceIndex: 0 }], emphasisTerms: [] },
  ] });
  const findings = validateSceneNarration(mandarin, { ...ctx, language: 'zh', durationSec: 0.5 }) as Array<{ message: string }>;
  assert.ok(findings.some((problem) => /too long/.test(problem.message)));
  assert.deepEqual(tokenizeWords('你好世界，欢迎大家。', 'zh').length > 1, true);
});

test('a length revision states the measured speaking rate and target, shows the previous speech, and is only valid inside the word window', () => {
  const revising: NarrationContext = { ...ctx, revision: { direction: 'shorten', targetWords: 18, measuredWordsPerSec: 2.1, previousSeconds: 32, previous: [{ beatId: 'scene.b1', sentences: ['Every call pushes a new frame onto the stack.', 'The frame remembers where to return.'] }, { beatId: 'scene.b2', sentences: ['When a call returns, its frame is popped off the top.'] }] } };
  const { system, user } = buildNarrationPrompt(revising, { title: 'T', goal: 'G' }, 'SRC');
  assert.match(user, /REVISION/);
  assert.match(user, /at most 18 spoken words/);
  assert.match(user, /2\.1 words per second/);
  assert.match(user, /Every call pushes a new frame onto the stack\./);
  assert.match(system + user, /keep every claim|keep each claim|claims/i);
  const words = (d: SceneNarrationDraft) => d.beats.reduce((n, b) => n + b.sentences.reduce((m, s) => m + tokenizeWords(s).length, 0), 0);
  assert.equal(words(draft()), 26);
  const tooLong = validateSceneNarration(draft(), revising);
  assert.ok(tooLong.some((p) => (p as { path: string }).path === '/beats' && /18/.test((p as { message: string }).message)), 'above the window for a shortening');
  const fits = draft([{ sentences: ['Every call pushes a frame onto the stack.', 'It remembers its return.'] }, { sentences: ['A return pops that frame off.'] }]);
  assert.ok(words(fits) >= 15 && words(fits) <= 21, `${words(fits)} words`);
  assert.deepEqual(validateSceneNarration(fits, revising), []);
  assert.deepEqual(validateSceneNarration(draft(), ctx), [], 'without a revision there is no window');
});

test('a shortening window sits at or below the target and a lengthening window at or above it', () => {
  const base = { targetWords: 18, measuredWordsPerSec: 2, previousSeconds: 10, previous: [] as Array<{ beatId: string; sentences: string[] }> };
  const eighteen = draft([{ sentences: ['Every call pushes a frame onto the stack.', 'It remembers its return.'] }, { sentences: ['A return pops that frame off.'] }]);
  assert.deepEqual(validateSceneNarration(eighteen, { ...ctx, revision: { ...base, direction: 'shorten' } }), []);
  assert.deepEqual(validateSceneNarration(eighteen, { ...ctx, revision: { ...base, direction: 'lengthen' } }), []);
  const lean = draft([{ sentences: ['Every call pushes a frame onto the stack.'] }, { sentences: ['A return pops that frame.'] }]);
  const n = (d: SceneNarrationDraft) => d.beats.reduce((a, b) => a + b.sentences.reduce((m, s) => m + tokenizeWords(s).length, 0), 0);
  assert.ok(n(lean) < 18 - 3 && n(lean) >= 13, `${n(lean)} words`);
  assert.ok(validateSceneNarration(lean, { ...ctx, revision: { ...base, targetWords: 20, direction: 'lengthen' } }).length > 0, 'a lengthening cannot end short of its target');
});

test('ASCII maths operators are rejected so the aligner transcript matches what the voice says', () => {
  for (const sentence of ['Multiply by 1 + r each year.', 'So A = P times the factor.', 'Growth is r^n over time.']) {
    const problems = validateSceneNarration(draft([{ sentences: [sentence] }]), ctx) as Array<{ path: string; message: string }>;
    assert.ok(problems.some((p) => p.path === '/beats/0/sentences/0' && /cannot be spoken or aligned/.test(p.message)), sentence);
  }
  assert.equal((validateSceneNarration(draft([{ sentences: ['Add one to the rate, then multiply.'] }]), ctx) as Array<{ message: string }>).some((p) => /cannot be spoken or aligned/.test(p.message)), false);
});

test('a claim anchored past the last sentence is moved to the last sentence, ledgered, and only when the rest is valid', async () => {
  const { clampClaimAnchors } = await import('../narration/beat-narration/validate.js');
  const off = draft([{ claimSentences: [{ claimId: 'c1', sentenceIndex: 3 }] }]);
  assert.ok((validateSceneNarration(off, ctx) as Array<{ message: string }>).some((p) => /outside this beat/.test(p.message)));
  const fixed = clampClaimAnchors(off, ctx);
  assert.ok(fixed);
  assert.equal(fixed.value.beats[0]!.claimSentences[0]!.sentenceIndex, 1);
  assert.equal(fixed.entries[0]!.path, '/beats/0/claimSentences/0/sentenceIndex');
  assert.equal(clampClaimAnchors(draft(), ctx), undefined, 'a valid draft is left alone');
});
