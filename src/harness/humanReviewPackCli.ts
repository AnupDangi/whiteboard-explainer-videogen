#!/usr/bin/env node
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvaluationBundle, HypothesisRunManifest } from '../shared/contracts.js';
import { frameAt } from './judge.js';
import { buildE1BlindPackage, type E1BlindInput, type E1SourceClass } from './humanReview.js';
import { writeE1ParticipantPack } from './humanReviewPack.js';
import { judgeRunEligibility, resolveLocalRunArtifact, sourceDocMatchesRecordedHash, type JudgeNarration } from './judgeEligibility.js';
import { argValue } from '../run/args.js';

interface ReferenceScene { video: string; endS: number; sampleTimesS: number[] }
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (key: string) => argValue(args, key);
  const runDir = arg('run');
  const topic = arg('topic')?.trim().toLowerCase();
  if (!runDir || !topic) throw new Error('Usage: humanReviewPackCli.js --run=<eligible-generated-run-dir> --topic=<declared-topic> [--out=<pack-root>] [--key-out=<sealed-key.json>]');
  const root = path.resolve(runDir);
  const manifest = JSON.parse(await readFile(path.join(root, 'run-manifest.json'), 'utf8')) as HypothesisRunManifest & { runClass?: string; status?: string; video?: string };
  const bundle = JSON.parse(await readFile(path.join(root, 'evaluation-bundle.json'), 'utf8')) as EvaluationBundle;
  const narration = JSON.parse(await readFile(path.join(root, 'narration.json'), 'utf8')) as JudgeNarration;
  const videoPath = resolveLocalRunArtifact(root, manifest.video);
  const sourceDocPath = resolveLocalRunArtifact(root, bundle.nativeArtifacts.sourceDoc);
  const videoExists = Boolean(videoPath) && await stat(videoPath!).then((item) => item.isFile(), () => false);
  const sourceDocExists = Boolean(sourceDocPath) && await stat(sourceDocPath!).then((item) => item.isFile(), () => false);
  const sourceDoc = sourceDocExists ? JSON.parse(await readFile(sourceDocPath!, 'utf8')) as { title?: string } : undefined;
  const topicMapPath = path.join(projectRoot, 'harness/reference/lamina/topics.v1.json');
  const referenceIndexPath = path.join(projectRoot, 'harness/reference/lamina/index.json');
  const referenceVideoRoot = path.resolve(projectRoot, '../lamina-labs-video');
  const topicMapBytes = await readFile(topicMapPath);
  const topicMap = JSON.parse(topicMapBytes.toString('utf8')) as { schemaVersion: string; topics: Record<string, string>; aliases?: Record<string, string[]> };
  const eligibility = judgeRunEligibility({ manifest, bundle, narration, videoExists, sourceDocExists, sourceDocHashMatchesManifest: sourceDoc ? sourceDocMatchesRecordedHash(manifest, sourceDoc) : false, topic, sourceTitle: sourceDoc?.title, topicAliases: topicMap.aliases?.[topic] ?? [] });
  if (eligibility.length) throw new Error(`run is not eligible for E1: ${eligibility.join('; ')}`);
  if (!Object.values(topicMap.topics).includes(topic)) throw new Error(`no reference video is tagged for topic ${topic}`);

  const refIndex = JSON.parse(await readFile(referenceIndexPath, 'utf8')) as ReferenceScene[];
  const refScenes = refIndex.filter((scene) => topicMap.topics[scene.video]?.toLowerCase() === topic);
  const referenceTimes = refScenes.flatMap((scene) => scene.sampleTimesS.map((timeS) => ({ video: scene.video, timeS: Math.min(timeS, scene.endS - 0.5) })));
  if (referenceTimes.length < 10) throw new Error(`topic ${topic} has fewer than 10 tagged reference frames`);
  const audio = JSON.parse(await readFile(path.join(root, 'aligned-audio.json'), 'utf8')) as { durationMs: number };
  const packRoot = path.resolve(arg('out') ?? '.data/hypothesis-runs/claude/e1-blind-packs');
  const packageId = randomUUID();
  const packDir = path.join(packRoot, packageId);
  const keyPath = path.resolve(arg('key-out') ?? path.join(packRoot, `${packageId}.sealed-key.json`));
  if (keyPath === packDir || keyPath.startsWith(packDir + path.sep)) throw new Error('sealed answer key must be stored outside the participant pack directory');
  const imageDir = path.join(packDir, 'images');
  await mkdir(imageDir, { recursive: true });

  const inputs: E1BlindInput[] = [];
  const provenance: Array<{ itemId: string; imagePath: string; source: E1SourceClass; video: string; timeS: number }> = [];
  const writeBlindImage = async (png: Buffer, source: E1SourceClass) => {
    const itemId = randomUUID();
    const imagePath = `images/${randomUUID()}.png`;
    await writeFile(path.join(packDir, imagePath), png);
    inputs.push({ itemId, imagePath, source });
    return itemId;
  };
  for (let i = 0; i < 10; i++) {
    const timeMs = audio.durationMs * (i + 0.5) / 10;
    const timeS = timeMs / 1000;
    const itemId = await writeBlindImage(frameAt(videoPath!, timeS), 'generated');
    provenance.push({ itemId, imagePath: inputs.at(-1)!.imagePath, source: 'generated', video: manifest.video!, timeS });
  }
  const shuffledReferences = [...referenceTimes];
  for (let i = shuffledReferences.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffledReferences[i], shuffledReferences[j]] = [shuffledReferences[j], shuffledReferences[i]];
  }
  for (const reference of shuffledReferences.slice(0, 10)) {
    const referenceVideo = path.resolve(referenceVideoRoot, reference.video);
    const itemId = await writeBlindImage(frameAt(referenceVideo, reference.timeS), 'reference');
    provenance.push({ itemId, imagePath: inputs.at(-1)!.imagePath, source: 'reference', video: reference.video, timeS: reference.timeS });
  }
  const blind = buildE1BlindPackage(packageId, inputs, () => randomInt(1_000_000) / 1_000_000);
  for (const participant of blind.participants) {
    await writeE1ParticipantPack(packDir, participant);
  }
  await writeFile(keyPath, `${JSON.stringify(blind.answerKey, null, 2)}\n`);
  const hashes = async (file: string) => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  };
  const organizerPath = path.resolve(arg('organizer-out') ?? path.join(packRoot, `${packageId}.organizer.json`));
  if (organizerPath.startsWith(packDir + path.sep)) throw new Error('organizer provenance must be stored outside the participant pack directory');
  await mkdir(path.dirname(organizerPath), { recursive: true });
  const referenceVideoHashes = Object.fromEntries(await Promise.all(
    [...new Set(provenance.filter((item) => item.source === 'reference').map((item) => item.video))]
      .map(async (video) => [video, await hashes(path.resolve(referenceVideoRoot, video))] as const),
  ));
  await writeFile(organizerPath, `${JSON.stringify({
    schemaVersion: 'e1-organizer-record/v1', packageId, topic, runId: manifest.runId,
    runManifestSha256: await hashes(path.join(root, 'run-manifest.json')),
    evaluationBundleSha256: await hashes(path.join(root, 'evaluation-bundle.json')),
    sourceDocumentSha256: await hashes(sourceDocPath!), generatedVideoSha256: await hashes(videoPath!),
    referenceTopicMapSha256: createHash('sha256').update(topicMapBytes).digest('hex'),
    referenceIndexSha256: await hashes(referenceIndexPath),
    referenceVideoSha256: referenceVideoHashes,
    sampledItems: await Promise.all(provenance.map(async (item) => ({ ...item, frameSha256: await hashes(path.join(packDir, item.imagePath)) }))),
  }, null, 2)}\n`);
  console.log(`Created blind E1 pack for an eligible generated lesson: ${packDir}`);
  console.log(`Sealed answer key (organizer only): ${keyPath}`);
  console.log(`Organizer provenance (do not share with judges): ${organizerPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
