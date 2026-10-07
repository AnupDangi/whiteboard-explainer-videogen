import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveSourceEvidence, sourceDocFromText } from '../intake/sourceDoc.js';
import { emptyUsage } from '../llm/structuredCall.js';
import type { ModelClient } from '../llm/modelClient.js';
import { compileSceneNarration } from '../narration/beat-narration/compile.js';
import { SceneNarrationDraftSchema } from '../narration/beat-narration/types.js';
import { tokenizeWords } from '../narration/align.js';
import { verifyLessonLockV2 } from '../pipeline-v2/lockV2.js';
import { runLessonV2 } from '../pipeline-v2/runLessonV2.js';
import { DEFAULT_PACING } from '../pipeline-v2/durationFit.js';
import { TeachingPlanSchema, type SceneContract } from '../plan/schemas.js';
import type { VisualVocabulary } from '../planner/visualDiscovery.js';
import type { PreparedLesson } from '../run/lesson.js';
import { compileBeatPlan } from '../teaching/beat-plan/compile.js';
import { BeatPlanDraftSchema } from '../teaching/beat-plan/types.js';
import { validateBeatPlan } from '../teaching/beat-plan/validate.js';
import type { SceneAudioDeps } from '../audio/sceneAudio.js';
import { validateSceneBoard, type BoardContext } from '../visual-v2/ops-plan/validate.js';
import { SceneBoardDraftSchema } from '../visual-v2/ops-plan/types.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';

// Synthetic, evidence-pinned runner/lock contract tests with silence and injected word clocks.
// These are not generated lessons, visual-quality evidence, or live latency/audio measurements.
const WORD_MS = 400;
const AUDIO_TAIL_MS = 100;

