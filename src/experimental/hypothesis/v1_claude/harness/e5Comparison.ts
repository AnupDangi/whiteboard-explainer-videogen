import type { EvaluationBundle, HypothesisRunManifest } from '../../shared/contracts.js';
import { stableJson } from '../../shared/artifacts.js';
import { judgeRunEligibility, type JudgeNarration } from './judgeEligibility.js';

export type E5Contrast = 'prompt-arm' | 'planner-model';

export interface E5HeldOutSet {
  schemaVersion: 'e5-heldout-set/v1';
  setId: string;
  version: string;
  createdAt: string;
  sources: Array<{ caseId: string; sourceDocSha256: string }>;
}

export interface E5RunCandidate {
  manifest: HypothesisRunManifest & { runClass?: string; status?: string; video?: string };
  bundle: EvaluationBundle;
  narration: JudgeNarration;
  videoExists: boolean;
  sourceDocExists: boolean;
  sourceDocHashMatchesManifest: boolean;
  sourceTitle?: string;
}

/** Require exact membership in a versioned held-out set; a matching title or case ID alone is insufficient. */
export function e5HeldOutSourceProblems(set: E5HeldOutSet, candidate: E5RunCandidate): string[] {
  const problems: string[] = [];
  if (set.schemaVersion !== 'e5-heldout-set/v1') problems.push('unsupported E5 held-out set schema');
  if (!set.setId.trim() || !set.version.trim()) problems.push('E5 held-out set ID and version are required');
  if (!Number.isFinite(Date.parse(set.createdAt))) problems.push('E5 held-out set creation timestamp is invalid');
  if (!set.sources.length) problems.push('E5 held-out set has no frozen source records');
  const keys = set.sources.map((source) => `${source.caseId}\0${source.sourceDocSha256}`);
  if (new Set(keys).size !== keys.length) problems.push('E5 held-out set contains duplicate case/source records');
  for (const source of set.sources) {
    if (!source.caseId.trim() || !/^[a-f0-9]{64}$/i.test(source.sourceDocSha256)) problems.push('E5 held-out source records require a case ID and 64-character SHA-256');
  }
  const sourceDocHash = candidate.manifest.stages.sourceDoc;
  if (typeof sourceDocHash !== 'string' || !set.sources.some((source) => source.caseId === candidate.manifest.caseId && source.sourceDocSha256 === sourceDocHash)) {
    problems.push('run case ID and exact SourceDoc hash are absent from the E5 held-out set');
  }
  return [...new Set(problems)];
}

type PromptTreatment = NonNullable<HypothesisRunManifest['promptExperiment']>;
const REQUIRED_STAGE_HASHES = ['input', 'sourceDoc', 'narration', 'alignedAudio'] as const;
const SAME_RUN_OPTIONS = ['mode', 'voice', 'alignment', 'render', 'narrationModel'] as const;

/** Gate a blind pair before any video is copied into a participant pack. */
export function e5ComparisonProblems(a: E5RunCandidate, b: E5RunCandidate, contrast: E5Contrast): string[] {
  const problems: string[] = [];
  for (const [label, run] of [['A', a], ['B', b]] as const) {
    for (const reason of judgeRunEligibility({
      manifest: run.manifest,
      bundle: run.bundle,
      narration: run.narration,
      videoExists: run.videoExists,
      sourceDocExists: run.sourceDocExists,
      sourceDocHashMatchesManifest: run.sourceDocHashMatchesManifest,
    })) problems.push(`${label}: ${reason}`);
  }
  if (a.manifest.runId === b.manifest.runId) problems.push('E5 pair must contain two distinct runs');
  if (a.manifest.caseId !== b.manifest.caseId) problems.push('E5 pair must use the same lesson/case ID');
  for (const key of REQUIRED_STAGE_HASHES) {
    const left = a.manifest.stages[key];
    const right = b.manifest.stages[key];
    if (typeof left !== 'string' || typeof right !== 'string' || left !== right) problems.push(`E5 pair ${key} hashes must match`);
  }
  if (!a.manifest.mediaSha256?.audio || a.manifest.mediaSha256.audio !== b.manifest.mediaSha256?.audio) {
    problems.push('E5 pair must use byte-identical narration audio');
  }
  for (const key of SAME_RUN_OPTIONS) {
    if (stableJson(a.manifest.options[key]) !== stableJson(b.manifest.options[key])) problems.push(`E5 pair ${key} options must match`);
  }

  const ta = a.manifest.promptExperiment as PromptTreatment | undefined;
  const tb = b.manifest.promptExperiment as PromptTreatment | undefined;
  if (!ta || !tb) return [...new Set([...problems, 'E5 pair is missing prompt-treatment metadata'])];
  for (const key of ['bankVersion', 'bankHash', 'rankVersion', 'catalogVersion', 'promptVersion'] as const) {
    if (ta[key] !== tb[key]) problems.push(`E5 pair ${key} must match`);
  }
  if (ta.plannerModel !== a.manifest.options.visualModel || tb.plannerModel !== b.manifest.options.visualModel) {
    problems.push('E5 prompt-treatment planner model disagrees with run options');
  }
  if (contrast === 'prompt-arm') {
    if (a.manifest.options.visualModel !== b.manifest.options.visualModel || ta.plannerModel !== tb.plannerModel) problems.push('prompt-arm contrast must hold planner model constant');
    if (ta.arm === tb.arm && ta.exampleOrder === tb.exampleOrder) problems.push('prompt-arm contrast must change arm or example order');
  } else {
    if (ta.arm !== tb.arm || ta.exampleOrder !== tb.exampleOrder) problems.push('planner-model contrast must hold prompt arm and example order constant');
    if (ta.plannerModel === tb.plannerModel) problems.push('planner-model contrast must use different planner models');
  }
  return [...new Set(problems)];
}
