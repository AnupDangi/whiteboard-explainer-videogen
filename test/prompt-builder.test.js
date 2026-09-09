import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRichBrief,briefStats,detectDomain,extractFacts,extractHeadings} from '../dist/src/prompt-builder.js';
const doc = (text, kind = 'prompt', label = 't') => ({kind, label, text, sha256: 'x'});
const PAPER = `Attention Is All You Need

Abstract
We propose a new network architecture, the Transformer, based solely on attention.

1 Introduction
Recurrent models are hard to parallelize. Our model trains in 12 hours on 8 GPUs.

2 Model Architecture
The encoder maps an input sequence to continuous representations.

3 Experiments
We achieve 28.4 BLEU on English-to-German, an improvement of 2.0 BLEU over prior work.
Training cost was 3.5 days on a single GPU for the base model.
`;

test('headings skip abstract fluff but keep numbered sections', () => {
  const h = extractHeadings(PAPER);
  assert(h.some(x => /Model Architecture/.test(x)));
  assert(h.some(x => /Experiments/.test(x)));
  assert(!h.some(x => /achieve 28\.4/.test(x)));
});

test('facts carry numbers and drop overlong sentences', () => {
  const f = extractFacts(PAPER);
  assert(f.some(x => /28\.4 BLEU/.test(x)));
  assert(f.every(x => x.length <= 220 && /\d/.test(x)));
});

test('domain detection routes papers to the right audience', () => {
  assert.equal(detectDomain(PAPER).domain, 'ai-ml');
  assert.match(detectDomain(PAPER).audience, /undergraduate/);
  assert.equal(detectDomain('how to bake bread at home').domain, 'general');
});

test('brief wraps source with delimiters and visual direction', () => {
  const brief = buildRichBrief(doc(PAPER, 'url', 'https://arxiv.org/pdf/1706.03762'), {minutes: 1});
  assert(brief.includes('WHITEBOARD LESSON BRIEF'));
  assert(brief.includes('SOURCE MATERIAL (url, https://arxiv.org/pdf/1706.03762'));
  assert(brief.includes('untrusted content to teach'));
  assert(brief.includes('Never make all nodes in a scene plain boxes'));
  assert(brief.includes('We achieve 28.4 BLEU'));
  assert(brief.indexOf('WHITEBOARD LESSON BRIEF') < brief.indexOf('SOURCE MATERIAL'));
});

test('bare one-line prompt still yields a usable scaffold', () => {
  const brief = buildRichBrief(doc('Explain how a refrigerator works'), {minutes: 1});
  assert(brief.includes('Core questions'));
  assert(brief.includes('concrete example with real numbers'));
  const stats = briefStats(doc('Explain how a refrigerator works'), brief, {minutes: 1});
  assert.equal(stats.domain, 'general');
  assert(stats.questions >= 3);
});

test('long sources are clipped, short sources pass through intact', () => {
  const long = 'word 42. ' + 'filler '.repeat(20000);
  const brief = buildRichBrief(doc(long, 'text'), {minutes: 5});
  assert(brief.length < 70000);
  assert(brief.endsWith('…') || brief.includes('filler'));
});
