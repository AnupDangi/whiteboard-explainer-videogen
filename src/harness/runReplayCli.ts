import { collectReplayFixtures, replayChainProblems } from './runReplay.js';

/**
 * `node dist/src/harness/runReplayCli.js --run=<run-dir>` prints the run's replay chain and
 * exits non-zero when the chain is incomplete, so a completed run can be checked for
 * deterministic replay offline. Read-only; no provider calls.
 */
function main(): void {
  const args = process.argv.slice(2);
  const runDir = args.find((a) => a.startsWith('--run='))?.slice('--run='.length);
  if (!runDir) throw new Error('usage: runReplayCli --run=<run-directory>');
  const entries = collectReplayFixtures(runDir);
  const problems = replayChainProblems(entries);
  console.log(JSON.stringify({ runDir, calls: entries.length, chain: entries, problems }, null, 2));
  if (problems.length) process.exitCode = 1;
}

main();
