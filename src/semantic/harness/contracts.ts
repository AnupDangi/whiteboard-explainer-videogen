import type {ConceptIdentity,EvidenceRef,ObjectState,SemanticRelationRequirement,VisualArchetype,VisualSceneV2,CompiledSceneV2} from '../types.js';
import type {RepresentationResolution} from '../representation.js';

export const HARNESS_VERSION='teaching-compiler-v1' as const;
export type HarnessStage='ingest'|'knowledge-compiler'|'teaching-architect'|'whiteboard-planner'|'representation-guide'|'source-visual-grounding'|'visual-director'|'compiler'|'tts-alignment'|'pedagogy-critic'|'render';
export type StageOwner='harness'|'knowledge-compiler'|'teaching-architect'|'whiteboard-planner'|'representation-guide'|'source-visual-grounding'|'visual-director'|'compiler'|'speech-layer'|'pedagogy-critic'|'renderer';
export type GateCode='PREREQUISITE_ORDER'|'LEARNER_DELTA'|'MECHANISM_COVERAGE'|'CONTINUITY'|'COGNITIVE_LOAD'|'GROUNDING'|'DUPLICATION'|'VISUAL_SUPPORT'|'REPRESENTATION_DEGRADATION'|'COMPILE'|'TIMING'|'SPEECH';

export interface SourceEvidence extends EvidenceRef {page?:number;section?:string}
export interface ConceptGraph {
  version:1;
  concepts:ConceptIdentity[];
  aliases:Record<string,string>;
  prerequisites:{before:string;after:string;reason:string}[];
  mechanisms:{id:string;statement:string;conceptIds:string[];requiresStateChange:boolean;evidenceRefs:string[]}[];
  terminology:Record<string,{definition:string;introducedBy?:string}>;
  quantities:{conceptId:string;value:string;evidenceRefs:string[]}[];
  evidence:SourceEvidence[];
  sourceVisuals:{id:string;sourceId:string;page?:number;caption?:string;provenance:string}[];
}

export interface LearnerProfile {level:'novice'|'beginner'|'intermediate'|'advanced';goals:string[];language:string;assumedKnowledge:string[];constraints?:string[]}
export interface LearnerCheckpoint {beatId:string;prompt:string;expectedUnderstanding:string;kind:'prediction'|'retrieval'|'explanation'}
export interface LearnerState {
  establishedConcepts:string[];
  activeMentalModels:string[];
  terminology:Record<string,{definition:string;introducedAt:string}>;
  unresolvedQuestions:string[];
  misconceptionsAddressed:string[];
  checkpoints:LearnerCheckpoint[];
  provenance:{beatId:string;conceptIds:string[]}[];
}
export interface LearnerDelta {before:string;after:string;newConcepts:string[];reinforcedConcepts:string[]}
export type TeachingStrategy='intuition'|'analogy'|'worked-example'|'comparison'|'derivation'|'demonstration'|'causal-explanation'|'prediction'|'retrieval';
export interface TeachingContract {
  id:string;sceneId:string;objective:string;motivation:string;prerequisites:string[];
  learnerDelta:LearnerDelta;strategy:TeachingStrategy;mechanismIds:string[];
  misconception?:{claim:string;correction:string};checkpoint?:LearnerCheckpoint;
  evidenceRefs:string[];narrationDraft:string;relationIds:string[];
}

export type CanvasOperation='PRESERVE'|'TRANSFORM'|'INTRODUCE'|'RESET';
export interface CanvasDiff {operation:CanvasOperation;semanticKeys:string[];reason:string;fromState?:ObjectState;toState?:ObjectState}
export interface WhiteboardBeat {contractId:string;narration:string;semanticKeys:string[];relations:SemanticRelationRequirement[];diffs:CanvasDiff[]}
export interface WhiteboardPlan {sceneId:string;archetypes:VisualArchetype[];beats:WhiteboardBeat[];resetReason?:string}

export interface SemanticRegistryEntry {
  semanticKey:string;canonicalName:string;aliases:string[];persistentId:string;
  representationFamily?:string;colorRole?:string;semanticParts:string[];state?:ObjectState;
  sceneInstances:{sceneId:string;objectId:string}[];
}
export interface SemanticRegistrySnapshot {version:1;entries:SemanticRegistryEntry[]}

export interface GateFinding {code:GateCode;severity:'hard'|'advisory';stage:HarnessStage;message:string;context?:Record<string,unknown>}
export interface GateResult {stage:HarnessStage;passed:boolean;findings:GateFinding[]}
export interface StagePolicy {owner:StageOwner;timeoutMs:number;maxRepairs:0|1;budgetUsd:number}
export interface StageEnvelope<T> {
  harnessVersion:typeof HARNESS_VERSION;stage:HarnessStage;owner:StageOwner;attempt:0|1;
  startedAt:string;finishedAt:string;elapsedMs:number;inputHash:string;outputHash:string;
  model?:string;promptHash?:string;skillHash?:string;costUsd:number;promptTokens:number;completionTokens:number;
  gate:GateResult;output:T;
}
export interface StageFailureRecord {
  harnessVersion:typeof HARNESS_VERSION;stage:HarnessStage;owner:StageOwner;attempt:0|1;
  startedAt:string;finishedAt:string;elapsedMs:number;inputHash:string;status:'FAIL';
  model?:string;promptHash?:string;skillHash?:string;gate:GateResult;
  error:{name:string;message:string};
}
export type StageJournalEntry=StageEnvelope<unknown>|StageFailureRecord;
export interface HarnessRunManifest {
  version:typeof HARNESS_VERSION;runId:string;createdAt:string;inputHash:string;
  configHash:string;schemaHash:string;assetHash:string;promptSkillHash:string;
  stages:StageEnvelope<unknown>[];gates:GateResult[];costUsd:number;status:'PASS'|'FAIL'|'PARTIAL';
}

export interface RepresentationBundle {sceneId:string;resolutions:RepresentationResolution[]}
export interface HarnessSceneResult {
  conceptGraph:ConceptGraph;learnerBefore:LearnerState;learnerAfter:LearnerState;
  teachingContracts:TeachingContract[];whiteboardPlan:WhiteboardPlan;registry:SemanticRegistrySnapshot;
  visualScene:VisualSceneV2;compiled:CompiledSceneV2;gates:GateResult[];
}
