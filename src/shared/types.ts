import type {NodeKind,LayoutName} from './vocabulary.js';
export interface PlanNode { id: string; label: string; wordIndex: number; kind?: NodeKind; emphasis?: boolean; shape?: 'box'|'illustration'|'icon'|'circle'|'square'|'bullet'|'number'|'annotation'; keyPoint?: string; visualIntent?: string; attachTo?: string; position?: 'below'|'above'|'left'|'right'; beatId?: string; conceptId?: string; evidenceIds?: string[]; auto?: boolean }
export interface PlanEdge { from: string; to: string; label?: string }
/** V3-2 semantic beat: one idea = one narration segment. Beats partition the scene
 *  narration (exact substrings, in order); node anchors resolve inside their own
 *  beat so repeated words across beats cannot mismatch (harness §§11-12,24). */
export interface Beat { id: string; narration: string; meaning?: string }
/** V3-4 domain template: when a scene teaches a known domain composition the director
 *  may request its canonical sketch (harness §33) — geometry stays deterministic code. */
export type SceneTemplate='tls_handshake'|'supply_demand'|'attention_matrix'|'dna_fork'|'tectonic_section';
export interface Scene { id: string; title: string; narration: string; layout: LayoutName; nodes: PlanNode[]; edges: PlanEdge[]; note?: string; beats?: Beat[]; template?: SceneTemplate }
export interface Plan { version: 1; title: string; scenes: Scene[] }
export interface Timing { kind: string; words: {word:string;startMs:number;endMs:number}[]; durationMs:number; timingSource?: 'provider'|'aligner'|'estimated'; gapMs?:number; trailingNonSilent?:boolean }
export interface Usage { model:string; promptTokens:number; completionTokens:number; cachedTokens:number; costUsd:number; calls:number; repairs?:number; spans?: PlannerSpans }
/** Phase 0 timing spans: wall ms per planner stage, accumulated across attempts. */
export interface PlannerSpans { outlineMs:number; chapters:Record<string,{contentMs:number;directorMs:number}> }
/** Persisted per-job spans: planner stages plus per-scene TTS wall ms. */
export interface JobSpans { outlineMs?:number; chapters?:Record<string,{contentMs:number;directorMs:number}>; ttsMsByScene?:Record<string,number> }
export interface SourceInput { kind:'prompt'|'text'|'url'|'pdf'|'docx'|'pptx'|'markdown'|'json'; text?:string; url?:string; base64?:string; name?:string }
// pages: LD1 page-aware extraction — 1-based PDF page number plus the char offset in
// `text` where that page's text begins. Blank pages are omitted. PDF sources only.
// map: LD2 hierarchical document map — section tree built once per source (sha256-cached),
// consumed by the outline call (LD5) instead of raw text.
export interface SourceDocument { kind:string; label:string; text:string; sha256:string; figures?:SourceFigure[]; pages?:Array<{page:number;start:number}>; map?:DocumentMap }
export interface MapSection { id:string; title:string; page:number; start:number; end:number; charCount:number; summary:string }
export interface DocumentMap { kind:'book'|'paper'|'unknown'; sections:MapSection[] }
/** P2: one detected+described figure/table from a PDF source — planning input only. */
export interface SourceFigure { page:number; kind:'figure'|'table'; caption:string; dataHint:string; keyNumbers:string[] }
export interface GenerationOptions { mode:'model'|'fixture'; fixture?:string; prompt?:string; source?:SourceInput; figures?:SourceFigure[]; durationMinutes?:number; maxCostUsd?:number; delayMs?:number; narration:boolean; ttsProvider?:'voice-engine'; language?:string; voiceId?:string; visualCritic?:boolean; cachePrompts?:boolean }
export interface CompiledNode extends PlanNode { x:number; y:number; w:number; h:number; fontSize:number; lines:string[]; color:string; fillOpacity?:number; startMs:number; drawMs:number }
export interface CompiledEdge extends PlanEdge { x1:number; y1:number; x2:number; y2:number; startMs:number; drawMs:number }
export interface CompiledScene extends Scene { nodes:CompiledNode[]; edges:CompiledEdge[]; timing:Timing; audioUrl?:string; durationMs:number }
export interface JobSnapshot {
 id:string;status:string;revision:number;createdAt:number;mode:string;targetMinutes:number;plannerBudgetUsd:number;ttsCharacters:number;timingMode:string;simulatedDelayMs:number;scenes:CompiledScene[];availableMs:number;events:{sequence:number;type:string;atMs:number;availableMs:number}[];
  title?:string;totalScenes?:number;firstPlayableMs?:number;completedMs?:number;actualMinutes?:number;error?:string;errorKind?:string;usage?:Usage;source?:Omit<SourceDocument,'text'>&{characters:number};spans?:JobSpans;manifestVersion?:string;
  /** TTS reliability: scenes that fell back to estimated (silent) timing, with reasons.
   *  Their CompiledScene.timing.kind is 'estimated' and the UI labels them explicitly. */
  degradedScenes?:Array<{id:string;reason:string}>; fallbackCount?:number; repairCount?:number;
}
export interface InternalJob extends JobSnapshot {controller?:AbortController;task?:Promise<void>}
export interface ProviderOptions {env?:NodeJS.ProcessEnv;fetcher?:typeof fetch;signal?:AbortSignal;voiceId?:string;language?:string}
export interface Providers {plan?:(prompt:string,options:ProviderOptions)=>Promise<Plan>;speech?:(text:string,options:ProviderOptions)=>Promise<{audio:Buffer;timing:Timing;format?:'wav'|'mp3'}>}
