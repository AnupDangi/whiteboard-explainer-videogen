import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareReplayDigests, replayDigest } from './replayDeterminism.js';

/**
 * node replayDeterminismCli.js <run-dir containing lesson.lock.json> [replays=20] [--allow-pipeline-drift]
 * --allow-pipeline-drift: cross-commit evidence for locks written by an earlier checkout; recorded in the output, never for release replays.
 * Works on a scratch copy, so the original run directory is never touched.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowPipelineDrift = args.includes('--allow-pipeline-drift');
  const [runDir, countArg] = args.filter((arg) => !arg.startsWith('--'));
  if (!runDir) throw new Error('usage: replayDeterminismCli <run-dir> [replays]');
  const replays = Number(countArg ?? 20);
  if (!Number.isInteger(replays) || replays < 2) throw new Error('replays must be an integer >= 2');
  const scratch = await mkdtemp(path.join(tmpdir(), 'replay-determinism-'));
  try {
    await cp(path.resolve(runDir), scratch, { recursive: true, force: true });
    const digests = [];
    for (let i = 0; i < replays; i++) digests.push(await replayDigest(scratch, { allowPipelineDrift }));
    const result = compareReplayDigests(digests);
    console.log(JSON.stringify({ runDir, pipelineDriftAllowed: allowPipelineDrift, ...result, digest: digests[0] }, null, 2));
    if (!result.identical) process.exitCode = 1;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
