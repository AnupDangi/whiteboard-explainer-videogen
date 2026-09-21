import {createHash} from 'node:crypto';

type SourceKind='prompt'|'text'|'url'|'pdf'|'docx'|'pptx'|'markdown'|'json';
export interface SourceInput {kind:SourceKind;text?:string;url?:string;base64?:string;name?:string;title?:string}
type GroundingPolicy='general'|'source-only'|'source-plus-background';
export type DurationMinutes=1|5|10|30|60;
export interface LearnerContext {audience?:string;level?:'beginner'|'intermediate'|'advanced';assumedKnowledge?:string[];goals?:string[];locale?:string;accessibility?:string[]}
export type CaptionMode='off'|'sidecar'|'burn-in';
interface StylePreferences {tone?:string;visualTheme?:string;pace?:'slow'|'measured'|'fast';voiceId?:string;avoid?:string[];captionMode?:CaptionMode;narrationStyle?:string;visualStyle?:string;assessmentMode?:string}
export interface GenerationBudget {maxCostUsd:number;maxPaidRepairs?:number}
export interface LessonRequest {
  version:2;
  instruction?:string;
  sources:SourceInput[];
  durationMinutes:DurationMinutes;
  language:string;
  groundingPolicy:GroundingPolicy;
  learnerContext:Readonly<LearnerContext>;
  stylePreferences:Readonly<StylePreferences>;
  generationBudget:Readonly<GenerationBudget>;
}
/** Immutable semantic contract captured before model narration or scene work. */
export interface LessonContract {
  version:1;
  request:LessonRequest;
  precedence:string[];
  createdAt:string;
}

export type SourceStatus='ready'|'empty'|'scanned-or-low-text'|'js-only'|'unreadable'|'unsupported'|'oversized'|'private-network';
export interface SourceIdentity {id:string;sha256:string;kind:SourceKind;title:string;uri?:string;mediaType?:string}
export interface SourceLocation {page?:number;sectionId?:string;start?:number;end?:number}
interface SourceBlockBase {id:string;sourceId:string;type:SourceBlockType;location:SourceLocation}
interface HeadingBlock extends SourceBlockBase {type:'heading';text:string;level:number}
interface ParagraphBlock extends SourceBlockBase {type:'paragraph';text:string}
interface ListBlock extends SourceBlockBase {type:'list';ordered:boolean;items:string[]}
interface TableBlock extends SourceBlockBase {type:'table';caption?:string;columns:string[];rows:string[][]}
interface EquationBlock extends SourceBlockBase {type:'equation';text:string;latex?:string}
interface FigureBlock extends SourceBlockBase {type:'figure';imageRef?:string;caption?:string;nearbyText:string[];description?:string;semanticTags?:string[]}
interface CaptionBlock extends SourceBlockBase {type:'caption';text:string;targetBlockId?:string}
interface CodeBlock extends SourceBlockBase {type:'code';text:string;language?:string}
interface DiagramBlock extends SourceBlockBase {type:'diagram';text:string;diagramKind?:string;imageRef?:string}
interface CitationBlock extends SourceBlockBase {type:'citation';text:string;target?:string}
interface MetadataBlock extends SourceBlockBase {type:'metadata';key:string;value:string}
export type SourceBlockType='heading'|'paragraph'|'list'|'table'|'equation'|'figure'|'caption'|'code'|'diagram'|'citation'|'metadata';
export type SourceBlock=HeadingBlock|ParagraphBlock|ListBlock|TableBlock|EquationBlock|FigureBlock|CaptionBlock|CodeBlock|DiagramBlock|CitationBlock|MetadataBlock;
export interface SourceIR {version:1;identity:SourceIdentity;status:SourceStatus;blocks:SourceBlock[];metadata:Record<string,string>;warnings:string[]}

export interface SourceIndexChunk {id:string;sourceId:string;blockIds:string[];sectionPath:string[];page?:number;start:number;text:string;blockTypes:SourceBlockType[];tokens:number}
export interface SourceIndex {version:1;source:SourceIdentity;chunks:SourceIndexChunk[];documentMap:{sectionIds:string[]};retrievalMode:'bm25'|'hybrid'}
export interface EvidenceRef {sourceId:string;blockId:string;chunkId?:string;page?:number;sectionId?:string;origin:'source'|'background'}

