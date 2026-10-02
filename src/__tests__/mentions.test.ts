import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNarrationScene, parseMarkers } from '../narration/markers.js';
import { alignFixture, alignedWordTimingProblems } from '../narration/align.js';
import { resolveMentions } from '../narration/resolveMentions.js';
import type { NarrationScript } from '../shared/types.js';

function scriptOf(raw: string): NarrationScript {
  return { schemaVersion: 'claude-narration-script/v1', scenes: [buildNarrationScene('s1', 'sec1', raw)] };
}

test('parseMarkers strips markers and records plain-text offsets', () => {
  const { plainText, mentions } = parseMarkers('The [[q|query]] meets [[k|the key]].');
  assert.equal(plainText, 'The query meets the key.');
  assert.equal(mentions.length, 2);
  assert.equal(plainText.slice(mentions[0].plainStart, mentions[0].plainEnd), 'query');
  assert.equal(plainText.slice(mentions[1].plainStart, mentions[1].plainEnd), 'the key');
});

test('resolveMentions: basic single mention resolves to the correct word span', () => {
  const script = scriptOf('The [[q|query]] arrives.');
  const audio = alignFixture(script, 4000);
  const { mentions, failures } = resolveMentions(script, audio);
  assert.equal(failures.length, 0);
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].mentionId, 'q');
  const words = audio.sceneWords.s1;
  assert.equal(words[mentions[0].wordRange[0]].w, 'query');
});

test('resolveMentions: repeated phrases resolve to sequential occurrences, not all to the first', () => {
  const script = scriptOf('[[k1|the key]] opens one door, then [[k2|the key]] opens another.');
  const audio = alignFixture(script, 6000);
  const { mentions, failures } = resolveMentions(script, audio);
  assert.equal(failures.length, 0);
  const [m1, m2] = mentions;
  assert.ok(m1.wordRange[0] < m2.wordRange[0], 'second "the key" mention must resolve after the first');
  assert.ok(m1.ambiguous, 'first occurrence had a later duplicate, so it is flagged ambiguous');
});

test('resolveMentions: punctuation attached to words does not block matching', () => {
  const script = scriptOf('We call it [[softmax|softmax]], a normalizing function.');
  const audio = alignFixture(script, 4000);
  const { mentions, failures } = resolveMentions(script, audio);
  assert.equal(failures.length, 0);
  assert.equal(mentions[0].mentionId, 'softmax');
});

test('resolveMentions: Unicode phrase (accented characters) resolves correctly', () => {
  const script = scriptOf('The [[cafe|café]] is warm and the [[cafe2|CAFÉ]] is also warm.');
  const audio = alignFixture(script, 4000);
  const { mentions, failures } = resolveMentions(script, audio);
  assert.equal(failures.length, 0);
  assert.equal(mentions.length, 2);
  assert.ok(mentions[0].wordRange[0] < mentions[1].wordRange[0]);
});

test('resolveMentions: curly possessives match curly or straight apostrophes in aligned words', () => {
  const script = scriptOf('The [[output|the model’s output]] matters.');
  const audio = alignFixture(script, 4000);
  assert.deepEqual(resolveMentions(script, audio).failures, []);

  const asciiAligned = {
    ...audio,
    sceneWords: {
      s1: audio.sceneWords.s1.map((word) => ({ ...word, w: word.w.replaceAll('’', "'") })),
    },
  };
  const resolved = resolveMentions(script, asciiAligned);
  assert.deepEqual(resolved.failures, []);
  assert.equal(resolved.mentions[0].mentionId, 'output');
  assert.deepEqual(resolved.mentions[0].wordRange, [1, 4]);
});

