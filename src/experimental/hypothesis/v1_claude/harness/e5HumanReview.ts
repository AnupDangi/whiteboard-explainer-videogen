import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { StageRunRecord } from '../../shared/contracts.js';

export type E5PromptArm = 'zero' | 'text' | 'mechanism' | 'diverse';
export type E5Side = 'A' | 'B';
export type E5Contrast = 'prompt-arm' | 'planner-model';

export interface E5Treatment { arm: E5PromptArm; exampleOrder: 'ranked' | 'reverse'; plannerModel: string }
const treatmentKey = (value: E5Treatment) => JSON.stringify({ arm: value.arm, exampleOrder: value.exampleOrder, plannerModel: value.plannerModel });

export interface E5BlindPairInput {
  pairId: string;
  caseId: string;
  contrast: E5Contrast;
  runA: { runId: string; treatment: E5Treatment; successfulVideoCostUsd: number; videoPath: string };
  runB: { runId: string; treatment: E5Treatment; successfulVideoCostUsd: number; videoPath: string };
}

export interface E5BlindParticipantPack {
  schemaVersion: 'e5-blind-pack/v1';
  packageId: string;
  participantId: 'judge-1' | 'judge-2';
  pairs: Array<{ itemId: string; leftVideo: string; rightVideo: string }>;
}

export interface E5BlindSourceMap {
  participantId: 'judge-1' | 'judge-2';
  pairs: Array<{ itemId: string; leftSource: string; rightSource: string }>;
}

const TreatmentSchema = z.object({ arm: z.enum(['zero', 'text', 'mechanism', 'diverse']), exampleOrder: z.enum(['ranked', 'reverse']), plannerModel: z.string().trim().min(1) }).strict();
const PairAnswerSchema = z.object({
  itemId: z.string().trim().min(1), caseId: z.string().trim().min(1),
  contrast: z.enum(['prompt-arm', 'planner-model']),
  leftRunId: z.string().trim().min(1), rightRunId: z.string().trim().min(1),
  leftTreatment: TreatmentSchema, rightTreatment: TreatmentSchema,
  leftCostUsd: z.number().finite().nonnegative(), rightCostUsd: z.number().finite().nonnegative(),
}).strict();

export interface E5AnswerKey {
  schemaVersion: 'e5-answer-key/v1';
  packageId: string;
  participants: Record<'judge-1' | 'judge-2', z.infer<typeof PairAnswerSchema>[]>;
}

const AnswerKeySchema = z.object({
  schemaVersion: z.literal('e5-answer-key/v1'),
  packageId: z.string().trim().min(1),
  participants: z.object({ 'judge-1': z.array(PairAnswerSchema), 'judge-2': z.array(PairAnswerSchema) }).strict(),
}).strict();

const VoteSchema = z.object({
  schemaVersion: z.literal('e5-human-vote/v1'),
  packageId: z.string().trim().min(1),
  participantId: z.enum(['judge-1', 'judge-2']),
  votes: z.array(z.object({
    itemId: z.string().trim().min(1), preferred: z.enum(['A', 'B', 'tie']),
    clarityA: z.number().int().min(1).max(5), clarityB: z.number().int().min(1).max(5),
    mechanismA: z.number().int().min(1).max(5), mechanismB: z.number().int().min(1).max(5),
    factualConcernA: z.boolean(), factualConcernB: z.boolean(), note: z.string().max(1000).optional(),
  }).strict()),
}).strict();

export interface E5HumanVoteFile {
  schemaVersion: 'e5-human-vote/v1'; packageId: string; participantId: 'judge-1' | 'judge-2';
  votes: Array<{
    itemId: string; preferred: E5Side | 'tie'; clarityA: number; clarityB: number;
    mechanismA: number; mechanismB: number; factualConcernA: boolean; factualConcernB: boolean; note?: string;
  }>;
}