function silentWav(durationMs: number): Buffer {
  const sampleRate = 22050;
  const dataBytes = Math.round(durationMs * sampleRate / 1000) * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

function syntheticPrepared(kind: 'merge' | 'separate', wordMs = WORD_MS): PreparedLesson {
  const sceneId = `${kind}_roundtrip`;
  const statements = kind === 'merge'
    ? ['A frame part and a stack part are visible.', 'The frame and stack combine into one structure.']
    : ['One whole frame is visible.', 'The whole frame separates into two daughter frames.'];
  const sourceDoc = sourceDocFromText(statements.join('\n'));
  const evidence = statements.map((statement) => {
    const span = sourceDoc.spans.find((candidate) => candidate.text.includes(statement));
    const resolved = span ? resolveSourceEvidence(sourceDoc, span.id, statement) : undefined;
    assert.ok(resolved?.documentSha256 && resolved.quoteSha256, 'each synthetic claim needs exact source hashes');
    return resolved;
  });
  const conceptIds = kind === 'merge' ? ['frame', 'stack'] : ['frame'];
  const claims: SceneContract['essentialClaims'] = statements.map((statement, index) => ({
    id: `${sceneId}_c${index + 1}`, statement, epistemicType: 'direct_source', verificationStatus: 'source_cited',
    conceptIds, relations: [], evidenceSpanIds: [evidence[index]!.spanId],
    sourceRefs: [{
      documentId: evidence[index]!.sourceId, sourceHash: evidence[index]!.documentSha256!, spanId: evidence[index]!.spanId,
      startOffset: evidence[index]!.startChar, endOffset: evidence[index]!.endChar, quoteHash: evidence[index]!.quoteSha256!,
      sourceRole: evidence[index]!.sourceRole ?? 'primary',
    }],
  }));
  const graph = {
    concepts: conceptIds.map((id) => ({ id, label: id === 'frame' ? 'Frame' : 'Stack', kind: 'entity' as const, definition: `Synthetic ${id}.`, evidence, level: 'one-step' as const })),
    relations: [], prerequisites: [],
  };
  const common = {
    representationFamily: 'state_transition', relationships: [], misconceptionIds: [], narrationOnly: false,
    persistence: 'scene', pauseIntent: 'none',
  };
  const draft = BeatPlanDraftSchema.parse({ beats: kind === 'merge' ? [
    {
      ...common, claimIds: [claims[0]!.id], learnerDelta: 'Two parts become visible.', learningQuestion: 'Which parts are visible?',
      learnerBefore: 'No parts are visible.', learnerAfter: 'A frame part and stack part are visible.', dependsOnOrders: [],
      beatType: 'introduce', cognitiveOperation: 'trace',
      entities: [{ identityKey: 'left_part', conceptId: 'frame', state: 'frame part' }, { identityKey: 'right_part', conceptId: 'stack', state: 'stack part' }],
      semanticRevealOrder: ['left_part', 'right_part'],
      requiredSemanticChanges: [{ identityKey: 'left_part', kind: 'introduce', toState: 'frame part' }, { identityKey: 'right_part', kind: 'introduce', toState: 'stack part' }],
      narrationGoal: statements[0], visualInvariant: 'Two parts are visible.', mutedMeaning: 'Two parts are present.',
    },
    {
      ...common, claimIds: [claims[1]!.id], learnerDelta: 'The two parts become one structure.', learningQuestion: 'What happens to the parts?',
      learnerBefore: 'Two separate parts are visible.', learnerAfter: 'One combined structure is visible.', dependsOnOrders: [1],
      beatType: 'transform', cognitiveOperation: 'transform',
      entities: [{ identityKey: 'left_part', conceptId: 'frame', state: 'frame part' }, { identityKey: 'right_part', conceptId: 'stack', state: 'stack part' }, { identityKey: 'combined', conceptId: 'frame', state: 'one combined structure' }],
      semanticRevealOrder: ['combined'],
      requiredSemanticChanges: [{ identityKey: 'combined', kind: 'merge', mergeInputIdentityKeys: ['left_part', 'right_part'], toState: 'one combined structure' }],
      narrationGoal: statements[1], visualInvariant: 'One combined structure is visible.', mutedMeaning: 'Two parts become one.',
    },
  ] : [
    {
      ...common, claimIds: [claims[0]!.id], learnerDelta: 'One whole frame becomes visible.', learningQuestion: 'What is visible before separation?',
      learnerBefore: 'No frame is visible.', learnerAfter: 'One whole frame is visible.', dependsOnOrders: [],
      beatType: 'introduce', cognitiveOperation: 'trace',
      entities: [{ identityKey: 'whole', conceptId: 'frame', state: 'whole frame' }], semanticRevealOrder: ['whole'],
      requiredSemanticChanges: [{ identityKey: 'whole', kind: 'introduce', toState: 'whole frame' }],
      narrationGoal: statements[0], visualInvariant: 'One whole frame is visible.', mutedMeaning: 'One frame is present.',
    },
    {
      ...common, claimIds: [claims[1]!.id], learnerDelta: 'One frame becomes two daughter frames.', learningQuestion: 'What happens when the frame separates?',
      learnerBefore: 'One whole frame is visible.', learnerAfter: 'Two daughter frames are visible.', dependsOnOrders: [1],
      beatType: 'transform', cognitiveOperation: 'transform',
      entities: [{ identityKey: 'whole', conceptId: 'frame', state: 'whole frame' }, { identityKey: 'daughter_left', conceptId: 'frame', state: 'daughter frame' }, { identityKey: 'daughter_right', conceptId: 'frame', state: 'daughter frame' }],
      semanticRevealOrder: ['daughter_left', 'daughter_right'],
      requiredSemanticChanges: [{ identityKey: 'whole', kind: 'separate', fromState: 'whole frame', toState: 'two daughter frames' }],
      narrationGoal: statements[1], visualInvariant: 'Two daughter frames are visible.', mutedMeaning: 'One frame becomes two.',
    },
  ] });
  const durationSec = (statements.flatMap((statement) => tokenizeWords(statement)).length * wordMs + AUDIO_TAIL_MS + DEFAULT_PACING.trailingMs.nominal) / 1000;
  const beatContext = { sceneId, conceptIds, claims, relations: [], misconceptionIds: [], durationSec };
  assert.deepEqual(validateBeatPlan(draft, beatContext), [], 'the synthetic plan must satisfy the real beat validator');
  const beats = compileBeatPlan(draft, beatContext);
  const narration = compileSceneNarration(sceneId, SceneNarrationDraftSchema.parse({ beats: statements.map((statement, index) => ({
    beatId: beats[index]!.beatId, sentences: [statement], claimSentences: [{ claimId: claims[index]!.id, sentenceIndex: 0 }],
    semanticAnchors: kind === 'merge' && index === 0
      ? [{ semanticEventId: `${sceneId}.b1.e1`, sentenceIndex: 0, phrase: 'frame part' }, { semanticEventId: `${sceneId}.b1.e2`, sentenceIndex: 0, phrase: 'stack part' }]
      : [{ semanticEventId: `${sceneId}.b${index + 1}.e1`, sentenceIndex: 0, phrase: index === 0 ? 'One whole frame' : kind === 'merge' ? 'combine into one structure' : 'separates into two daughter frames' }],
    emphasisTerms: [],
  })) }), beats);
  const plan = TeachingPlanSchema.parse({
    targetDurationSec: durationSec, intro: { sourceTitle: 'Synthetic semantic lock contract', sections: [] }, recap: { keyPoints: [] },
    sections: [{
      id: sceneId, title: kind === 'merge' ? 'Parts combine' : 'Frame separation', goal: 'Trace the synthetic state change.', kind: 'explain', conceptIds, budgetSec: durationSec,
      contract: { learningDelta: 'Trace the state change.', targetDurationSec: durationSec, requiredConceptIds: conceptIds, requiredRelations: [], evidenceSpanIds: [...new Set(claims.flatMap((claim) => claim.evidenceSpanIds))], essentialClaims: claims, teachingSkill: 'mechanism', candidateMechanisms: ['state_transition'] },
    }],
  });
  const vocabulary: VisualVocabulary = {
    sceneId, family: 'simi-house-v1/domain-outline', concepts: conceptIds.map((id) => ({
      conceptId: id, label: id === 'frame' ? 'Frame' : 'Stack', conceptKind: 'entity',
      depiction: id === 'frame' ? { kind: 'icon', entryId: 'iconify-lucide:frame', rung: 'R3', houseFamily: 'simi-house-v1/domain-outline' } : { kind: 'labelled' },
    })),
  };
  return {
    sourceDoc, groundingMode: 'STRICT_SOURCE', requestedDurationSec: durationSec, graph, plan,
    beatPlans: { [sceneId]: beats }, beatNarrations: { [sceneId]: narration }, visualVocabularies: { [sceneId]: vocabulary }, validatedByConcept: { frame: 'iconify-lucide:frame' },
    usage: emptyUsage(), failures: [], rawResponses: {}, cacheHits: [], stageArtifacts: {}, stageRuns: [],
  };
}

function syntheticAligner(dir: string, wordMs = WORD_MS): NonNullable<SceneAudioDeps['aligner']> {
  return async (text) => {
    const tokens = tokenizeWords(text);
    const durationMs = tokens.length * wordMs + AUDIO_TAIL_MS;
    const audioPath = path.join(dir, 'synthetic-silence.wav');
    await writeFile(audioPath, silentWav(durationMs));
    return { durationMs, words: tokens.map((word, index) => ({ word, startMs: index * wordMs, endMs: index * wordMs + wordMs * 0.9 })), aligner: 'stable-ts', repairedWordIndexes: [], audioPath };
  };
}

const noModelClient: ModelClient = { provider: 'synthetic-no-model', chat: async () => { throw new Error('typed semantic lock contract must not request model output'); } };

for (const kind of ['merge', 'separate'] as const) {
  test(`synthetic V2 ${kind} result first appearance survives full runner and lock verification`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `hyp-${kind}-lock-roundtrip-`));
    try {
      const prepared = syntheticPrepared(kind);
      const sceneId = prepared.plan!.sections[0]!.id;
      const out = path.join(dir, 'run');
      const result = await runLessonV2({ lessonId: `${kind}-synthetic-contract`, outputDir: out, prepared, plannerModel: 'google/x', apiKey: 'synthetic', client: noModelClient, aligner: syntheticAligner(dir), skipEncode: true, boardFallback: false, fps: 4 });
      assert.equal(result.status, 'draft', JSON.stringify(result.failures));
      assert.equal(result.videoPath, undefined, 'no synthetic test video is encoded or used as visual-quality evidence');
      assert.equal(result.metrics['v2.semanticProviderScenes'], 1);
      assert.deepEqual(await verifyLessonLockV2(out), [], 'valid creation by merge/separation must pass the full locked-contract replay');
      const artifact = JSON.parse(await readFile(path.join(out, 'v2', `scene.${sceneId}.json`), 'utf8')) as {
        ops: Array<{ op: string; id?: string; into?: { id: string } | Array<{ id: string }> }>;
        representationExecution: { mode: string; semanticOperations: Array<{ type: string }>; semanticEventBindings: Array<{ semanticEventId: string; beatId: string; boardOpIds: string[] }> };
      };
      const expectedTypes = kind === 'merge' ? ['introduce', 'introduce', 'merge'] : ['introduce', 'separate'];
      assert.deepEqual(artifact.representationExecution.semanticOperations.map((operation) => operation.type), expectedTypes);
      assert.equal(artifact.representationExecution.mode, 'typed-semantic');
      const resultIds = prepared.beatPlans![sceneId]![1]!.semanticRevealOrder;
      assert.ok(resultIds.length > 0);
      for (const id of resultIds) {
        assert.ok(!artifact.ops.some((operation) => operation.op === 'add' && operation.id === id), 'created result entities must not receive invented introduce operations');
        assert.ok(artifact.ops.some((operation) => operation.op === (kind === 'merge' ? 'merge' : 'split') && (Array.isArray(operation.into) ? operation.into.some((part) => part.id === id) : operation.into?.id === id)), 'the structural operation creates every newly revealed result');
      }
      assert.equal(artifact.representationExecution.semanticEventBindings.length, expectedTypes.length);
      if (kind === 'merge') {
        const beats = prepared.beatPlans![sceneId]!;
        const context: BoardContext = {
          sceneId, title: prepared.plan!.sections[0]!.title, beats,
          concepts: prepared.graph!.concepts, claims: prepared.plan!.sections[0]!.contract!.essentialClaims,
          narration: [], initial: emptyBoardState(), visualVocabulary: prepared.visualVocabularies![sceneId], geometryCheck: () => [],
        };
        const sceneRecord = JSON.parse(await readFile(path.join(out, 'v2', `scene.${sceneId}.json`), 'utf8'));
        const recordedScene = SceneBoardDraftSchema.parse({ transition: sceneRecord.transition, ops: sceneRecord.ops });
        assert.deepEqual(validateSceneBoard(recordedScene, context), []);
        const undeclaredConsumption = { ...context, beats: beats.map((beat) => ({ ...beat,
          requiredSemanticChanges: beat.requiredSemanticChanges.map((change) => change.kind === 'merge' ? { ...change, mergeInputEntityIds: [] } : change),
        })) };
        const problems = validateSceneBoard(recordedScene, undeclaredConsumption);
        assert.ok(problems.some((problem) => typeof problem !== 'string' && /concept stack .*not bound to a live visual/.test(problem.message)), JSON.stringify(problems));
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test('synthetic valid word clocks that cannot fit a semantic draw block lesson locking', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-semantic-late-lock-'));
  try {
    const wordMs = 20;
    const prepared = syntheticPrepared('merge', wordMs);
    const out = path.join(dir, 'run');
    const result = await runLessonV2({ lessonId: 'compressed-synthetic-contract', outputDir: out, prepared, plannerModel: 'google/x', apiKey: 'synthetic', client: noModelClient, aligner: syntheticAligner(dir, wordMs), skipEncode: true, boardFallback: false, fps: 4 });
    assert.equal(result.status, 'failed', JSON.stringify(result.failures));
    assert.ok(result.failures.some((failure) => failure.code === 'v2-late-semantic-event' && failure.hard), JSON.stringify(result.failures));
    assert.ok(!result.failures.some((failure) => ['v2-fixed-duration', 'v2-invalid-alignment', 'v2-anchor-alignment-failed'].includes(failure.code)), 'the failure must come from minimum semantic draw time, not malformed clocks or a duration mismatch');
    assert.equal(result.videoPath, undefined);
    await assert.rejects(stat(path.join(out, 'lesson.lock.v2.json')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