test('resolveMentions: a phrase absent from the actual aligned words is a hard missing-span failure, never silently dropped', () => {
  // In fixture mode, alignFixture tokenizes the SAME plainText the marker
  // phrase was substituted into, so the phrase is always self-consistently
  // present — a real "missing span" can only arise from an independent
  // audio source (real TTS/forced-alignment) whose transcript diverges from
  // the script, e.g. a mistranscribed or dropped word. This test simulates
  // that by hand-building an AlignedAudio whose words omit the phrase.
  const script = scriptOf('The [[ghost|missing phrase]] never appears in narration text.');
  const audio = alignFixture(script, 4000);
  const words = audio.sceneWords.s1.filter((w) => w.w !== 'missing' && w.w !== 'phrase');
  const tamperedAudio = { ...audio, sceneWords: { s1: words } };
  const { mentions, failures } = resolveMentions(script, tamperedAudio);
  assert.equal(mentions.length, 0);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, 'missing-span');
  assert.equal(failures[0].mentionId, 'ghost');
});

test('resolveMentions: ambiguous span (phrase repeated 3x) is flagged but still resolves deterministically', () => {
  const script = scriptOf('[[x|test]] test test — only the first "test" is a marker.');
  const audio = alignFixture(script, 4000);
  const { mentions, failures } = resolveMentions(script, audio);
  assert.equal(failures.length, 0);
  assert.equal(mentions[0].wordRange[0], 0); // first word in the scene
  assert.ok(mentions[0].ambiguous);
});

test('resolveMentions: empty-phrase marker is a distinct, recorded failure (not a crash)', () => {
  const script = scriptOf('This has an [[bad| ]] empty marker.');
  const audio = alignFixture(script, 4000);
  const { failures } = resolveMentions(script, audio);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, 'empty-phrase');
});

test('parseMarkers: an empty-phrase marker parses (not left literal) so resolveMentions records empty-phrase', () => {
  // Fail-pre: MARKER_RE required 1+ phrase chars, so [[bad|]] flowed literal to TTS.
  const { plainText, mentions } = parseMarkers('Say [[bad|]] aloud.');
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].id, 'bad');
  assert.equal(mentions[0].phrase, '');
  assert.ok(!plainText.includes('[['), 'marker syntax must not leak into TTS text');
  const script = scriptOf('Say [[bad|]] aloud.');
  const audio = alignFixture(script, 4000);
  const { failures } = resolveMentions(script, audio);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, 'empty-phrase');
});

test('alignFixture: total duration lands exactly on the requested target', () => {
  const script = scriptOf('Some narration text of a reasonable length for testing purposes.');
  const audio = alignFixture(script, 12345);
  assert.equal(audio.durationMs, 12345);
});

test('alignFixture: deterministic — identical input produces byte-identical word timings', () => {
  const script = scriptOf('Deterministic timing must never depend on wall-clock time.');
  const a = alignFixture(script, 5000);
  const b = alignFixture(script, 5000);
  assert.deepEqual(a, b);
});

test('measured word-clock validation accepts ordered fractional boundaries', () => {
  assert.deepEqual(alignedWordTimingProblems([
    { w: 'first', startMs: 0.1, endMs: 125.7 },
    { w: 'second', startMs: 125.8, endMs: 260.2 },
  ], 300), []);
});

test('measured word-clock validation blocks zero-duration intervals before planning', () => {
  const problems = alignedWordTimingProblems([
    { w: 'word', startMs: 120, endMs: 120 },
  ], 1000);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /invalid interval/);
});

test('resolveMentions: a marker that ends before a possessive matches the aligned possessive word', () => {
  const script = scriptOf('Turn [[e|the three-four-five example]]\'s square into [[s|a side]] length.');
  const audio = alignFixture(script, 6000);
  const { mentions, failures } = resolveMentions(script, audio);
  assert.deepEqual(failures, []);
  assert.equal(audio.sceneWords.s1[mentions[0]!.wordRange[1] - 1]!.w, "example's");
});

test('resolveMentions: a marker may name either half of a dash-joined aligner token', () => {
  const script = scriptOf('A [[x|cold start]]\u2014[[y|slow reply]]\u2014costs [[z|a user]] time.');
  const audio = alignFixture(script, 6000);
  // Real aligners keep "start\u2014slow" as one word.
  const glued = ['A', 'cold', 'start\u2014slow', 'reply\u2014costs', 'a', 'user', 'time.'];
  audio.sceneWords.s1 = glued.map((w, index) => ({ w, startMs: index * 800, endMs: index * 800 + 700 }));
  const { mentions, failures } = resolveMentions(script, audio);
  assert.deepEqual(failures, []);
  const range = (id: string) => mentions.find((mention) => mention.mentionId === id)!.wordRange;
  assert.deepEqual(range('x'), [1, 3]);
  assert.deepEqual(range('y'), [2, 4]);
  assert.deepEqual(range('z'), [4, 6]);
});

