#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import type { HypothesisRunOptions } from '../shared/contracts.js';
import { ATTENTION_SCENES_C6 } from './fixtures/attentionScenes.c6.js';
import { runHypothesis } from './pipeline/run.js';
import { PIPELINE } from './config.js';

/**
 * CLI entrypoint (cross-cutting requirement: "a CLI accepting the same
 * case/config manifest" as the sibling track).
 *
 * Usage:
 *   node cli.ts --case transformer-attention --out .data/hypothesis/claude
 *   node cli.ts --case transformer-attention --cache warm --artifact-cache-dir .data/hypothesis-cache
 *   node cli.ts --config path/to/manifest.json
 *
 * A manifest JSON looks like:
 *   { "caseId": "transformer-attention", "outputDir": "...", "options": { ...partial HypothesisRunOptions... } }
 *
 * Only `caseId: "transformer-attention"` has a SceneSpec source right now —
 * the three hand-authored Attention scenes (fixtures/attentionScenes.ts).
 * This command is the offline fixture runner. Provider-backed source lessons
 * use `run:lesson` and pipeline/lesson.ts + pipeline/runLive.ts.
 */

interface Manifest {
  caseId: string;
  outputDir?: string;
  options?: Partial<HypothesisRunOptions>;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1] ?? 'true';
      i++;
    }
  }
  return out;
}

function defaultOptions(outputDir: string): HypothesisRunOptions {
  return {
    mode: 'fixture',
    outputDir,
    narrationModel: 'fixture:hand-authored',
    visualModel: 'fixture:hand-authored',
    voice: { provider: 'voice-engine', language: 'en', speed: 1 },
    alignment: { provider: 'fixture' },
    render: { width: 1920, height: 1080, fps: 30 },
    maxRepairs: 1,
    cache: 'cold',
    maxCostUsd: PIPELINE.clipCostCapUsd,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let manifest: Manifest;
  if (args.config) {
    manifest = JSON.parse(await readFile(args.config, 'utf8'));
  } else if (args.case) {
    manifest = { caseId: args.case, outputDir: args.out ?? `.data/hypothesis/claude/${args.case}` };
  } else {
    console.error('Usage: cli.ts --case <goldenCaseId> --out <dir>  |  --config <manifest.json>');
    process.exitCode = 1;
    return;
  }

  if (manifest.caseId !== 'transformer-attention') {
    console.error(`No renderer-fixture SceneSpec is registered for "${manifest.caseId}". This CLI only runs the retained offline fixture; use lessonCli.ts --source=<file> for the source-generated S1–S12 path.`);
    process.exitCode = 1;
    return;
  }

  const outputDir = manifest.outputDir ?? '.data/hypothesis/claude/transformer-attention';
  const requestedCache = args.cache ?? manifest.options?.cache;
  if (requestedCache && !['cold', 'warm', 'replay'].includes(requestedCache)) throw new Error('--cache must be cold, warm, or replay');
  const options: HypothesisRunOptions = {
    ...defaultOptions(outputDir),
    ...manifest.options,
    ...(requestedCache ? { cache: requestedCache as HypothesisRunOptions['cache'] } : {}),
    outputDir,
  };

  const result = await runHypothesis({ caseId: manifest.caseId, scenes: ATTENTION_SCENES_C6.map((s) => ({ sceneId: s.sceneId, raw: s.raw, spec: s.spec })) }, options, args['artifact-cache-dir']);

  const hardFailures = result.failures.filter((f) => f.hard);
  console.log(`runId=${result.runId} scenes=${result.scenes.length} hardFailures=${hardFailures.length} warnings=${result.failures.length - hardFailures.length}`);
  for (const f of hardFailures) console.error(`  [HARD] ${f.stage}/${f.code}: ${f.message}`);
  console.log(`artifacts written to ${outputDir}`);
  if (hardFailures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
