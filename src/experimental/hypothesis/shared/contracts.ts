import type {TeachingBeat} from '../../../types/contracts.js';

export const EXPERIMENT={
  schemaVersion:'hypothesis-experiment/v1',
  targetDurationMs:30_000,
  width:1920,
  height:1080,
  fps:30,
  safeArea:64,
  maxClipCostUsd:.10,
  maxComparisonCostUsd:1,
  maxJudgeCostUsd:.25,
} as const;

export interface GoldenRelation {from:string;to:string;type:string}
export type NativeSourceLocation =
  | {kind:'pdf-page';page:number}
  | {kind:'pptx-slide';slide:number}
  | {kind:'docx-paragraph';bodyBlock:number;paragraph:number}
  | {kind:'docx-table';bodyBlock:number;table:number}
  | {kind:'web-url';url:string;selector?:string};
export interface EvidenceReference {sourceId:string;spanId:string;startChar:number;endChar:number;startLine:number;endLine:number;quote:string;sourceLocation?:NativeSourceLocation}
export interface GoldenSourceFigure {id:string;path?:string;caption:string;mediaType:string;sha256?:string}
export interface GoldenCase {
  schemaVersion:'golden-case/v1';
  id:string;
  title:string;
  targetDurationMs:30_000;
  teachingBeats:TeachingBeat[];
  sourceContext?:{text?:string;equations?:string[];figures?:GoldenSourceFigure[]};
  requiredClaims:string[];
  requiredRelations:GoldenRelation[];
  learnerInference:string;
  misconception:string;
  sealed?:boolean;
}

export interface HypothesisRunOptions {
  mode:'fixture'|'live';
  outputDir:string;
  narrationModel:string;
  visualModel:string;
  visionModel?:string;
  voice:{provider:'voice-engine';voiceId?:string;language:string;speed:number};
  alignment:{provider:'fixture'|'stable-ts';calibrationMedianErrorMs?:number};
  render:{width:1920;height:1080;fps:30};
  maxRepairs:1;
  cache:'cold'|'warm'|'replay';
  maxCostUsd:number;
  /** Explicitly allow an invalid caption clock to omit captions while retaining a failed diagnostic MP4. */
  diagnosticCaptionlessVideo?:boolean;
  seed?:number;
}

export interface StageArtifact<T> {
  schemaVersion:string;
  stageVersion:string;
  promptVersion?:string;
  modelId?:string;
  inputHash:string;
  contentHash:string;
  payload:T;
}

export interface RunUsage {calls:number;promptTokens:number;completionTokens:number;cachedTokens:number;costUsd:number;repairs:number;fallbacks:number;cacheHits:number}
/** Failure taxonomy class: P planner, S semantic-visualizer, C composition, T timing, R renderer, A audio. Pure label; never changes hard/soft gate behavior. */
export type FailureClass='P'|'S'|'C'|'T'|'R'|'A';
export interface RunFailure {code:string;stage:string;message:string;hard:boolean;failureClass?:FailureClass}
export interface StageRunRecord {
  stage:string;
  kind:'provider'|'local'|'mixed';
  status:'completed'|'failed';
  durationMs:number;
  /** Wall-clock interval for overlap and critical-path analysis. */
  startedAt?:string;
  completedAt?:string;
  /** Provider/API spend incurred by this invocation (zero for a cache hit). */
  apiCostUsd:number;
  /** This stage's cost is an aggregate also represented by detailed child provider stage records. */
  accountingRole?:'aggregate';
  /** Original provider spend represented by a cached artifact, when known. */
  artifactApiCostUsd?:number;
  /** True when spend is a bounded estimate because a sidecar has no provider invoice usage. */
  costEstimated?:boolean;
  /** False when source intake happened before this run and its original wall time is unavailable. */
  timingKnown?:boolean;
  cacheHit:boolean;
  fallbackCount:number;
  usage?:RunUsage;
  failures:RunFailure[];
}
export interface GateRunRecord {
  gateSet:'claude'|'shared'|'publish';
  sceneId?:string;
  passed:boolean;
  failures:RunFailure[];
  warnings:RunFailure[];
}
export type RunClass='renderer-fixture'|'hand-authored-script'|'generated-lesson';
export type RunStatus='draft'|'failed'|'passed';
export interface NeutralElement {id:string;kind:string;label?:string;bbox:{x:number;y:number;w:number;h:number};sourceRef?:string;evidenceRefs?:EvidenceReference[]}
export interface NeutralTimelineEvent {elementId:string;action:string;startMs:number;endMs:number;anchor?:string;pedagogicalHold?:boolean}
export interface EvaluationBundle {
  schemaVersion:'evaluation-bundle/v1'|'evaluation-bundle/v2';
  pipeline:'chatgpt'|'claude';
  runClass:RunClass;
  status:RunStatus;
  caseId:string;
  runId:string;
  commit:string;
  configHash:string;
  nativeArtifacts:Record<string,string>;
  claims:string[];
  claimEvidence:Record<string,EvidenceReference[]>;
  visualEvidence:Record<string,EvidenceReference[]>;
  relations:GoldenRelation[];
  elements:NeutralElement[];
  timeline:NeutralTimelineEvent[];
  provenance:Record<string,string[]>;
  metrics:Record<string,number|string|boolean>;
  usage:RunUsage;
  failures:RunFailure[];
  stageRuns?:StageRunRecord[];
  gateRecords?:GateRunRecord[];
}

export interface HypothesisRunManifest {
  schemaVersion:'hypothesis-run/v1';
  pipeline:'chatgpt'|'claude';
  runId:string;
  caseId:string;
  startedAt:string;
  completedAt:string;
  /** End-to-end CLI interval includes source intake and S1-S4 preparation. */
  executionTiming?:{
    startedAt:string;
    completedAt:string;
    wallMs:number;
    pipelineStartedAt:string;
    preparationMs:number;
  };
  options:HypothesisRunOptions;
  /** Versioned Claude S6 treatment metadata used to audit matched E5 comparisons. */
  promptExperiment?: {
    arm:'zero'|'text'|'mechanism'|'diverse';
    exampleOrder:'ranked'|'reverse';
    bankVersion:string;
    bankHash:string;
    rankVersion:string;
    catalogVersion:string;
    promptVersion:string;
    plannerModel:string;
  };
  stages:Record<string,unknown>;
  /** Hashes of exact mux inputs/outputs when the runner has materialized them. */
  mediaSha256?:{audio?:string;video?:string};
  evaluationBundle:string;
  svg:string;
  video?:string;
  contactSheet?:string;
}

export function assertCommonRunOptions(value:HypothesisRunOptions):void{
  if(value.render.width!==EXPERIMENT.width||value.render.height!==EXPERIMENT.height||value.render.fps!==EXPERIMENT.fps)throw new Error('Scored runs require 1920x1080 at 30 fps');
  if(value.maxRepairs!==1)throw new Error('Exactly one schema repair is allowed');
  if(value.maxCostUsd<=0||value.maxCostUsd>EXPERIMENT.maxComparisonCostUsd)throw new Error('Clip cost exceeds the $1.00 hard cap');
  if(value.mode==='live'&&value.alignment.provider!=='stable-ts')throw new Error('Live scored runs require stable-ts alignment');
  const calibrationErrorMs=value.alignment.calibrationMedianErrorMs;
  if(value.mode==='live'&&calibrationErrorMs!==undefined&&(!Number.isFinite(calibrationErrorMs)||calibrationErrorMs<0||calibrationErrorMs>=80))throw new Error('Measured alignment calibration must be between 0ms and 80ms');
}