export type CoverageTreatment='omit'|'mention'|'explain'|'demonstrate'|'derive'|'compare';
export interface CoverageRequirement {id:string;concept:string;treatment:CoverageTreatment;sectionId?:string;sceneId?:string;beatId?:string;evidence:EvidenceRef[]}
export interface CoveragePlan {version:1;requirements:CoverageRequirement[];notFitting:Array<{requirementId:string;reason:string}>}
export type PedagogyPattern='advance-organizer'|'prerequisite-scaffold'|'concrete-to-abstract'|'worked-example'|'active-prediction'|'self-explanation'|'misconception-check'|'retrieval-recap'|'cognitive-load';
export interface TeachingBrief {version:1;subject:string;sources:SourceIdentity[];objective:string;audience:string;learnerLevel:string;startingPoint:string;focus:string[];mustCover:string[];mustAvoid:string[];assumedKnowledge:string[];durationMinutes:DurationMinutes;groundingPolicy:GroundingPolicy;narrativeAngle:string;pedagogy:PedagogyPattern[]}
export interface NarrativeArc {version:1;title:string;stages:Array<{id:string;role:'orientation'|'context'|'prerequisite'|'concept'|'mechanism'|'example'|'limitation'|'synthesis'|'recap';objective:string}>}
export interface DurationProfile {version:1;minutes:DurationMinutes;targetSeconds:number;wordsPerMinute:number;introSeconds:number;outroSeconds:number;pauseSeconds:number;maxConcepts:number;modular:boolean}
export interface CourseSession {id:string;title:string;moduleIds:string[];targetSeconds:number}
export interface LessonModule {id:string;title:string;lessonIds:string[];targetSeconds:number}
export interface LessonPlan {id:string;title:string;sectionIds:string[];targetSeconds:number}
export interface LessonSection {id:string;title:string;sceneIds:string[];objective:string;targetSeconds:number}
export interface ScenePlan {id:string;sectionId:string;title:string;beatIds:string[];targetSeconds:number}
export type PedagogicalRole='orient'|'define'|'explain'|'demonstrate'|'derive'|'compare'|'challenge'|'recap'|'transition';
type TextOrigin='source'|'lesson-plan'|'representation'|'formula'|'axis-unit'|'compiler';
export interface TextProvenance {origin:TextOrigin;evidence?:EvidenceRef[];generatedBy?:string}
interface ProvenancedText {text:string;provenance:TextProvenance}
export interface VisualMutation {operation:'introduce'|'update'|'emphasize'|'connect'|'remove'|'hold';subjectId?:string;relation?:string}
export interface TeachingBeat {id:string;sceneId:string;claimIds:string[];evidence:EvidenceRef[];role:PedagogicalRole;spokenText:ProvenancedText;displayText?:ProvenancedText;visualIntent:string;visualMutation:VisualMutation;targetDurationMs:number}
export interface EquationStep {id:string;operation:'introduce'|'append-term'|'substitute'|'simplify'|'cancel'|'highlight'|'annotate'|'interpret';expression:string;explanation:string;verified:boolean}
export interface EquationPlan {version:1;id:string;sourceId?:string;sourceBlockId?:string;contextBlockIds?:string[];originalExpression:string;variables:Array<{symbol:string;meaning:string;unit?:string}>;assumptions:string[];steps:EquationStep[];status:'verified'|'flagged';warnings:string[]}
export interface VisualIdentity {conceptId:string;color:string;representation:string;assetId?:string}
export interface LessonStylebook {version:1;palette:Record<string,string>;concepts:Record<string,VisualIdentity>;fontScale:string;assetStyle:string;runningExample?:string;terminology:Record<string,string>}

export interface DegradationRecord {code:string;stage:string;reason:string;at:string;recoverable:boolean}
export interface ArtifactReference {hash:string;kind:string;mediaType:string;sizeBytes:number;version:string;storeKey:string}
export type TaskPool='ingest'|'llm'|'tts'|'compile'|'render';
export type TaskPriority=0|1|2|3|4;
export interface TaskEnvelope {id:string;jobId:string;pool:TaskPool;priority:TaskPriority;dependsOn:string[];attempt:number;attemptLimit:number;leaseOwner?:string;leaseExpiresAt?:string;heartbeatAt?:string;cancelledAt?:string;inputArtifacts:ArtifactReference[];outputArtifacts:ArtifactReference[];degradations:DegradationRecord[]}
type LessonEventType='scene.playable'|'coverage.not_fit'|'task.degraded'|'job.partial'|'export.ready'|string;
export interface EventEnvelope {jobId:string;taskId?:string;sequence:number;type:LessonEventType;at:string;artifacts:ArtifactReference[];payload:Record<string,unknown>}

const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):string|undefined=>typeof value==='string'&&value.trim()?value.trim():undefined;
const duration=(value:unknown):DurationMinutes|undefined=>[1,5,10,30,60].includes(Number(value))?Number(value) as DurationMinutes:undefined;
const budgetFor=(minutes:DurationMinutes)=>({1:0.50,5:0.70,10:1.00,30:1.20,60:1.50} as const)[minutes];

/** Stable content-derived IDs; prefixes keep logs and evidence readable. */
export function stableId(prefix:string,...parts:Array<string|number|undefined>):string {
  const digest=createHash('sha256').update(parts.map(part=>String(part??'')).join('\u0000')).digest('hex').slice(0,20);
  return `${prefix}_${digest}`;
}

