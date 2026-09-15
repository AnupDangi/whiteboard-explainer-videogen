import {mkdir, writeFile, rm} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {join, resolve} from 'node:path';
import {generateV2, type GenerateOptions, type TelemetryEvent} from '../../src/semantic/planning/generate.js';
import {createJsonModel, type JsonModel} from '../../src/semantic/planning/model-adapter.js';
import {createVoiceEngineSpeech} from '../../src/semantic/speech.js';
import {lintCompiledScene} from '../../src/semantic/evaluation.js';
import {renderSVG} from '../../src/semantic/renderer/render-svg.js';
import {writeV2Artifacts} from '../../src/semantic/artifacts.js';
import {classifySemanticError} from '../../src/semantic/jobs.js';
import type {TeachingInput} from '../../src/semantic/planning/teaching-planner.js';
import type {CompiledSceneV2} from '../../src/semantic/types.js';
import {LIVE_EVAL_CASES, SMOKE_CASE_IDS, caseSource, type LiveEvalCase} from './manifest.js';
import {computeRunMetrics, evaluateCaseSemantics, expectedLearnerCoverage, sceneTelemetry, type CaseTelemetry} from './metrics.js';
import {aggregateReport, reportToMarkdown, type AggregateReport} from './compare.js';

export interface RunnerOptions {
  cases?: LiveEvalCase[];
  runs?: number;
  maxCostUsd?: number;
  narration?: boolean;
  smoke?: boolean;
  outDir?: string;
  env?: NodeJS.ProcessEnv;
  onProgress?:(done: number, total: number, caseId: string, runIndex: number, status: string)=>void;
}

function configHash(env: NodeJS.ProcessEnv): string {
  const relevant = [
    env.OPENROUTER_MODEL,
    env.V2_JSON_MODE,
    env.V2_CRITIC,
    env.MODEL_ROUTER,
    env.OPENROUTER_OUTLINE_MODEL,
    env.OPENROUTER_DIRECTOR_MODEL
  ].join('|');
  return createHash('sha256').update(relevant).digest('hex').slice(0, 16);
}

