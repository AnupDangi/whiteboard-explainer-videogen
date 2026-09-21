import type {NodeKind,LayoutName,NodeShape,SceneTemplate} from '../domain/registry.js';
import type {SourceInput,SourceBlock,SourceIdentity,SourceIR,SourceIndex,LessonRequest,LessonContract,CaptionMode} from './contracts.js';
export type {SourceInput,SourceIdentity,SourceIR,SourceIndex,SourceIndexChunk,SourceBlock,SourceBlockType,EvidenceRef,LessonRequest,LessonContract,TeachingBrief,CoveragePlan,DurationProfile,GenerationBudget,LearnerContext,NarrativeArc,LessonSection,TeachingBeat,EquationPlan,EquationStep,LessonStylebook,VisualIdentity,DegradationRecord,TaskEnvelope,EventEnvelope,ArtifactReference,CaptionMode,PedagogyPattern} from './contracts.js';
export interface PlanNode { id: string; label: string; wordIndex: number; kind?: NodeKind; emphasis?: boolean; shape?: NodeShape; equationSteps?: string[]; keyPoint?: string; visualIntent?: string; attachTo?: string; position?: 'below'|'above'|'left'|'right'; beatId?: string; conceptId?: string; evidenceIds?: string[]; auto?: boolean; imageData?: string }
interface PlanEdge { from: string; to: string; label?: string }


export interface Beat { id: string; narration: string; meaning?: string }
export type {SceneTemplate,NodeShape};
export interface Scene { id: string; title: string; narration: string; layout: LayoutName; nodes: PlanNode[]; edges: PlanEdge[]; note?: string; beats?: Beat[]; template?: SceneTemplate }
export interface Plan { version: 1; title: string; scenes: Scene[] }
export interface Timing { kind: string; timingSource?: string; words: {word:string;startMs:number;endMs:number}[]; durationMs:number; gapMs?:number; trailingNonSilent?:boolean }
export interface Usage { model:string; promptTokens:number; completionTokens:number; cachedTokens:number; costUsd:number; calls:number; repairs?:number; spans?: PlannerSpans }

interface PlannerSpans { outlineMs:number; chapters:Record<string,{contentMs:number;directorMs:number}>; chunkingMs?:number; embeddingMs?:number; retrievalMs?:number; retrievalModes?:{bm25:number;hybrid:number} }

interface JobSpans { outlineMs?:number; chapters?:Record<string,{contentMs:number;directorMs:number}>; ttsMsByScene?:Record<string,number>; stageMs?:Record<string,number> }


export interface SourceDocument { kind:string; label:string; text:string; sha256:string; figures?:SourceFigure[]; pages?:Array<{page:number;start:number}>; map?:DocumentMap; identity?:SourceIdentity; sourceIR?:SourceIR; sourceIRs?:SourceIR[]; sourceIndexes?:SourceIndex[]; blocks?:SourceBlock[] }
interface MapSection { id:string; title:string; page:number; start:number; end:number; charCount:number; summary:string }
interface DocumentMap { kind:'book'|'paper'|'unknown'; sections:MapSection[] }
/** P2: one detected+described figure/table from a PDF source — planning input only. */
export interface SourceFigure { page:number; kind:'figure'|'table'; caption:string; dataHint:string; keyNumbers:string[] }
export interface GenerationOptions { mode:'model'; prompt?:string; source?:SourceInput; sources?:SourceInput[]; figures?:SourceFigure[]; durationMinutes?:number; maxCostUsd?:number; delayMs?:number; narration:boolean; ttsProvider?:'elevenlabs'|'voice-engine'; voiceId?:string; language?:string; visualCritic?:boolean; cachePrompts?:boolean; captionMode?:CaptionMode; lessonRequest?:LessonRequest }
export interface CompiledNode extends PlanNode { x:number; y:number; w:number; h:number; fontSize:number; lines:string[]; color:string; fillOpacity?:number; startMs:number; drawMs:number }
export interface CompiledEdge extends PlanEdge { x1:number; y1:number; x2:number; y2:number; startMs:number; drawMs:number }
export interface CompiledScene extends Scene { nodes:CompiledNode[]; edges:CompiledEdge[]; timing:Timing; audioUrl?:string; durationMs:number }
export interface JobSnapshot {
 id:string;status:string;revision:number;createdAt:number;mode:string;targetMinutes:number;plannerBudgetUsd:number;ttsCharacters:number;timingMode:string;simulatedDelayMs:number;scenes:CompiledScene[];availableMs:number;events:{sequence:number;type:string;atMs:number;availableMs:number;payload?:Record<string,unknown>}[];
  title?:string;totalScenes?:number;firstPlayableMs?:number;completedMs?:number;actualMinutes?:number;costPerMinuteUsd?:number;error?:string;errorKind?:string;usage?:Usage;source?:Omit<SourceDocument,'text'>&{characters:number};spans?:JobSpans;manifestVersion?:string;schemaVersion?:string;request?:LessonRequest;contract?:LessonContract;captionMode?:CaptionMode;
  

  degradedScenes?:Array<{id:string;reason:string}>; fallbackCount?:number; repairCount?:number;


  degradedStages?:Array<{stage:string;reason:string}>;
}
interface ProviderOptions {env?:NodeJS.ProcessEnv;fetcher?:typeof fetch;signal?:AbortSignal;voiceId?:string}
export interface Providers {plan?:(prompt:string,options:ProviderOptions)=>Promise<Plan>;speech?:(text:string,options:ProviderOptions)=>Promise<{audio:Buffer;timing:Timing;format?:'wav'|'mp3'}>}