function normalizeSource(value:unknown):SourceInput {
  if(!isRecord(value))throw new Error('Each source must be an object');
  const kind=text(value.kind) as SourceKind|undefined;
  if(!kind||!['prompt','text','url','pdf','docx','pptx','markdown','json'].includes(kind))throw new Error('Unsupported source kind');
  const source:SourceInput={kind};
  for(const key of ['text','url','base64','name','title'] as const){const found=text(value[key]);if(found)source[key]=found;}
  if(kind==='url'&&!source.url)throw new Error('URL source requires url');
  if(['prompt','text','markdown','json'].includes(kind)&&!source.text)throw new Error(`${kind} source requires text`);
  if(['pdf','docx','pptx'].includes(kind)&&!source.base64)throw new Error(`${kind} source requires base64`);
  return source;
}

/**
 * Compatibility boundary for both the canonical body and today's GenerationOptions.
 * Explicit fields win. Prompt duration inference exists only for legacy bodies.
 */
export function normalizeLessonRequest(value:unknown):LessonRequest {
  if(!isRecord(value))throw new Error('Lesson request must be an object');
  const explicitInstruction=text(value.instruction);
  const legacyPrompt=text(value.prompt);
  let sources:SourceInput[]=[];
  if(Array.isArray(value.sources))sources=value.sources.map(normalizeSource);
  else if(value.source!==undefined)sources=[normalizeSource(value.source)];
  const promptSources=sources.filter(source=>source.kind==='prompt');
  sources=sources.filter(source=>source.kind!=='prompt');
  const instruction=explicitInstruction??legacyPrompt??promptSources.map(source=>source.text).find(Boolean);
  const explicitDuration=duration(value.durationMinutes);
  if(value.durationMinutes!==undefined&&!explicitDuration)throw new Error('Duration must be 1, 5, 10, 30, or 60 minutes');
  const inferredDuration=!explicitDuration&&legacyPrompt?duration(legacyPrompt.match(/\b(1|5|10|30|60)\s*(?:minute|min)\b/i)?.[1]):undefined;
  const durationMinutes=explicitDuration??inferredDuration??1;
  const policy=text(value.groundingPolicy) as GroundingPolicy|undefined;
  if(policy&&!['general','source-only','source-plus-background'].includes(policy))throw new Error('Invalid grounding policy');
  if(!instruction&&sources.length===0)throw new Error('Prompt-only lessons require an instruction; source-driven lessons require at least one source');
  const learnerContext=isRecord(value.learnerContext)?value.learnerContext as LearnerContext:{};
  const rawStyle=isRecord(value.stylePreferences)?value.stylePreferences:{};
  const rawCaption=text(rawStyle.captionMode) as CaptionMode|undefined;
  if(rawCaption&&!['off','sidecar','burn-in'].includes(rawCaption))throw new Error('Invalid caption mode');
  const stylePreferences={...rawStyle,captionMode:rawCaption??'off'} as StylePreferences;
  const legacyMax=typeof value.maxCostUsd==='number'?value.maxCostUsd:undefined;
  const rawBudget=isRecord(value.generationBudget)?value.generationBudget:{};
  const maxCost=typeof rawBudget.maxCostUsd==='number'?rawBudget.maxCostUsd:legacyMax??budgetFor(durationMinutes);
  const absoluteMax=durationMinutes===60?2:budgetFor(durationMinutes);
  if(!Number.isFinite(maxCost)||maxCost<=0||maxCost>absoluteMax)throw new Error(`Budget must be above $0 and at most $${absoluteMax.toFixed(2)}`);
  const maxPaidRepairs=typeof rawBudget.maxPaidRepairs==='number'?rawBudget.maxPaidRepairs:2;
  if(!Number.isInteger(maxPaidRepairs)||maxPaidRepairs<0||maxPaidRepairs>2)throw new Error('Paid repair limit must be 0–2');
  return {version:2,...(instruction?{instruction}:{}),sources,durationMinutes,language:text(value.language)??'en',groundingPolicy:policy??(sources.length?'source-only':'general'),learnerContext,stylePreferences,generationBudget:{maxCostUsd:maxCost,maxPaidRepairs}};
}

function assertEvidenceRef(value:unknown):asserts value is EvidenceRef {
  if(!isRecord(value)||!text(value.sourceId)||!text(value.blockId)||!['source','background'].includes(String(value.origin)))throw new Error('Invalid evidence reference');
}

export function assertTeachingBeat(value:unknown):asserts value is TeachingBeat {
  if(!isRecord(value)||!text(value.id)||!text(value.sceneId)||!Array.isArray(value.claimIds)||!Array.isArray(value.evidence)||!isRecord(value.spokenText)||!isRecord(value.visualMutation)||!Number.isFinite(value.targetDurationMs)||Number(value.targetDurationMs)<=0)throw new Error('Invalid teaching beat');
  for(const ref of value.evidence)assertEvidenceRef(ref);
  for(const field of [value.spokenText,value.displayText].filter(Boolean)){
    if(!isRecord(field)||!text(field.text)||!isRecord(field.provenance)||!['source','lesson-plan','representation','formula','axis-unit','compiler'].includes(String(field.provenance.origin)))throw new Error('Teaching beat text requires allowed provenance');
  }
}