export interface E5TreatmentHumanMetrics {
  treatment: E5Treatment;
  treatmentKey: string;
  comparisons: number;
  meanClarity: number;
  meanMechanismExplanation: number;
  factualConcernRate: number;
  preferenceShare: number;
  meanSuccessfulVideoCostUsd: number;
}

export interface E5HumanReviewReport {
  schemaVersion: 'e5-human-report/v1'; packageId: string; status: 'measured' | 'unmeasured';
  distinctCases: number; judges: Array<{ participantId: string; metricsByTreatment: E5TreatmentHumanMetrics[]; votes: unknown[] }>;
  aggregateByTreatment: E5TreatmentHumanMetrics[]; rawVotes: unknown[]; reasons: string[];
}

/** Recover the full generation API spend represented by cold and warm stage records. */
export function sumSuccessfulVideoApiCost(stageRuns: readonly StageRunRecord[], runId = 'run'): number {
  if (!stageRuns.length) throw new Error(`${runId}: stage cost ledger is missing`);
  let total = 0;
  for (const record of stageRuns) {
    if (record.kind === 'local') continue;
    if (!Number.isFinite(record.apiCostUsd) || record.apiCostUsd < 0) throw new Error(`${runId}: ${record.stage} has invalid invocation cost`);
    if (record.cacheHit) {
      if (!Number.isFinite(record.artifactApiCostUsd) || (record.artifactApiCostUsd ?? -1) < 0) throw new Error(`${runId}: ${record.stage} is cached without its original artifact cost; cannot report successful-video cost`);
      total += record.artifactApiCostUsd!;
    } else total += record.apiCostUsd;
  }
  return total;
}

