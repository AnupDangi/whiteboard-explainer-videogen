#!/usr/bin/env node
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { EvaluationBundle, HypothesisRunManifest } from '../shared/contracts.js';
import { buildE5BlindPackages, sumSuccessfulVideoApiCost, type E5BlindPairInput, type E5PromptArm } from './e5HumanReview.js';
import { writeE5ParticipantPack } from './e5HumanReviewPack.js';
import { e5ComparisonProblems, e5HeldOutSourceProblems, type E5RunCandidate, type E5Contrast, type E5HeldOutSet } from './e5Comparison.js';
import { resolveLocalRunArtifact, sourceDocMatchesRecordedHash, type JudgeNarration } from './judgeEligibility.js';
import { argValue } from '../run/args.js';

const PairListSchema = z.object({
  schemaVersion: z.literal('e5-pair-list/v1'),
  pairs: z.array(z.object({ id: z.string().trim().min(1), runA: z.string().trim().min(1), runB: z.string().trim().min(1), contrast: z.enum(['prompt-arm', 'planner-model']) }).strict()).min(1),
}).strict();
const HeldOutSetSchema = z.object({
  schemaVersion: z.literal('e5-heldout-set/v1'),
  setId: z.string().trim().min(1), version: z.string().trim().min(1), createdAt: z.string().datetime(),
  sources: z.array(z.object({ caseId: z.string().trim().min(1), sourceDocSha256: z.string().regex(/^[a-f0-9]{64}$/i) }).strict()).min(1),
}).strict();

interface LoadedRun { candidate: E5RunCandidate; root: string; videoPath: string; manifestPath: string; bundlePath: string; sourceDocPath: string; totalSuccessfulVideoCostUsd: number }