function envHash(env: NodeJS.ProcessEnv): string {
  const keys = Object.keys(env).filter(k => /^V2_|MODEL_|VOICE_|OPENROUTER_/.test(k)&&!/(KEY|TOKEN|SECRET|PASSWORD)/.test(k)).sort();
  const payload = keys.map(k => `${k}=${env[k]}`).join('\n');
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function createLiveModel(options: {env?: NodeJS.ProcessEnv; maxCostUsd?: number; signal?: AbortSignal}): JsonModel {
  return createJsonModel({
    env: options.env,
    maxCostUsd: options.maxCostUsd,
    signal: options.signal
  });
}

export async function runCase(
  c: LiveEvalCase,
  runIndex: number,
  options: RunnerOptions
): Promise<CaseTelemetry> {
  const env = options.env ?? process.env;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const runDir = join(options.outDir ?? '.data/eval/live/runs', c.id, String(runIndex));
  await mkdir(runDir, {recursive: true});
  const telemetry: TelemetryEvent[] = [];
  const scenes: CaseTelemetry['scenes'] = [];
  const compiledScenes: CompiledSceneV2[] = [];
  const harnessManifests:CaseTelemetry['harnessManifests']=[];
  let status: CaseTelemetry['status'] = 'error';
  let error: string | undefined;
  let errorKind: string | undefined;
  let model: JsonModel | undefined;

  const fixtureText = caseSource(c);
  const input: TeachingInput = {
    prompt: c.prompt,
    maxScenes: c.maxScenes ?? 1,
    allowedArchetypes: c.preferredArchetypes ?? ['simple_explanation'],
    language: 'en',
    ...(fixtureText ? {sourceText: fixtureText, sourceId: `case:${c.id}`} : {})
  };
  const metadata = {
    version: 1,
    runId,
    caseId: c.id,
    runIndex,
    startedAt,
    modelConfigHash: configHash(env),
    envHash: envHash(env),
    inputHash: contentHash(input),
    narration: Boolean(options.narration)
  };
  await writeFile(join(runDir, 'input.json'), JSON.stringify({case: c, teachingInput: input}, null, 2));
  await writeFile(join(runDir, 'run.json'), JSON.stringify(metadata, null, 2));

  try {
    model = createLiveModel({env, maxCostUsd: options.maxCostUsd ?? 0.15});
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    errorKind = classifySemanticError(error);
    return {
      caseId: c.id,
      runIndex,
      runId,
      modelConfigHash: configHash(env),
      envHash: envHash(env),
      status: 'error',
      error,
      errorKind,
      scenes: [],
      metrics: computeRunMetrics(telemetry, [], [], [], 'error', error, []),
      rawModelEvents: [],
      telemetryEvents: telemetry,
      startedAt,
      finishedAt: new Date().toISOString()
    };
  }

  const generateOptions: GenerateOptions = {
    onTelemetry: e => telemetry.push(e),
    signal: undefined
  };

  if (options.narration) {
    generateOptions.speech = createVoiceEngineSpeech({env, language: 'en'});
  }

  let lastLearner:{establishedConcepts:string[]}|undefined;
  try {
    for await (const result of generateV2(input, model, generateOptions)) {
      const compiled = result.compiled;
      const findings = lintCompiledScene(compiled);
      compiledScenes.push(compiled);
      harnessManifests.push(result.manifest);
      lastLearner = result.learnerAfter;
      const scene = sceneTelemetry(compiled, result.metrics);
      scene.compileFindings = findings;
      scenes.push(scene);

      await writeFile(join(runDir, 'scene.json'), JSON.stringify(compiled.scene, null, 2));
      await writeFile(join(runDir, 'compiled.json'), JSON.stringify(compiled, null, 2));
      await writeFile(join(runDir, `harness-manifest-${compiled.scene.id}.json`), JSON.stringify(result.manifest, null, 2));
      await writeFile(join(runDir, 'final.svg'), renderSVG(compiled, compiled.durationMs));
      if (result.speech) {
        await writeFile(join(runDir, `scene.wav`), result.speech.audio);
      }
      await writeV2Artifacts(compiled, join(runDir, 'artifacts'), result.speech ? {audio: {data: result.speech.audio, format: result.speech.format ?? 'wav'}} : {});
      if (findings.some(f => f.severity === 'hard')) {
        throw new Error(`Compiled scene failed hard lints: ${findings.filter(f => f.severity === 'hard').map(f => f.code).join(', ')}`);
      }
    }
    status = 'complete';
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    errorKind = classifySemanticError(error);
    status = scenes.length > 0 ? 'partial' : 'error';
  }

  const finishedAt = new Date().toISOString();
  const metrics = computeRunMetrics(telemetry, model.events, model.calls, scenes, status, error, harnessManifests);
  Object.assign(metrics, evaluateCaseSemantics(c, compiledScenes));
  metrics.expectedLearnerCoverage = expectedLearnerCoverage(c.comprehension, lastLearner?.establishedConcepts);

  return {
    caseId: c.id,
    runIndex,
    runId,
    modelConfigHash: configHash(env),
    envHash: envHash(env),
    status,
    error,
    errorKind,
    scenes,
    metrics,
    rawModelEvents: model.events,
    telemetryEvents: telemetry,
    startedAt,
    finishedAt
    ,harnessManifests
  };
}

export async function runLiveEvaluation(options: RunnerOptions = {}): Promise<{runs: CaseTelemetry[]; report: AggregateReport}> {
  const cases = options.smoke ? LIVE_EVAL_CASES.filter(c => SMOKE_CASE_IDS.includes(c.id)) : (options.cases ?? LIVE_EVAL_CASES);
  const runs = options.runs ?? 3;
  const outDir = resolve(options.outDir ?? `.data/eval/live/runs-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(outDir, {recursive: true});

  const results: CaseTelemetry[] = [];
  let done = 0;
  const total = cases.length * runs;

  for (const c of cases) {
    for (let i = 0; i < runs; i++) {
      const run = await runCase(c, i, {...options, outDir});
      results.push(run);
      done++;
      options.onProgress?.(done, total, c.id, i, run.status);
      const runDir = join(outDir, c.id, String(i));
      await writeFile(join(runDir, 'telemetry.json'), JSON.stringify({telemetry: run.telemetryEvents, modelEvents: run.rawModelEvents}, null, 2));
      await writeFile(join(runDir, 'metrics.json'), JSON.stringify(run.metrics, null, 2));
    }
  }

  const report = aggregateReport(cases, results, configHash(options.env ?? process.env));
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(outDir, 'report.md'), reportToMarkdown(report));
  return {runs: results, report};
}

export async function cleanRuns(outDir?: string): Promise<void> {
  const dir = resolve(outDir ?? '.data/eval/live');
  try { await rm(dir, {recursive: true, force: true}); } catch {/* ignore */}
}
