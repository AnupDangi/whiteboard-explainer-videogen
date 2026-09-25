import { z } from 'zod';

export type E1SourceClass = 'generated' | 'reference';
export type E1SourceGroup = 'A' | 'B';

const AnswerKeySchema = z.object({
  schemaVersion: z.literal('e1-answer-key/v1'),
  packageId: z.string().trim().min(1),
  itemSources: z.record(z.string().min(1), z.enum(['generated', 'reference'])),
}).strict();

const HumanVoteSchema = z.object({
  schemaVersion: z.literal('e1-human-vote/v1'),
  packageId: z.string().trim().min(1),
  participantId: z.string().trim().min(1),
  votes: z.array(z.object({
    itemId: z.string().trim().min(1),
    sourceGroup: z.enum(['A', 'B']),
    styleCoherence: z.number().int().min(1).max(5),
  }).strict()),
}).strict();

export interface E1AnswerKey {
  schemaVersion: 'e1-answer-key/v1';
  packageId: string;
  itemSources: Record<string, E1SourceClass>;
}

export interface E1HumanVoteFile {
  schemaVersion: 'e1-human-vote/v1';
  packageId: string;
  participantId: string;
  votes: Array<{ itemId: string; sourceGroup: E1SourceGroup; styleCoherence: number }>;
}

export interface E1HumanJudgeResult {
  participantId: string;
  sourceAccuracy: number;
  styleCoherence: number;
  generatedStyleCoherence: number;
  referenceStyleCoherence: number;
}

export interface E1HumanReviewReport {
  schemaVersion: 'e1-human-report/v1';
  packageId: string;
  status: 'passed' | 'failed' | 'unmeasured';
  sourceSeparationLimit: number;
  styleCoherenceFloor: number;
  judges: E1HumanJudgeResult[];
  rawVotes: unknown[];
  reasons: string[];
}

export interface E1BlindInput { itemId: string; imagePath: string; source: E1SourceClass }
export interface E1BlindParticipantPack { schemaVersion: 'e1-blind-pack/v1'; packageId: string; participantId: string; items: Array<{ itemId: string; imagePath: string }> }

/** Create independently ordered reviewer manifests; only the organizer receives the source key. */
export function buildE1BlindPackage(packageId: string, inputs: E1BlindInput[], random: () => number = Math.random): { answerKey: E1AnswerKey; participants: [E1BlindParticipantPack, E1BlindParticipantPack] } {
  const itemSources = Object.fromEntries(inputs.map(({ itemId, source }) => [itemId, source])) as Record<string, E1SourceClass>;
  const answerKey: E1AnswerKey = { schemaVersion: 'e1-answer-key/v1', packageId, itemSources };
  const keyProblems = validateE1AnswerKey(answerKey);
  if (keyProblems.length) throw new Error(keyProblems.join('; '));
  if (inputs.some(({ imagePath }) => !/^images\/[a-f0-9-]+\.png$/i.test(imagePath))) {
    throw new Error('blind pack images must use opaque UUID filenames');
  }
  const participant = (participantId: string): E1BlindParticipantPack => {
    const items = inputs.map(({ itemId, imagePath }) => ({ itemId, imagePath }));
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return { schemaVersion: 'e1-blind-pack/v1', packageId, participantId, items };
  };
  return { answerKey, participants: [participant('judge-1'), participant('judge-2')] };
}

/** Validate that the sealed key represents the planned balanced, 10+10 source sample. */
export function validateE1AnswerKey(key: unknown): string[] {
  const parsed = AnswerKeySchema.safeParse(key);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.') || 'answer key'}: ${issue.message}`);
  const ids = Object.keys(parsed.data.itemSources);
  const generated = ids.filter((id) => parsed.data.itemSources[id] === 'generated').length;
  const reference = ids.filter((id) => parsed.data.itemSources[id] === 'reference').length;
  const reasons: string[] = [];
  if (ids.length !== 20 || generated !== 10 || reference !== 10) reasons.push(`E1 requires exactly 10 generated and 10 reference items; found ${generated} and ${reference}`);
  return reasons;
}

