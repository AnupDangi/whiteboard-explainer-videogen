import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { E5BlindParticipantPack, E5BlindSourceMap } from './e5HumanReview.js';
import { buildE5ReviewHtml } from './e5HumanReviewViewer.js';

/** Materialize a self-contained timed-video pack with no run IDs or treatment labels. */
export async function writeE5ParticipantPack(packRoot: string, participant: E5BlindParticipantPack, sourceMap: E5BlindSourceMap): Promise<string> {
  if (participant.participantId !== sourceMap.participantId) throw new Error('E5 participant pack/source map identity mismatch');
  const sources = new Map(sourceMap.pairs.map((pair) => [pair.itemId, pair]));
  if (sources.size !== participant.pairs.length || participant.pairs.some((pair) => !sources.has(pair.itemId))) throw new Error('E5 source map does not cover every blinded pair exactly once');
  const participantDir = path.join(packRoot, participant.participantId);
  await mkdir(path.join(participantDir, 'videos'), { recursive: true });
  for (const pair of participant.pairs) {
    if (!/^videos\/[a-f0-9-]+\.mp4$/i.test(pair.leftVideo) || !/^videos\/[a-f0-9-]+\.mp4$/i.test(pair.rightVideo)) throw new Error('E5 participant video paths must be opaque UUID filenames');
    const source = sources.get(pair.itemId)!;
    await copyFile(source.leftSource, path.join(participantDir, pair.leftVideo));
    await copyFile(source.rightSource, path.join(participantDir, pair.rightVideo));
  }
  await writeFile(path.join(participantDir, 'blind-pack.json'), `${JSON.stringify(participant, null, 2)}\n`);
  await writeFile(path.join(participantDir, 'review.html'), buildE5ReviewHtml(participant));
  await writeFile(path.join(participantDir, 'vote-template.json'), `${JSON.stringify({
    schemaVersion: 'e5-human-vote/v1', packageId: participant.packageId, participantId: participant.participantId,
    votes: participant.pairs.map(({ itemId }) => ({ itemId, preferred: null, clarityA: null, clarityB: null, mechanismA: null, mechanismB: null, factualConcernA: false, factualConcernB: false })),
  }, null, 2)}\n`);
  await writeFile(path.join(participantDir, 'instructions.txt'), 'Open review.html in a browser. Review the full timed videos independently. Use Play both/Pause and the shared seek control to compare matching narration and scenes. Video B is muted while both play; the audio track is identical by the E5 pair gate. Rate clarity and mechanism explanation from 1 to 5, choose a preference or tie, and mark any factual concern. Return the downloaded vote JSON. Do not share this folder with the other reviewer.\n');
  return participantDir;
}
