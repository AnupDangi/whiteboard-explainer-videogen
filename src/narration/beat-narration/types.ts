import { z } from 'zod';
import type { PauseIntent } from '../../teaching/beat-plan/types.js';

/**
 * NarrationBeat (V2 plan Phase 3). S4 writes each teaching beat's speech as a few sentences; beat B17 of the plan is
 * narration beat B17, so every spoken word is addressable by beat and sentence. Semantic anchors carry exact copied
 * phrases, compiled to character spans for later alignment against final audio.
 */
const beatId = () => z.string().min(1).max(60).regex(/^[a-z0-9_.]+$/);
const eventId = () => z.string().min(1).max(72).regex(/^[a-z0-9_.]+$/);
const claimId = () => z.string().min(1).max(40).regex(/^[a-z0-9_]+$/);

export const BeatNarrationDraftSchema = z.object({
  beatId: beatId(),
  sentences: z.array(z.string().min(1).max(260)).min(1).max(4),
  /** Which sentence of this beat states each claim the beat teaches. */
  claimSentences: z.array(z.object({ claimId: claimId(), sentenceIndex: z.number().int().min(0).max(3) }).strict()).max(3),
  /** One phrase for each ordered required semantic change; copied exactly from its nominated sentence. */
  semanticAnchors: z.array(z.object({ semanticEventId: eventId(), sentenceIndex: z.number().int().min(0).max(3), phrase: z.string().min(1).max(260) }).strict()).max(8),
  /** Words the speaker should stress (concept labels); advisory input to the voice, never to the visuals. */
  emphasisTerms: z.array(z.string().min(1).max(40)).max(4),
}).strict();

export const SceneNarrationDraftSchema = z.object({ beats: z.array(BeatNarrationDraftSchema).min(1).max(8) }).strict();

export type BeatNarrationDraft = z.infer<typeof BeatNarrationDraftSchema>;
export type SceneNarrationDraft = z.infer<typeof SceneNarrationDraftSchema>;

export interface NarrationBeat {
  beatId: string;
  sentenceIds: string[];
  text: string;
  speakingStyle?: { emphasisTerms: string[] };
}

export interface SpanRange { charStart: number; charEnd: number }
export interface BeatSpan extends SpanRange {
  beatId: string;
  pauseIntent: PauseIntent;
  sentenceSpans: Array<SpanRange & { sentenceId: string }>;
}

export interface CompiledSceneNarration {
  sceneId: string;
  /** The scene's spoken text: beats joined in order, plain (no markers). This is what TTS reads. */
  text: string;
  beats: NarrationBeat[];
  beatSpans: BeatSpan[];
  /** Claim spans derived from the anchors, in the shape the V1 claim gates read. */
  claimSpans: Array<{ claimId: string; exactText: string; plainStart: number; plainEnd: number }>;
  /** Exact plain-text character offsets of the event phrases, ordered by beat and required change. */
  semanticAnchors: Array<{ semanticEventId: string; beatId: string; phrase: string; charStart: number; charEnd: number }>;
}
