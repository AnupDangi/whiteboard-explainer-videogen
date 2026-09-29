import { createHash } from 'node:crypto';
import { z } from 'zod';

const Treatment = z.object({ arm: z.enum(['zero', 'text', 'mechanism', 'diverse']), exampleOrder: z.enum(['ranked', 'reverse']), plannerModel: z.string().trim().min(1) }).strict();
const AnswerRow = z.object({
  itemId: z.string().trim().min(1), caseId: z.string().trim().min(1), contrast: z.enum(['prompt-arm', 'planner-model']),
  leftRunId: z.string().trim().min(1), rightRunId: z.string().trim().min(1),
  leftTreatment: Treatment, rightTreatment: Treatment,
  leftCostUsd: z.number().finite().nonnegative(), rightCostUsd: z.number().finite().nonnegative(),
}).strict();
const AnswerKey = z.object({ schemaVersion: z.literal('e5-answer-key/v1'), packageId: z.string().trim().min(1), participants: z.object({ 'judge-1': z.array(AnswerRow), 'judge-2': z.array(AnswerRow) }).strict() }).strict();
const OrganizerTreatment = z.object({ arm: z.enum(['zero', 'text', 'mechanism', 'diverse']), exampleOrder: z.enum(['ranked', 'reverse']), plannerModel: z.string().trim().min(1) }).passthrough();
const Run = z.object({
  runId: z.string().trim().min(1), caseId: z.string().trim().min(1), treatment: OrganizerTreatment,
  successfulVideoCostUsd: z.number().finite().nonnegative(),
  runManifestSha256: z.string().regex(/^[a-f0-9]{64}$/i), evaluationBundleSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceDocumentSha256: z.string().regex(/^[a-f0-9]{64}$/i), videoSha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
const Organizer = z.object({
  schemaVersion: z.literal('e5-organizer-record/v1'), packageId: z.string().trim().min(1),
  answerKeySha256: z.string().regex(/^[a-f0-9]{64}$/i), pairListSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  heldOutSet: z.object({ setId: z.string().trim().min(1), version: z.string().trim().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).strict(),
  pairs: z.array(z.object({ pairId: z.string().trim().min(1), itemId: z.string().trim().min(1), contrast: z.enum(['prompt-arm', 'planner-model']), runA: Run, runB: Run }).strict()).min(1),
}).strict();

export interface E5OrganizerAudit {
  status: 'verified' | 'unmeasured';
  organizerSha256?: string;
  heldOutSet?: { setId: string; version: string; sha256: string };
  reasons: string[];
}

function treatmentEqual(a: z.infer<typeof Treatment>, b: z.infer<typeof OrganizerTreatment>): boolean {
  return a.arm === b.arm && a.exampleOrder === b.exampleOrder && a.plannerModel === b.plannerModel;
}

/** Prove that votes are scored against the original pack key and its held-out generated runs. */
export function auditE5Organizer(keyInput: unknown, organizerInput: unknown, answerKeyText: string, organizerText?: string): E5OrganizerAudit {
  const keyResult = AnswerKey.safeParse(keyInput);
  const organizerResult = Organizer.safeParse(organizerInput);
  const reasons: string[] = [];
  if (!keyResult.success) reasons.push('sealed answer key is invalid');
  if (!organizerResult.success) reasons.push('organizer provenance record is invalid');
  if (!keyResult.success || !organizerResult.success) return { status: 'unmeasured', reasons };
  const key = keyResult.data;
  const organizer = organizerResult.data;
  if (key.packageId !== organizer.packageId) reasons.push('answer key and organizer package IDs differ');
  const expectedKeyHash = createHash('sha256').update(answerKeyText).digest('hex');
  if (expectedKeyHash !== organizer.answerKeySha256) reasons.push('sealed answer key hash does not match organizer provenance');
  const pairsByItem = new Map(organizer.pairs.map((pair) => [pair.itemId, pair]));
  if (pairsByItem.size !== organizer.pairs.length) reasons.push('organizer item IDs must be unique');
  const keyedRows = Object.values(key.participants).flat();
  if (new Set(keyedRows.map((row) => row.itemId)).size !== keyedRows.length / 2) reasons.push('answer key participants must cover the same unique items');
  const judgeOneItems = key.participants['judge-1'].map((row) => row.itemId).sort();
  const judgeTwoItems = key.participants['judge-2'].map((row) => row.itemId).sort();
  if (JSON.stringify(judgeOneItems) !== JSON.stringify(judgeTwoItems)) reasons.push('answer key participants must cover identical pair IDs');
  if (keyedRows.length / 2 !== organizer.pairs.length) reasons.push('organizer and answer key pair counts differ');
  for (const participant of ['judge-1', 'judge-2'] as const) for (const row of key.participants[participant]) {
    const pair = pairsByItem.get(row.itemId);
    if (!pair) { reasons.push(`${participant}/${row.itemId}: item is missing from organizer provenance`); continue; }
    if (pair.contrast !== row.contrast || pair.runA.caseId !== row.caseId || pair.runB.caseId !== row.caseId) reasons.push(`${participant}/${row.itemId}: case or contrast differs from organizer provenance`);
    const sides = new Map([[pair.runA.runId, pair.runA], [pair.runB.runId, pair.runB]]);
    const left = sides.get(row.leftRunId); const right = sides.get(row.rightRunId);
    if (!left || !right || left.runId === right.runId) { reasons.push(`${participant}/${row.itemId}: run mapping differs from organizer provenance`); continue; }
    if (!treatmentEqual(row.leftTreatment, left.treatment) || !treatmentEqual(row.rightTreatment, right.treatment)) reasons.push(`${participant}/${row.itemId}: treatment mapping differs from organizer provenance`);
    if (row.leftCostUsd !== left.successfulVideoCostUsd || row.rightCostUsd !== right.successfulVideoCostUsd) reasons.push(`${participant}/${row.itemId}: cost mapping differs from organizer provenance`);
  }
  return {
    status: reasons.length ? 'unmeasured' : 'verified',
    ...(organizerText ? { organizerSha256: createHash('sha256').update(organizerText).digest('hex') } : {}),
    heldOutSet: organizer.heldOutSet, reasons: [...new Set(reasons)],
  };
}
