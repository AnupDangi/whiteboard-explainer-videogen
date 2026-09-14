import {runLiveEvaluation} from '../eval/live/runner.js';
const args = process.argv.slice(2);
const smoke = args.includes('--smoke');
const narration = args.includes('--narration');
const runs = Number(args.find((_, i) => args[i - 1] === '--runs') ?? 3);
const maxCostUsd = Math.min(2, Number(args.find((_, i) => args[i - 1] === '--budget') ?? 0.15));
const outDir = args.find((_, i) => args[i - 1] === '--out');

const {report} = await runLiveEvaluation({
  smoke,
  narration,
  runs,
  maxCostUsd,
  outDir,
  env: process.env,
  onProgress: (done, total, caseId, runIndex, status) => {
    console.log(`[${done}/${total}] ${caseId} run ${runIndex}: ${status}`);
  }
});

console.log('\nStage success rates:');
for (const [stage, data] of Object.entries(report.stageSuccess)) {
  console.log(`  ${stage}: ${data.rate}% (${data.pass}/${data.pass + data.fail})`);
}
console.log(`\nTotal cost: $${report.cost.total}`);
console.log(`Regressions: ${report.regressions.length}`);
console.log(`Report written to the run output directory`);
