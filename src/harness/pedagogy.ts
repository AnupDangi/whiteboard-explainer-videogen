import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import type { CompiledSceneNarration } from '../narration/beat-narration/types.js';

/**
 * T1 S12 pedagogy evals (STCC §22 PEDAGOGY + §48 muted comprehension).
 * Deterministic and offline: no LLM, no audio, no video. Operates on the
 * compiled beat plan plus compiled narration, so it runs before any synthesis.
 * Semantic depth (is the repair correct?) stays with human/VLM judges; these
 * checks prove the structural preconditions of good teaching instead.
 */

export type PedagogySeverity = 'hard' | 'soft';
export type PedagogyDimension =
  | 'worked-example'
  | 'misconception-repair'
  | 'divergence-clarity'
  | 'lesson-shape'
  | 'muted-comprehension'
  | 'narration-continuity';

export interface PedagogyFinding {
  dimension: PedagogyDimension;
  severity: PedagogySeverity;
  beatId?: string;
  message: string;
}

export interface PedagogyInput {
  beats: readonly TeachingBeat[];
  narration: CompiledSceneNarration;
}

const STOP = new Set('a,an,the,is,are,was,were,be,been,of,to,in,on,for,with,as,by,at,from,or,and,but,so,it,its,this,that,these,those,you,we,they,them,what,why,how,when,not,no,do,does,did,can,will,just,very,more,most,one,into,over,than,then,there,here,such,only,also,which,who,whom,whose,because,means,now,let'.split(','));
const contentWords = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[a-z\u00c0-\u024f\u1e00-\u1eff\u0900-\u097f]+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w)));

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
};

/** A worked demonstration must show a before AND an after state (STCC §8 WorkExample / TraceMechanism). */
function workedExample(beats: readonly TeachingBeat[]): PedagogyFinding[] {
  const out: PedagogyFinding[] = [];
  for (const beat of beats) {
    if (beat.beatType !== 'demonstrate' && beat.beatType !== 'transform') continue;
    if (beat.narrationOnly) { out.push({ dimension: 'worked-example', severity: 'hard', beatId: beat.beatId, message: 'demonstrate/transform beat is narration-only: no visible state change' }); continue; }
    if (!beat.stateBefore || !beat.stateAfter) {
      out.push({ dimension: 'worked-example', severity: 'hard', beatId: beat.beatId, message: 'demonstrate/transform beat needs both stateBefore and stateAfter' });
    }
  }
  return out;
}

/** A beat that claims to address a misconception must show the repair, not just name the error (STCC §10). */
function misconceptionRepair(beats: readonly TeachingBeat[]): PedagogyFinding[] {
  const out: PedagogyFinding[] = [];
  for (const beat of beats) {
    if (beat.misconceptionIds.length === 0) continue;
    if (beat.narrationOnly) out.push({ dimension: 'misconception-repair', severity: 'hard', beatId: beat.beatId, message: 'misconception beat is narration-only: repair must be visible' });
    if (!beat.mutedMeaning.trim()) out.push({ dimension: 'misconception-repair', severity: 'hard', beatId: beat.beatId, message: 'misconception beat has no mutedMeaning: the repair is not inspectable silent' });
    if (beat.beatType !== 'contrast' && beat.beatType !== 'counterexample' && beat.beatType !== 'demonstrate' && beat.beatType !== 'transform') {
      out.push({ dimension: 'misconception-repair', severity: 'soft', beatId: beat.beatId, message: 'misconception beat uses a non-contrast beat type: divergence may be unclear' });
    }
  }
  return out;
}

/** A comparison needs at least two sides (STCC §8 CompareCases). */
function divergenceClarity(beats: readonly TeachingBeat[]): PedagogyFinding[] {
  const out: PedagogyFinding[] = [];
  for (const beat of beats) {
    if (beat.beatType !== 'contrast' && beat.beatType !== 'counterexample') continue;
    if (beat.entities.length < 2) out.push({ dimension: 'divergence-clarity', severity: 'hard', beatId: beat.beatId, message: 'contrast/counterexample beat has fewer than 2 entities: nothing to diverge' });
  }
  return out;
}

/** A lesson opens by motivating and closes by consolidating (Simi rhythm: orient → … → pause → continue). */
function lessonShape(beats: readonly TeachingBeat[]): PedagogyFinding[] {
  const out: PedagogyFinding[] = [];
  if (beats.length === 0) return [{ dimension: 'lesson-shape', severity: 'hard', message: 'no beats' }];
  const first = beats[0]!.beatType;
  if (first !== 'motivate' && first !== 'introduce') out.push({ dimension: 'lesson-shape', severity: 'soft', beatId: beats[0]!.beatId, message: 'scene does not open with motivate/introduce' });
  const last = beats[beats.length - 1]!.beatType;
  if (last !== 'summarize' && last !== 'connect') out.push({ dimension: 'lesson-shape', severity: 'soft', beatId: beats[beats.length - 1]!.beatId, message: 'scene does not close with summarize/connect' });
  return out;
}

/** Every visual beat must be interpretable with the sound off (STCC §48). */
function mutedComprehension(beats: readonly TeachingBeat[]): PedagogyFinding[] {
  const out: PedagogyFinding[] = [];
  for (const beat of beats) {
    if (beat.narrationOnly) continue;
    if (!beat.mutedMeaning.trim()) out.push({ dimension: 'muted-comprehension', severity: 'hard', beatId: beat.beatId, message: 'visual beat has empty mutedMeaning' });
    if (!beat.visualInvariant.trim()) out.push({ dimension: 'muted-comprehension', severity: 'hard', beatId: beat.beatId, message: 'visual beat has empty visualInvariant' });
  }
  return out;
}

/** Speech must read as one continuous lesson, not separate fact cards (S4 continuity). */
function narrationContinuity(beats: readonly TeachingBeat[], narration: CompiledSceneNarration): PedagogyFinding[] {
  const out: PedagogyFinding[] = [];
  const byId = new Map(narration.beats.map((b) => [b.beatId, b.text]));
  if (/in this video/i.test(narration.text)) out.push({ dimension: 'narration-continuity', severity: 'hard', message: 'narration refers to "this video": audio must stand alone' });
  for (let i = 1; i < beats.length; i++) {
    const prev = byId.get(beats[i - 1]!.beatId) ?? '';
    const cur = byId.get(beats[i]!.beatId) ?? '';
    if (!prev.trim() || !cur.trim()) continue;
    if (jaccard(contentWords(prev), contentWords(cur)) >= 0.8) {
      out.push({ dimension: 'narration-continuity', severity: 'hard', beatId: beats[i]!.beatId, message: 'beat repeats the previous beat almost verbatim: fact cards, not a lesson' });
    }
  }
  return out;
}

export function evaluatePedagogy(input: PedagogyInput): PedagogyFinding[] {
  return [
    ...workedExample(input.beats),
    ...misconceptionRepair(input.beats),
    ...divergenceClarity(input.beats),
    ...lessonShape(input.beats),
    ...mutedComprehension(input.beats),
    ...narrationContinuity(input.beats, input.narration),
  ];
}

/** Hard findings block promotion; soft findings are recorded but advisory. */
export const pedagogyPasses = (findings: readonly PedagogyFinding[]): boolean =>
  !findings.some((f) => f.severity === 'hard');