function scoreJudge(key: E1AnswerKey, review: E1HumanVoteFile): E1HumanJudgeResult | string[] {
  const reasons: string[] = [];
  if (review.packageId !== key.packageId) reasons.push(`${review.participantId}: packageId does not match answer key`);
  const expectedIds = Object.keys(key.itemSources).sort();
  const receivedIds = review.votes.map((vote) => vote.itemId).sort();
  if (new Set(receivedIds).size !== receivedIds.length) reasons.push(`${review.participantId}: duplicate item votes`);
  if (JSON.stringify(expectedIds) !== JSON.stringify(receivedIds)) reasons.push(`${review.participantId}: votes must cover every item exactly once`);
  if (reasons.length) return reasons;

  let orientationOne = 0;
  let orientationTwo = 0;
  const styles: Record<E1SourceClass, number[]> = { generated: [], reference: [] };
  for (const vote of review.votes) {
    const truth = key.itemSources[vote.itemId];
    const isA = vote.sourceGroup === 'A';
    if ((truth === 'generated' && isA) || (truth === 'reference' && !isA)) orientationOne++;
    if ((truth === 'generated' && !isA) || (truth === 'reference' && isA)) orientationTwo++;
    styles[truth].push(vote.styleCoherence);
  }
  const total = review.votes.length;
  const mean = (items: number[]) => items.reduce((sum, score) => sum + score, 0) / items.length;
  return {
    participantId: review.participantId,
    sourceAccuracy: Math.max(orientationOne, orientationTwo) / total,
    styleCoherence: mean(review.votes.map((vote) => vote.styleCoherence)),
    generatedStyleCoherence: mean(styles.generated),
    referenceStyleCoherence: mean(styles.reference),
  };
}

/** Keep individual judge results and raw votes; never average away a judge who separates sources. */
export function evaluateE1HumanVotes(keyInput: unknown, reviewsInput: unknown): E1HumanReviewReport {
  const reviews = Array.isArray(reviewsInput) ? reviewsInput : [reviewsInput];
  const packageId = typeof keyInput === 'object' && keyInput !== null && 'packageId' in keyInput && typeof keyInput.packageId === 'string' ? keyInput.packageId : '';
  const keyParseError = parseError(keyInput);
  const keyResult = AnswerKeySchema.safeParse(keyInput);
  const reasons = keyParseError ? [`answer key JSON parse error: ${keyParseError}`] : validateE1AnswerKey(keyInput);
  if (!Array.isArray(reviewsInput)) reasons.push('vote files must be provided as an array');
  if (!keyResult.success || reasons.length) return { schemaVersion: 'e1-human-report/v1', packageId, status: 'unmeasured', sourceSeparationLimit: 0.6, styleCoherenceFloor: 4, judges: [], rawVotes: reviews, reasons };
  const key = keyResult.data;
  if (reviews.length !== 2) reasons.push(`E1 requires two independent human judges; received ${reviews.length}`);
  const validatedReviews: E1HumanVoteFile[] = [];
  for (const [index, review] of reviews.entries()) {
    const voteParseError = parseError(review);
    if (voteParseError) {
      reasons.push(`judge ${index + 1} JSON parse error: ${voteParseError}`);
      continue;
    }
    const result = HumanVoteSchema.safeParse(review);
    if (!result.success) {
      reasons.push(`judge ${index + 1} vote file: ${result.error.issues.map((issue) => `${issue.path.join('.') || 'vote'} ${issue.message}`).join('; ')}`);
    } else validatedReviews.push(result.data);
  }
  if (reasons.length) return { schemaVersion: 'e1-human-report/v1', packageId: key.packageId, status: 'unmeasured', sourceSeparationLimit: 0.6, styleCoherenceFloor: 4, judges: [], rawVotes: reviews, reasons };
  const ids = validatedReviews.map((review) => review.participantId);
  if (new Set(ids).size !== ids.length) reasons.push('participant IDs must be unique');
  const judges: E1HumanJudgeResult[] = [];
  for (const review of validatedReviews) {
    const result = scoreJudge(key, review);
    if (Array.isArray(result)) reasons.push(...result);
    else judges.push(result);
  }
  if (reasons.length) return { schemaVersion: 'e1-human-report/v1', packageId: key.packageId, status: 'unmeasured', sourceSeparationLimit: 0.6, styleCoherenceFloor: 4, judges, rawVotes: reviews, reasons };
  for (const judge of judges) {
    if (judge.sourceAccuracy > 0.6) reasons.push(`${judge.participantId}: source-classification accuracy ${(judge.sourceAccuracy * 100).toFixed(0)}% exceeds 60%`);
    if (judge.styleCoherence < 4) reasons.push(`${judge.participantId}: mean style coherence ${judge.styleCoherence.toFixed(2)} is below 4/5`);
    if (judge.generatedStyleCoherence < 4) reasons.push(`${judge.participantId}: generated-frame style coherence ${judge.generatedStyleCoherence.toFixed(2)} is below 4/5`);
  }
  return { schemaVersion: 'e1-human-report/v1', packageId: key.packageId, status: reasons.length ? 'failed' : 'passed', sourceSeparationLimit: 0.6, styleCoherenceFloor: 4, judges, rawVotes: reviews, reasons };
}

function parseError(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('__parseError' in value)) return undefined;
  return typeof value.__parseError === 'string' ? value.__parseError : 'invalid JSON';
}
