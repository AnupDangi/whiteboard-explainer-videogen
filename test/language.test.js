import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentWords,segmentSentencesWithIndex,countWords,languageLabel,squash} from '../dist/src/shared/language.js';
import {deriveBeats} from '../dist/src/explainer/planner.js';
import {estimateTiming} from '../dist/src/explainer/engine.js';

test('language labels and word segmentation are script-general (no per-language tables)',()=>{
 assert.equal(languageLabel('zh'),'Chinese (zh)');
 assert.equal(languageLabel('ne'),'Nepali (ne)');
 assert.equal(languageLabel('hi'),'Hindi (hi)');
 assert.equal(languageLabel('bogus'),'bogus');
 assert.ok(segmentWords('量子计算降低噪声').length>=3);
 assert.ok(segmentWords('शून्य स्पिन से शोर कम').length>=4);
 assert.ok(segmentWords('शून्य स्पिनले हल्ला घटाउँछ').length>=4);
 assert.equal(segmentWords('Zero nuclear spin').length,3);
 assert.equal(countWords('Zero nuclear spin'),3);
});
test('beats partition any script exactly without injecting spaces',()=>{
 const zh='量子计算降低噪声。硅-28的核自旋为零！这很重要？';
 const zb=deriveBeats(zh);
 assert.ok(zb.length>=2&&zb.length<=3);
 assert.equal(zb.map(b=>squash(b.narration)).join(''),squash(zh));
 const hi='पहला वाक्य। दूसरा वाक्य! तीसरा?';
 const hb=deriveBeats(hi);
 assert.ok(hb.length>=2);
 assert.equal(hb.map(b=>squash(b.narration)).join(''),squash(hi));
 assert.ok(segmentSentencesWithIndex(zh).length===3);
});
test('estimated timing segments space-free scripts per word',()=>{
 const t=estimateTiming('量子计算降低噪声');
 assert.ok(t.words.length>=3);assert.ok(t.durationMs>0);
 assert.equal(t.words.map(w=>w.word).join(''),'量子计算降低噪声');
});
