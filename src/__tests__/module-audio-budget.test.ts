import { PIPELINE } from '../run/config.js';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AlignmentResult } from '../shared/alignment/align.js';
import { ContentAddressedArtifactStore } from '../run/artifactCache.js';
import { prepareLesson } from '../run/lesson.js';
import { sourceDocFromText } from '../intake/sourceDoc.js';
import { tokenizeWords } from '../narration/align.js';
import { parseMarkers } from '../narration/markers.js';
import { S5_STAGE_VERSION, S5_MODEL_ID } from '../run/versions.js';

test('measured module audio changes only the target of narration not yet written', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'hypothesis-module-audio-'));
  try {
    const audioPath = path.join(temp, 'audio.wav');
    await writeFile(audioPath, 'test wav bytes');
    const sourceDoc = sourceDocFromText('Topic one explains a foundational mechanism. Topic two explains how a second mechanism builds on the first.', 'text');
    const span = sourceDoc.spans.find((candidate) => candidate.kind === 'paragraph')!;
    const concepts = [
      { id: 'topic_one', label: 'Topic one', definition: 'A foundational mechanism.', evidence: [{ spanId: span.id, quote: 'Topic one explains a foundational mechanism.' }] },
      { id: 'topic_two', label: 'Topic two', definition: 'A later mechanism.', evidence: [{ spanId: span.id, quote: 'Topic two explains how a second mechanism builds on the first.' }] },
    ];
    const syllabus = {
      requestedDurationSec: 600, plannedDurationSec: 600, coverageReason: 'The source supports two connected modules.', sourceSupport: 'supported',
      learningObjective: 'Explain both mechanisms and their relationship.', audienceAssumptions: ['Basic vocabulary.'], concepts,
      prerequisites: [{ concept: 'topic_two', needs: 'topic_one' }],
      modules: [
        { id: 'foundation', title: 'Foundation', goal: 'Teach the first mechanism.', budgetSec: 300, conceptIds: ['topic_one'], evidenceSpanIds: [span.id], recallOfModuleIds: [] },
        { id: 'extension', title: 'Extension', goal: 'Teach the second mechanism.', budgetSec: 300, conceptIds: ['topic_two'], evidenceSpanIds: [span.id], recallOfModuleIds: [] },
      ],
    };
    const names: string[] = [];
    const targetDurations: number[] = [];
    let alignmentCalls = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { response_format?: { json_schema?: { name?: string } }; messages?: Array<{ role: string; content: string }> };
      const name = body.response_format?.json_schema?.name;
      assert.ok(name);
      names.push(name);
      const user = body.messages?.find((entry) => entry.role === 'user')?.content ?? '';
      const system = body.messages?.find((entry) => entry.role === 'system')?.content ?? '';
      let value: unknown;
      if (name === 'lesson_syllabus') value = syllabus;
      else if (name === 'concept_graph') {
        const concept = system.includes('"id":"topic_two"') ? concepts[1]! : concepts[0]!;
        value = { concepts: [{ ...concept, kind: 'process', level: 'one-step', evidence: [{ spanId: span.id, quote: concept.evidence[0]!.quote }] }], relations: [], prerequisites: [] };
      } else if (name === 'teaching_plan') {
        const duration = Number(user.match(/targetDurationSec:\s*(\d+)/)?.[1] ?? user.match(/Target duration:\s*(\d+)/)?.[1] ?? 300);
        targetDurations.push(duration);
        const sceneCount = Math.round(duration / 18);
        const base = Math.floor(duration / sceneCount);
        const remainder = duration - base * sceneCount;
        const concept = system.includes('topic_two') || user.includes('Current module 2: Extension') ? concepts[1]! : concepts[0]!;
        value = {
          targetDurationSec: duration,
          intro: { sourceTitle: 'Two mechanisms', sections: ['Foundation', 'Extension'] },
          lessonBible: { audience: 'general learner', terminology: [{ conceptId: concept.id, label: concept.label }], persistentConceptIds: [concept.id] },
          sections: Array.from({ length: sceneCount }, (_, index) => {
            const sectionId = `scene_${index + 1}`;
            const goal = `Explain a distinct part ${index + 1} of ${concept.label}.`;
            const budgetSec = base + (index < remainder ? 1 : 0);
            return { id: sectionId, title: `Part ${index + 1}`, goal, kind: index === 0 ? 'intro' : 'explain', conceptIds: [concept.id], budgetSec, contract: { learningDelta: goal, targetDurationSec: budgetSec, requiredConceptIds: [concept.id], requiredRelations: [], evidenceSpanIds: [span.id], essentialClaims: [{ id: `${concept.id}_claim_${index + 1}`, statement: `${concept.label} part ${index + 1} w${index}a w${index}b w${index}c w${index}d w${index}e.`, conceptIds: [concept.id], relations: [], evidenceSpanIds: [span.id] }], mentalModel: `Part ${index + 1} of ${concept.label}.`, semanticVisualIntents: [{ claimId: `${concept.id}_claim_${index + 1}`, conceptType: 'entity', strategy: 'literal', conceptIds: [concept.id], roles: [] }], teachingSkill: 'definition', candidateMechanisms: ['focus'] } };
          }),
          recap: { keyPoints: ['The source provides no supported connection to synthesize within this module.'] },
        };
      } else if (name === 'scene_narration') {
        // 53 spoken words: fits every scene budget this test produces (17-19s at the
        // measured WORDS_PER_SEC = 2.25), including the narrowest (17s => 22.95-53.55
        // words, unrounded) — see the word-count check in plan/stages.ts validateSceneText.
        // "the core idea" occurs exactly once in the marker-stripped spoken text
        // ("the central idea" later is distinct); the claimId is read from this
        // scene's Essential claims prompt so each generated section gets its own span.
        const claimsText = user.split('Essential claims:')[1]?.split('\nConcepts:')[0] ?? '[]';
        const claimId = (claimsText.match(/"id":"([^"]+)"/)?.[1] ?? 'topic_one_claim_1');
        value = { text: 'First consider [[topic_one|the core idea]] as a useful starting point. Notice [[mechanism|the mechanism]] and follow [[process|the process]] through [[step|each step]]. This helps you understand how the parts connect, why the sequence matters, and what changes when one part behaves. Keep the central idea in view as we connect the example to the explanation.', claimSpans: [{ claimId, exactText: 'the core idea' }] };
      } else assert.fail(`unexpected model response schema ${name}`);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5, cost: 0.001 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const speechAligner = async (text: string): Promise<AlignmentResult & { audioPath: string }> => {
      alignmentCalls++;
      const words = tokenizeWords(text).map((word, index) => ({ word, startMs: index * 150, endMs: (index + 1) * 150 }));
      return { durationMs: 18_050, words, aligner: 'stable-ts', repairedWordIndexes: [], audioPath };
    };
    const artifactStore = new ContentAddressedArtifactStore(path.join(temp, 'cache'), 'cold');
    const prepared = await prepareLesson({ source: sourceDoc.text, sourceDoc, targetDurationSec: 600 }, { model: 'test/audio-budget', apiKey: 'test-only', budgetUsd: 0.7, fetcher, speechAligner, artifactStore });
    assert.deepEqual(prepared.failures.filter((failure) => failure.hard), []);
    // The scene gap is also the closing hold, so it is part of the committed audio; derive, never hardcode, the second budget.
    const secondBudgetSec = Math.round(600 - (17 * 18.05 + (16 * PIPELINE.sceneGapMs) / 1000));
    assert.deepEqual(targetDurations, [300, secondBudgetSec]);
    assert.equal(prepared.modules?.[0]?.budgetSec, 300);
    assert.equal(prepared.modules?.[0]?.actualAudioDurationMs, 17 * 18_050 + 16 * PIPELINE.sceneGapMs);
    assert.equal(prepared.modules?.[1]?.budgetSec, secondBudgetSec);
    assert.equal(prepared.modules?.[1]?.requestedBudgetSec, 300);
    assert.deepEqual(names.filter((name) => name === 'lesson_syllabus'), ['lesson_syllabus']);
    const firstScene = prepared.modules![0]!.script.scenes[0]!;
    const reused = await artifactStore.run<{ durationMs: number; words: Array<{ word: string; startMs: number; endMs: number }>; aligner: string; repairedWordIndexes: number[]; audioBase64: string }>(`S5-tts-alignment:${firstScene.sectionId}`, { text: parseMarkers(firstScene.text).plainText, language: 'en', voice: undefined, provider: 'auto', model: 'base', calibrationMedianErrorMs: undefined }, { schemaVersion: 'claude-aligned-scene/v1', stageVersion: S5_STAGE_VERSION, modelId: S5_MODEL_ID }, () => { throw new Error('live S5 must reuse audio measured at the module boundary'); });
    assert.equal(reused.cacheHit, true);
    assert.equal(reused.artifact.payload.durationMs, 18_050);
    assert.equal(alignmentCalls, prepared.modules!.reduce((sum, module) => sum + module.script.scenes.length, 0));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
