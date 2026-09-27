import type { FailureClass } from './contracts.js';

/**
 * P1 failure taxonomy wiring (SIMI-60 F1-F4 baseline).
 * Pure code-prefix mapping only. Never changes hard/soft gate behavior.
 *
 * Classes: P planner / S semantic-visualizer / C composition /
 *   T timing / R renderer / A audio.
 *
 * Rule (per task):
 * - planner-*, board-role-*, board-concept-*, board-relation-*, numeric,
 *   evidence-anchor -> S, EXCEPT syllabus/graph/parse problems -> P.
 * - layout/occupancy/overlap -> C.
 * - timeline/idle/clamp -> T.
 * - render/encode -> R.
 * - alignment/tts/mention-timing -> A.
 */

export type { FailureClass };

const lower = (code: string): string => code.toLocaleLowerCase();

export function classifyFailureCode(code: string): FailureClass {
  const c = lower(code);

  // board-too-sparse is checked before the syllabus/graph/parse exception:
  // 'sparse' contains the substring 'parse', so the generic exception would
  // mislabel it. It is the hard version of the F3 1-element element-count
  // warning (planner supplied too few nodes) and shares the S label.
  if (c.includes('too-sparse')) return 'S';

  // P exception wins over the S prefix rule: syllabus / graph / parse
  // problems are planner problems even when the code carries a planner- prefix.
  if (c.includes('syllabus') || c.includes('graph') || c.includes('parse')) return 'P';

  // S: semantic-visualizer — wrong content/relation chosen for the board.
  if (
    c.startsWith('planner-')
    || c.startsWith('board-role-')
    || c.startsWith('board-concept')
    || c.startsWith('board-relation')
    || c.includes('numeric')
    || c.includes('evidence-anchor')
  ) return 'S';

  // A: audio/word-timing root cause.
  if (
    c.includes('alignment')
    || c.includes('tts')
    || c.includes('mention')
    || c.includes('module-audio')
    || c.includes('word-alignment')
  ) return 'A';

  // T: timing — when reveals happen on the clock. Checked before C so a
  // timeline event with a dangling reference stays a timing failure while a
  // bare dangling id stays composition.
  if (
    c.includes('timeline')
    || c === 'dangling-event'
    || c.includes('idle')
    || c.includes('clamp')
    || c.includes('concurrency')
    || c.includes('av-sync')
    || c.includes('av-duration')
  ) return 'T';

  // C: composition — where things sit on the board.
  if (
    c.includes('layout')
    || c.includes('occupancy')
    || c.includes('overlap')
    || c.includes('safe-area')
    || c.includes('duplicate')
    || c.includes('dangling')
    || c.includes('anchor')
    || c.includes('invalid-math')
    || c.includes('min-readable')
  ) return 'C';

  // R: renderer/encoder.
  if (
    c.includes('render')
    || c.includes('encode')
    || c.includes('formula')
    || c.includes('unsafe-svg')
    || c.includes('caption')
    || c.includes('contact-sheet')
    || c.includes('no-scenes')
  ) return 'R';

  // S extras: sparse/wrong board content that is neither layout nor timing.
  if (c.includes('element-count') || c.includes('unresolved-object') || c.includes('no-source-evidence')) return 'S';

  // Default: planner-owned (budget/schema/provenance/unknown codes).
  return 'P';
}

/** Attach the pure taxonomy label without touching code/stage/message/hard. */
export function withFailureClass<T extends { code: string }>(failure: T): T & { failureClass: FailureClass } {
  return { ...failure, failureClass: classifyFailureCode(failure.code) };
}

/**
 * SIMI-60 fixed 60s baseline reclassification (docs/SIMI-60-BENCHMARK.md F1-F4).
 * Frozen run; values below only label already-recorded codes.
 *
 * - reasoning_modes (F1+F2): 4 codes planner-repair-failed, planner-fallback,
 *   planner-fallback-gate, board-role-incomplete -> all S at code level;
 *   scene rollup S+C because the diagnostic fallback preview is a
 *   composition consequence (renders but cannot publish).
 * - llm_gap (F3): element-count (1-element board) -> S.
 * - sensory_bridge: duplicate-element(-id) shape -> C (no hard hit in the
 *   frozen run; mapping only).
 * - key_takeaway (F4): overlap watch item -> C.
 */
export interface BaselineClassificationRow { scene: string; code: string; failureClass: FailureClass; note: string }

export const SIMI_60_BASELINE_CLASSIFICATION: BaselineClassificationRow[] = [
  { scene: '01-module_1_reasoning_modes', code: 'planner-repair-failed', failureClass: 'S', note: 'F1 numeric title unsupported by cited evidence' },
  { scene: '01-module_1_reasoning_modes', code: 'planner-fallback', failureClass: 'S', note: 'F1 deterministic fallback after identical repair' },
  { scene: '01-module_1_reasoning_modes', code: 'planner-fallback-gate', failureClass: 'S', note: 'F1 fallback retained as diagnostic preview' },
  { scene: '01-module_1_reasoning_modes', code: 'board-role-incomplete', failureClass: 'S', note: 'F2 convergence fallback missing output; scene rollup S+C with fallback composition impact' },
  { scene: '01-module_1_llm_gap', code: 'element-count', failureClass: 'S', note: 'F3 1-element board (warning only)' },
  { scene: '01-module_1_sensory_bridge', code: 'duplicate-element', failureClass: 'C', note: 'duplicate shape maps to C; no hard hit in frozen run' },
  { scene: '01-module_1_key_takeaway', code: 'overlap', failureClass: 'C', note: 'F4 n3/n4 shared reveal start watch item' },
];
