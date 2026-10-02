import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { E1BlindParticipantPack } from './humanReview.js';
import { buildE1ReviewHtml } from './humanReviewViewer.js';

/** Materialize one relocatable, source-blind folder for exactly one participant. */
export async function writeE1ParticipantPack(packRoot: string, participant: E1BlindParticipantPack): Promise<string> {
  const participantDir = path.join(packRoot, participant.participantId);
  await mkdir(path.join(participantDir, 'images'), { recursive: true });
  for (const item of participant.items) {
    if (!/^images\/[a-f0-9-]+\.png$/i.test(item.imagePath)) throw new Error(`non-opaque image path in blind participant pack: ${item.imagePath}`);
    await copyFile(path.join(packRoot, item.imagePath), path.join(participantDir, item.imagePath));
  }
  await writeFile(path.join(participantDir, 'blind-pack.json'), `${JSON.stringify(participant, null, 2)}\n`);
  await writeFile(path.join(participantDir, 'review.html'), buildE1ReviewHtml(participant));
  await writeFile(path.join(participantDir, 'vote-template.json'), `${JSON.stringify({
    schemaVersion: 'e1-human-vote/v1', packageId: participant.packageId, participantId: participant.participantId,
    votes: participant.items.map(({ itemId }) => ({ itemId, sourceGroup: null, styleCoherence: null })),
  }, null, 2)}\n`);
  await writeFile(path.join(participantDir, 'instructions.txt'), 'Open review.html in a browser. For each image, assign anonymous source group A or B and rate visual style coherence from 1 to 5. Do not discuss answers with the other reviewer. Download the completed vote JSON and return that file to the organizer. The images and review page in this folder are self-contained; do not share this folder with the other reviewer.\n');
  return participantDir;
}