type Random = () => number;
type IdFactory = () => string;
function checkedRandom(random: Random): number {
  const value = random();
  if (!(value >= 0 && value < 1)) throw new Error('random source must return a number in [0, 1)');
  return value;
}
function shuffled<T>(items: T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(checkedRandom(random) * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function validatePairInputs(packageId: string, inputs: E5BlindPairInput[]): string[] {
  const reasons: string[] = [];
  if (!packageId.trim()) reasons.push('package ID is required');
  if (inputs.length === 0) reasons.push('E5 human review requires at least one matched generated-video pair');
  if (new Set(inputs.map((item) => item.pairId)).size !== inputs.length) reasons.push('E5 pair IDs must be unique');
  for (const pair of inputs) {
    if (!pair.caseId.trim()) reasons.push(`${pair.pairId}: case ID is required`);
    if (!pair.runA.runId || !pair.runB.runId || pair.runA.runId === pair.runB.runId) reasons.push(`${pair.pairId}: two distinct run IDs are required`);
    const sameArm = pair.runA.treatment.arm === pair.runB.treatment.arm;
    const sameModel = pair.runA.treatment.plannerModel === pair.runB.treatment.plannerModel;
    const treatmentChanged = !sameArm || pair.runA.treatment.exampleOrder !== pair.runB.treatment.exampleOrder;
    const contrastValid = pair.contrast === 'prompt-arm' ? treatmentChanged && sameModel : sameArm && pair.runA.treatment.exampleOrder === pair.runB.treatment.exampleOrder && !sameModel;
    if (!contrastValid) reasons.push(`${pair.pairId}: treatment contrast does not match its declared E5 contrast`);
    for (const [side, run] of [['A', pair.runA], ['B', pair.runB]] as const) {
      if (!Number.isFinite(run.successfulVideoCostUsd) || run.successfulVideoCostUsd < 0) reasons.push(`${pair.pairId}: ${side} successful-video cost must be finite and non-negative`);
      if (!run.videoPath) reasons.push(`${pair.pairId}: ${side} video path is required`);
      if (!run.treatment.plannerModel.trim()) reasons.push(`${pair.pairId}: ${side} planner model is required`);
    }
  }
  return [...new Set(reasons)];
}

/** Build independently shuffled, treatment-blind full-video packs and a separate organizer key. */
export function buildE5BlindPackages(
  packageId: string,
  inputs: E5BlindPairInput[],
  random: Random = Math.random,
  idFactory: IdFactory = randomUUID,
): { answerKey: E5AnswerKey; participants: [E5BlindParticipantPack, E5BlindParticipantPack]; videoSources: [E5BlindSourceMap, E5BlindSourceMap] } {
  const problems = validatePairInputs(packageId, inputs);
  if (problems.length) throw new Error(problems.join('; '));
  const participants = ['judge-1', 'judge-2'] as const;
  const itemIds = inputs.map(() => idFactory());
  const judgeOneLeftFirst = inputs.map(() => checkedRandom(random) < 0.5);
  const answerLists: E5AnswerKey['participants'] = { 'judge-1': [], 'judge-2': [] };
  const sourceMaps: E5BlindSourceMap[] = [];
  const packs = participants.map((participantId, participantIndex): E5BlindParticipantPack => {
    const rows = inputs.map((input, pairIndex) => {
      const itemId = itemIds[pairIndex]!;
      const leftFirst = participantIndex === 0 ? judgeOneLeftFirst[pairIndex]! : !judgeOneLeftFirst[pairIndex]!;
      const left = leftFirst ? input.runA : input.runB;
      const right = leftFirst ? input.runB : input.runA;
      answerLists[participantId].push({
        itemId, caseId: input.caseId, contrast: input.contrast,
        leftRunId: left.runId, rightRunId: right.runId,
        leftTreatment: left.treatment, rightTreatment: right.treatment,
        leftCostUsd: left.successfulVideoCostUsd, rightCostUsd: right.successfulVideoCostUsd,
      });
      return { itemId, leftSource: left.videoPath, rightSource: right.videoPath };
    });
    const ordered = shuffled(rows, random);
    const pairs = ordered.map(({ itemId }) => ({ itemId, leftVideo: `videos/${idFactory()}.mp4`, rightVideo: `videos/${idFactory()}.mp4` }));
    sourceMaps.push({ participantId, pairs: ordered.map(({ itemId, leftSource, rightSource }) => ({ itemId, leftSource, rightSource })) });
    return { schemaVersion: 'e5-blind-pack/v1', packageId, participantId, pairs };
  });
  const answerKey: E5AnswerKey = { schemaVersion: 'e5-answer-key/v1', packageId, participants: answerLists };
  return { answerKey, participants: packs as [E5BlindParticipantPack, E5BlindParticipantPack], videoSources: sourceMaps as [E5BlindSourceMap, E5BlindSourceMap] };
}

function parseError(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('__parseError' in value)) return undefined;
  return typeof value.__parseError === 'string' ? value.__parseError : 'invalid JSON';
}
function answerKeyProblems(key: E5AnswerKey): string[] {
  const reasons: string[] = [];
  const pairIndexes = (participant: 'judge-1' | 'judge-2') => {
    const rows = key.participants[participant];
    if (!rows.length) reasons.push(`${participant}: answer key has no pairs`);
    if (new Set(rows.map((row) => row.itemId)).size !== rows.length) reasons.push(`${participant}: answer key item IDs must be unique`);
    for (const row of rows) {
      if (row.leftRunId === row.rightRunId) reasons.push(`${participant}/${row.itemId}: answer key repeats a run ID`);
      const sameArm = row.leftTreatment.arm === row.rightTreatment.arm;
      const sameModel = row.leftTreatment.plannerModel === row.rightTreatment.plannerModel;
      const treatmentChanged = !sameArm || row.leftTreatment.exampleOrder !== row.rightTreatment.exampleOrder;
      const valid = row.contrast === 'prompt-arm' ? treatmentChanged && sameModel : sameArm && row.leftTreatment.exampleOrder === row.rightTreatment.exampleOrder && !sameModel;
      if (!valid) reasons.push(`${participant}/${row.itemId}: answer key treatment does not match declared contrast`);
    }
    return new Map(rows.map((row) => [row.itemId, row]));
  };
  const first = pairIndexes('judge-1');
  const second = pairIndexes('judge-2');
  if (first.size !== second.size || [...first.keys()].some((itemId) => !second.has(itemId))) reasons.push('participants must review the same pair IDs');
  for (const [itemId, a] of first) {
    const b = second.get(itemId);
    if (!b) continue;
    if (a.caseId !== b.caseId || a.contrast !== b.contrast || a.leftRunId !== b.rightRunId || a.rightRunId !== b.leftRunId) reasons.push(`${itemId}: participants must receive opposite randomized pair order`);
    if (treatmentKey(a.leftTreatment) !== treatmentKey(b.rightTreatment) || treatmentKey(a.rightTreatment) !== treatmentKey(b.leftTreatment)) reasons.push(`${itemId}: participant treatment assignments disagree`);
  }
  return [...new Set(reasons)];
}
interface Accumulator { clarity: number[]; mechanism: number[]; factualConcerns: number; preferences: number; costs: number[] }
const emptyAccumulator = (): Accumulator => ({ clarity: [], mechanism: [], factualConcerns: 0, preferences: 0, costs: [] });
function treatmentMetrics(key: string, values: Accumulator): E5TreatmentHumanMetrics {
  const mean = (items: number[]) => items.reduce((sum, item) => sum + item, 0) / items.length;
  const treatment = JSON.parse(key) as E5Treatment;
  return {
    treatment, treatmentKey: `${treatment.arm} @ ${treatment.plannerModel}`,
    comparisons: values.clarity.length, meanClarity: mean(values.clarity),
    meanMechanismExplanation: mean(values.mechanism),
    factualConcernRate: values.factualConcerns / values.clarity.length,
    preferenceShare: values.preferences / values.clarity.length,
    meanSuccessfulVideoCostUsd: mean(values.costs),
  };
}

/** Score complete independent E5 human votes without automatically selecting an architecture. */
export function evaluateE5HumanVotes(keyInput: unknown, reviewInputs: unknown): E5HumanReviewReport {
  const rawVotes = Array.isArray(reviewInputs) ? reviewInputs : [reviewInputs];
  const packageId = typeof keyInput === 'object' && keyInput !== null && 'packageId' in keyInput && typeof keyInput.packageId === 'string' ? keyInput.packageId : '';
  const keyParseError = parseError(keyInput);
  const keyResult = AnswerKeySchema.safeParse(keyInput);
  const reasons = keyParseError ? [`answer key JSON parse error: ${keyParseError}`] : keyResult.success ? [] : keyResult.error.issues.map((issue) => `${issue.path.join('.') || 'answer key'}: ${issue.message}`);
  if (!Array.isArray(reviewInputs)) reasons.push('vote files must be provided as an array');
  if (!keyResult.success) return { schemaVersion: 'e5-human-report/v1', packageId, status: 'unmeasured', distinctCases: 0, judges: [], aggregateByTreatment: [], rawVotes, reasons };
  const key = keyResult.data as E5AnswerKey;
  reasons.push(...answerKeyProblems(key));
  if (rawVotes.length !== 2) reasons.push(`E5 requires two independent human judges; received ${rawVotes.length}`);
  const validated: E5HumanVoteFile[] = [];
  for (const [index, raw] of rawVotes.entries()) {
    const parseIssue = parseError(raw);
    if (parseIssue) { reasons.push(`judge ${index + 1} JSON parse error: ${parseIssue}`); continue; }
    const result = VoteSchema.safeParse(raw);
    if (!result.success) { reasons.push(`judge ${index + 1}: ${result.error.issues.map((issue) => `${issue.path.join('.') || 'vote'} ${issue.message}`).join('; ')}`); continue; }
    if (result.data.packageId !== key.packageId) reasons.push(`${result.data.participantId}: packageId does not match answer key`);
    validated.push(result.data as E5HumanVoteFile);
  }
  if (new Set(validated.map((review) => review.participantId)).size !== validated.length) reasons.push('participant IDs must be unique');
  for (const participant of ['judge-1', 'judge-2'] as const) {
    const expected = key.participants[participant].map((pair) => pair.itemId).sort();
    const review = validated.find((candidate) => candidate.participantId === participant);
    if (!review) { reasons.push(`${participant}: vote file is missing`); continue; }
    const received = review.votes.map((vote) => vote.itemId).sort();
    if (new Set(received).size !== received.length || JSON.stringify(received) !== JSON.stringify(expected)) reasons.push(`${participant}: votes must cover each pair exactly once`);
  }
  const distinctCases = new Set(Object.values(key.participants).flat().map((pair) => pair.caseId)).size;
  if (reasons.length) return { schemaVersion: 'e5-human-report/v1', packageId: key.packageId, status: 'unmeasured', distinctCases, judges: [], aggregateByTreatment: [], rawVotes, reasons };

  const aggregate = new Map<string, Accumulator>();
  const judges: E5HumanReviewReport['judges'] = [];
  for (const review of validated) {
    const answerItems = new Map(key.participants[review.participantId].map((pair) => [pair.itemId, pair]));
    const own = new Map<string, Accumulator>();
    const scoredVotes: unknown[] = [];
    for (const vote of review.votes) {
      const answer = answerItems.get(vote.itemId)!;
      const leftKey = treatmentKey(answer.leftTreatment);
      const rightKey = treatmentKey(answer.rightTreatment);
      const left = own.get(leftKey) ?? emptyAccumulator();
      const right = own.get(rightKey) ?? emptyAccumulator();
      const leftAll = aggregate.get(leftKey) ?? emptyAccumulator();
      const rightAll = aggregate.get(rightKey) ?? emptyAccumulator();
      const leftPreference = vote.preferred === 'tie' ? 0.5 : vote.preferred === 'A' ? 1 : 0;
      const rightPreference = 1 - leftPreference;
      const add = (target: Accumulator, clarity: number, mechanism: number, concern: boolean, preference: number, cost: number) => {
        target.clarity.push(clarity); target.mechanism.push(mechanism); target.factualConcerns += Number(concern); target.preferences += preference; target.costs.push(cost);
      };
      add(left, vote.clarityA, vote.mechanismA, vote.factualConcernA, leftPreference, answer.leftCostUsd);
      add(right, vote.clarityB, vote.mechanismB, vote.factualConcernB, rightPreference, answer.rightCostUsd);
      add(leftAll, vote.clarityA, vote.mechanismA, vote.factualConcernA, leftPreference, answer.leftCostUsd);
      add(rightAll, vote.clarityB, vote.mechanismB, vote.factualConcernB, rightPreference, answer.rightCostUsd);
      own.set(leftKey, left); own.set(rightKey, right); aggregate.set(leftKey, leftAll); aggregate.set(rightKey, rightAll);
      scoredVotes.push({ itemId: vote.itemId, caseId: answer.caseId, contrast: answer.contrast, leftTreatment: answer.leftTreatment, rightTreatment: answer.rightTreatment, preferred: vote.preferred, clarityA: vote.clarityA, clarityB: vote.clarityB, mechanismA: vote.mechanismA, mechanismB: vote.mechanismB, factualConcernA: vote.factualConcernA, factualConcernB: vote.factualConcernB, note: vote.note });
    }
    judges.push({ participantId: review.participantId, metricsByTreatment: [...own].map(([key, values]) => treatmentMetrics(key, values)), votes: scoredVotes });
  }
  return { schemaVersion: 'e5-human-report/v1', packageId: key.packageId, status: 'measured', distinctCases, judges, aggregateByTreatment: [...aggregate].map(([key, values]) => treatmentMetrics(key, values)), rawVotes, reasons: [] };
}