import { ensureClaimMarkers, parseMarkers as parseMarkersForClaims } from '../narration/markers.js';

test('ensureClaimMarkers marks a concept the unmarked claim sentence names, and leaves spoken text unchanged', () => {
  const raw = 'Look at [[a|the first thing]]. If the target equals the middle element, we stop. Then [[b|a second thing]] follows.';
  const claim = { claimId: 'match_stops', exactText: 'If the target equals the middle element, we stop.' };
  const out = ensureClaimMarkers(raw, [claim], () => ['Middle element'], 7);
  assert.equal(parseMarkersForClaims(out).plainText, parseMarkersForClaims(raw).plainText);
  const added = parseMarkersForClaims(out).mentions.find((mention) => mention.id === 'match_stops_ref');
  assert.equal(added?.phrase, 'middle element');
  assert.equal(parseMarkersForClaims(out).mentions.length, 3);
});

test('ensureClaimMarkers never exceeds the marker cap, never double-marks, and skips sentences naming no concept', () => {
  const marked = 'Pick [[x|the middle element]] first.';
  const claim = { claimId: 'c1', exactText: 'Pick the middle element first.' };
  assert.equal(ensureClaimMarkers(marked, [claim], () => ['middle element'], 7), marked);
  const bare = 'Nothing relevant is said here.';
  assert.equal(ensureClaimMarkers(bare, [{ claimId: 'c2', exactText: bare }], () => ['unrelated concept'], 7), bare);
  const capped = 'Say it plainly.';
  assert.equal(ensureClaimMarkers(capped, [{ claimId: 'c3', exactText: capped }], () => ['plainly'], 0), capped);
});

test('resolveMentions: a plural possessive inside a phrase matches its aligned word', () => {
  const script = scriptOf("Check [[p|two shorter sides' squares sum]] now.");
  const audio = alignFixture(script, 6000);
  const { mentions, failures } = resolveMentions(script, audio);
  assert.deepEqual(failures, []);
  assert.equal(mentions.length, 1);
});

import { stripStrayMarkerBrackets } from '../narration/markers.js';

test('stripStrayMarkerBrackets keeps valid markers and spoken words, drops unmatched brackets', () => {
  assert.equal(stripStrayMarkerBrackets('Say [[a|this]] and [[b broken here and ]] done [[.'), 'Say [[a|this]] and b broken here and  done .');
  assert.equal(stripStrayMarkerBrackets('Plain [[a|ok]].'), 'Plain [[a|ok]].');
});

test('ensureClaimMarkers marks every concept a claim sentence names, not only the first', () => {
  const raw = 'Intro words here. The query is compared with every key before the value is mixed.';
  const claim = { claimId: 'mix', exactText: 'The query is compared with every key before the value is mixed.' };
  const out = ensureClaimMarkers(raw, [claim], () => ['query', 'key', 'value', 'absent concept'], 7);
  const phrases = parseMarkersForClaims(out).mentions.map((mention) => mention.phrase);
  assert.deepEqual(phrases, ['query', 'key', 'value']);
  assert.equal(parseMarkersForClaims(out).plainText, raw);
});

test('ensureClaimMarkers matches a concept label across a hyphen in the spoken sentence', () => {
  const raw = 'Question here. The sequence-transduction architecture contains an encoder stack. Tail words.';
  const claim = { claimId: 'arch', exactText: 'The sequence-transduction architecture contains an encoder stack.' };
  const out = ensureClaimMarkers(raw, [claim], () => ['Sequence transduction'], 7);
  assert.deepEqual(parseMarkersForClaims(out).mentions.map((mention) => mention.phrase), ['sequence-transduction']);
  assert.equal(parseMarkersForClaims(out).plainText, raw);
});
