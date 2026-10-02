import type { EvaluationBundle, HypothesisRunManifest } from '../shared/contracts.js';
import { sha256, stableJson } from '../shared/artifacts.js';
import path from 'node:path';

export interface JudgeNarration { scenes: Array<{ sceneId: string }> }

export function resolveLocalRunArtifact(runDir: string, artifact: string | undefined): string | undefined {
  if (!artifact) return undefined;
  const root = path.resolve(runDir);
  const resolved = path.resolve(root, artifact);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  return resolved;
}

export function sourceTitleMatchesDeclaredTopic(sourceTitle: string | undefined, topic: string, aliases: string[]): boolean {
  if (!sourceTitle?.trim()) return false;
  const normalize = (value: string) => ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const sourceIdentity = normalize(sourceTitle);
  return [topic, ...aliases].some((alias) => alias.trim().length > 0 && sourceIdentity.includes(normalize(alias)));
}

export function sourceDocMatchesRecordedHash(manifest: HypothesisRunManifest, sourceDoc: unknown): boolean {
  const expected = manifest.stages?.sourceDoc;
  return typeof expected === 'string' && /^[a-f0-9]{64}$/i.test(expected) && sha256(stableJson(sourceDoc)) === expected;
}

/** Eligibility policy for visual-quality reports. Draft is allowed before judging; failed or fixture output is not. */
export function judgeRunEligibility(input: {
  manifest: HypothesisRunManifest & { runClass?: string; status?: string; video?: string };
  bundle: EvaluationBundle;
  narration: JudgeNarration;
  videoExists: boolean;
  sourceDocExists: boolean;
  sourceDocHashMatchesManifest?: boolean;
  topic?: string;
  sourceTitle?: string;
  topicAliases?: string[];
}): string[] {
  const reasons: string[] = [];
  const { manifest, bundle, narration } = input;
  if (manifest.schemaVersion !== 'hypothesis-run/v1') reasons.push('unsupported run manifest schema');
  if (manifest.runId !== bundle.runId || manifest.caseId !== bundle.caseId) reasons.push('manifest and evaluation identities disagree');
  if (manifest.runClass !== 'generated-lesson' || bundle.runClass !== 'generated-lesson') reasons.push('run class is not generated-lesson');
  if (!['draft', 'passed'].includes(bundle.status)) reasons.push('run status is not judgeable');
  if (bundle.schemaVersion !== 'evaluation-bundle/v2') reasons.push('evaluation bundle lacks the live stage/gate ledger');
  if (manifest.status !== bundle.status) reasons.push('manifest and evaluation status disagree');
  if (bundle.status === 'failed' || bundle.failures.some((failure) => failure.hard)) reasons.push('run has failed status or a hard failure');
  if (!manifest.video || !input.videoExists || !bundle.nativeArtifacts.video || manifest.video !== bundle.nativeArtifacts.video) reasons.push('completed MP4 is missing or manifest and bundle disagree');
  if (!bundle.nativeArtifacts.sourceDoc || !input.sourceDocExists) reasons.push('source document provenance is missing');
  if (!input.sourceDocHashMatchesManifest) reasons.push('source document hash does not match the run manifest');
  if (input.topic && !sourceTitleMatchesDeclaredTopic(input.sourceTitle, input.topic, input.topicAliases ?? [])) reasons.push(`source document title does not identify topic ${input.topic}`);
  if ((bundle.usage?.fallbacks ?? 0) > 0) reasons.push('run contains a planner fallback');
  const sceneCount = Number(bundle.metrics.sceneCount);
  if (!narration.scenes.length || !Number.isInteger(sceneCount) || sceneCount !== narration.scenes.length) reasons.push('planned scene count does not match narration scene count');
  const requiredStages = ['S1-source-intake', 'S2-concepts', 'S3-teaching-plan', 'S4-narration-script', 'S5-tts-alignment', 'S7-resolve', 'S8-layout', 'S9-timeline', 'S10-render', 'S11-mp4-encode', 'S12-captions'];
  const stageRuns = bundle.stageRuns ?? [];
  for (const stage of requiredStages) {
    if (!stageRuns.some((record) => record.stage === stage || record.stage.startsWith(`${stage}:`))) reasons.push(`stage record ${stage} is missing`);
  }
  for (const scene of narration.scenes) {
    if (!stageRuns.some((record) => record.stage === `S6-scene-planner:${scene.sceneId}`)) reasons.push(`stage record S6-scene-planner:${scene.sceneId} is missing`);
  }
  if (stageRuns.some((record) => record.status === 'failed')) reasons.push('one or more recorded stages failed');
  const sceneGates = (bundle.gateRecords ?? []).filter((gate) => gate.gateSet === 'claude' || gate.gateSet === 'shared');
  for (const scene of narration.scenes) {
    for (const gateSet of ['claude', 'shared'] as const) {
      if (!sceneGates.some((gate) => gate.sceneId === scene.sceneId && gate.gateSet === gateSet && gate.passed)) reasons.push(`${gateSet} gate for ${scene.sceneId} is missing or failed`);
    }
  }
  if (sceneGates.some((gate) => !gate.passed)) reasons.push('one or more scene quality gates failed');
  return [...new Set(reasons)];
}