async function fileExists(file: string | undefined): Promise<boolean> {
  return Boolean(file) && stat(file!).then((item) => item.isFile(), () => false);
}
async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function loadRun(runDir: string): Promise<LoadedRun> {
  const root = path.resolve(runDir);
  const manifestPath = path.join(root, 'run-manifest.json');
  const bundlePath = path.join(root, 'evaluation-bundle.json');
  const narrationPath = path.join(root, 'narration.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as HypothesisRunManifest & { runClass?: string; status?: string; video?: string };
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as EvaluationBundle;
  const narration = JSON.parse(await readFile(narrationPath, 'utf8')) as JudgeNarration;
  const videoPath = resolveLocalRunArtifact(root, manifest.video);
  const sourceDocPath = resolveLocalRunArtifact(root, bundle.nativeArtifacts.sourceDoc);
  const videoExists = await fileExists(videoPath);
  const sourceDocExists = await fileExists(sourceDocPath);
  const sourceDoc = sourceDocExists ? JSON.parse(await readFile(sourceDocPath!, 'utf8')) as { title?: string } : undefined;
  const sourceTitle = sourceDoc?.title;
  const sourceDocHashMatchesManifest = sourceDoc ? sourceDocMatchesRecordedHash(manifest, sourceDoc) : false;
  const candidate: E5RunCandidate = { manifest, bundle, narration, videoExists, sourceDocExists, sourceDocHashMatchesManifest, sourceTitle };
  const treatment = manifest.promptExperiment;
  if (!treatment) throw new Error(`${manifest.runId}: prompt-treatment metadata is missing`);
  return { candidate, root, videoPath: videoPath!, manifestPath, bundlePath, sourceDocPath: sourceDocPath!, totalSuccessfulVideoCostUsd: sumSuccessfulVideoApiCost(bundle.stageRuns ?? [], bundle.runId) };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (key: string) => argValue(args, key);
  const pairsPath = arg('pairs');
  const datasetPath = arg('dataset');
  if (!pairsPath || !datasetPath) throw new Error('Usage: e5HumanReviewPackCli.js --pairs=<e5-pair-list.json> --dataset=<versioned-heldout-set.json> [--out=<pack-root>] [--key-out=<sealed-key.json>] [--organizer-out=<organizer.json>]');
  const parsed = PairListSchema.safeParse(JSON.parse(await readFile(pairsPath, 'utf8')));
  if (!parsed.success) throw new Error(`invalid E5 pair list: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  const heldOutBytes = await readFile(datasetPath);
  const heldOutParsed = HeldOutSetSchema.safeParse(JSON.parse(heldOutBytes.toString('utf8')));
  if (!heldOutParsed.success) throw new Error(`invalid E5 held-out set: ${heldOutParsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  const heldOutSet = heldOutParsed.data as E5HeldOutSet;

  const inputs: E5BlindPairInput[] = [];
  const loaded: Array<{ id: string; contrast: E5Contrast; a: LoadedRun; b: LoadedRun }> = [];
  const seenRunPairs = new Set<string>();
  for (const pair of parsed.data.pairs) {
    const [a, b] = await Promise.all([loadRun(pair.runA), loadRun(pair.runB)]);
    const issues = e5ComparisonProblems(a.candidate, b.candidate, pair.contrast);
    if (issues.length) throw new Error(`${pair.id}: not an eligible matched E5 generated-video pair: ${issues.join('; ')}`);
    const splitIssues = e5HeldOutSourceProblems(heldOutSet, a.candidate);
    if (splitIssues.length) throw new Error(`${pair.id}: source is not verified as held out: ${splitIssues.join('; ')}`);
    const pairKey = [a.candidate.manifest.runId, b.candidate.manifest.runId].sort().join('\0');
    if (seenRunPairs.has(pairKey)) throw new Error(`${pair.id}: duplicate E5 run pair`);
    seenRunPairs.add(pairKey);
    const treatmentA = a.candidate.manifest.promptExperiment!;
    const treatmentB = b.candidate.manifest.promptExperiment!;
    inputs.push({
      pairId: pair.id, caseId: a.candidate.manifest.caseId, contrast: pair.contrast,
      runA: { runId: a.candidate.manifest.runId, treatment: { arm: treatmentA.arm as E5PromptArm, exampleOrder: treatmentA.exampleOrder, plannerModel: treatmentA.plannerModel }, successfulVideoCostUsd: a.totalSuccessfulVideoCostUsd, videoPath: a.videoPath },
      runB: { runId: b.candidate.manifest.runId, treatment: { arm: treatmentB.arm as E5PromptArm, exampleOrder: treatmentB.exampleOrder, plannerModel: treatmentB.plannerModel }, successfulVideoCostUsd: b.totalSuccessfulVideoCostUsd, videoPath: b.videoPath },
    });
    loaded.push({ id: pair.id, contrast: pair.contrast, a, b });
  }

  const packRoot = path.resolve(arg('out') ?? '.data/hypothesis-runs/claude/e5-blind-packs');
  const packageId = randomUUID();
  const packageDir = path.join(packRoot, packageId);
  const keyPath = path.resolve(arg('key-out') ?? path.join(packRoot, `${packageId}.sealed-key.json`));
  const organizerPath = path.resolve(arg('organizer-out') ?? path.join(packRoot, `${packageId}.organizer.json`));
  if ([keyPath, organizerPath].some((file) => file === packageDir || file.startsWith(`${packageDir}${path.sep}`))) throw new Error('sealed key and organizer provenance must be stored outside participant pack directories');
  if (keyPath === organizerPath) throw new Error('sealed answer key and organizer provenance must use separate files');
  const blind = buildE5BlindPackages(packageId, inputs, () => randomInt(1_000_000) / 1_000_000);
  await mkdir(packageDir, { recursive: true });
  for (const participant of blind.participants) {
    const sourceMap = blind.videoSources.find((map) => map.participantId === participant.participantId)!;
    await writeE5ParticipantPack(packageDir, participant, sourceMap);
  }
  await mkdir(path.dirname(keyPath), { recursive: true });
  await mkdir(path.dirname(organizerPath), { recursive: true });
  const answerKeyText = `${JSON.stringify(blind.answerKey, null, 2)}\n`;
  await writeFile(keyPath, answerKeyText);
  const provenance = await Promise.all(loaded.map(async ({ id, contrast, a, b }) => ({
    pairId: id, itemId: blind.answerKey.participants['judge-1'].find((item) => item.caseId === a.candidate.manifest.caseId && item.leftRunId !== item.rightRunId && [item.leftRunId, item.rightRunId].includes(a.candidate.manifest.runId) && [item.leftRunId, item.rightRunId].includes(b.candidate.manifest.runId))?.itemId, contrast,
    runA: { runId: a.candidate.manifest.runId, caseId: a.candidate.manifest.caseId, treatment: a.candidate.manifest.promptExperiment, successfulVideoCostUsd: a.totalSuccessfulVideoCostUsd, runManifestSha256: await sha256File(a.manifestPath), evaluationBundleSha256: await sha256File(a.bundlePath), sourceDocumentSha256: await sha256File(a.sourceDocPath), videoSha256: await sha256File(a.videoPath) },
    runB: { runId: b.candidate.manifest.runId, caseId: b.candidate.manifest.caseId, treatment: b.candidate.manifest.promptExperiment, successfulVideoCostUsd: b.totalSuccessfulVideoCostUsd, runManifestSha256: await sha256File(b.manifestPath), evaluationBundleSha256: await sha256File(b.bundlePath), sourceDocumentSha256: await sha256File(b.sourceDocPath), videoSha256: await sha256File(b.videoPath) },
  })));
  if (provenance.some((pair) => !pair.itemId)) throw new Error('E5 organizer integrity error: a blind item has no matching source pair');
  await writeFile(organizerPath, `${JSON.stringify({ schemaVersion: 'e5-organizer-record/v1', packageId, answerKeySha256: createHash('sha256').update(answerKeyText).digest('hex'), pairListSha256: await sha256File(path.resolve(pairsPath)), heldOutSet: { setId: heldOutSet.setId, version: heldOutSet.version, sha256: createHash('sha256').update(heldOutBytes).digest('hex') }, pairs: provenance }, null, 2)}\n`);
  console.log(`Created blind E5 timed-video packs for ${inputs.length} eligible generated-video pairs: ${packageDir}`);
  console.log(`Sealed answer key (organizers only): ${keyPath}`);
  console.log(`Organizer provenance (do not share with judges): ${organizerPath}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
