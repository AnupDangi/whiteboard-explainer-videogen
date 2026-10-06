import { z } from 'zod';
import { createHash } from 'node:crypto';
import { RELATION_TYPES } from '../../plan/schemas.js';

/**
 * TeachingBeatPlan (V2 plan Phase 2). S3 decides WHAT CHANGES IN THE LEARNER'S UNDERSTANDING for each scene as a short
 * sequence of beats. A beat owns meaning only: it has no wording, coordinates, assets, timestamps or SVG. Wording is S4's,
 * geometry S8's, time S9's.
 */
export const BEAT_TYPES = ['motivate', 'introduce', 'demonstrate', 'transform', 'contrast', 'counterexample', 'connect', 'summarize'] as const;
export const COGNITIVE_OPERATIONS = ['identify', 'compare', 'classify', 'trace', 'transform', 'quantify', 'predict', 'infer', 'explain_cause', 'understand_system'] as const;
export const REPRESENTATION_FAMILIES = ['literal_object', 'process', 'state_transition', 'sequence', 'topology', 'hierarchy', 'comparison', 'causal_chain', 'feedback_loop', 'quantity', 'spatial_model', 'equation', 'plot', 'code', 'scientific_diagram'] as const;
export const BEAT_PERSISTENCE = ['beat', 'scene', 'lesson'] as const;
export const PAUSE_INTENTS = ['none', 'micro', 'think', 'scene_close'] as const;
export const SEMANTIC_CHANGE_KINDS = ['introduce', 'focus', 'compare', 'flow', 'transform', 'move', 'separate', 'merge', 'quantity_update', 'select', 'finalize', 'plot', 'cause', 'feedback', 'annotate'] as const;
export const MAX_BEATS_PER_SCENE = 8;

const id = () => z.string().min(1).max(40).regex(/^[a-z0-9_]+$/, 'ids are lowercase snake_case tokens');

export const EntityRefSchema = z.object({
  /** Stable semantic key reused for the same logical entity across beats; code derives the persisted id. */
  identityKey: id(),
  conceptId: id(),
  /** The part this entity plays in the beat (a few words), not a drawing instruction. */
  role: z.string().min(1).max(48).optional(),
  /** How many instances the beat shows when quantity is the point (frames, particles, layers). */
  count: z.number().int().min(1).max(64).optional(),
  state: z.string().min(1).max(80).optional(),
}).strict();

export const CompiledEntityRefSchema = EntityRefSchema.extend({ entityId: id() }).strict();

export const RequiredSemanticChangeSchema = z.object({
  /** References EntityRefSchema.identityKey, never a renderer object or coordinate. */
  identityKey: id(),
  kind: z.enum(SEMANTIC_CHANGE_KINDS),
  fromState: z.string().trim().min(1).max(120).optional(),
  toState: z.string().trim().min(1).max(120),
}).strict();

export const CompiledSemanticChangeSchema = RequiredSemanticChangeSchema.extend({ entityId: id() }).strict();

export const RelationSpecSchema = z.object({ from: id(), to: id(), type: z.enum(RELATION_TYPES) }).strict();

export const StateSpecSchema = z.object({
  description: z.string().min(1).max(160),
  quantities: z.array(z.object({ conceptId: id().optional(), label: z.string().min(1).max(40), value: z.union([z.string().max(40), z.number()]) }).strict()).max(6).optional(),
}).strict();

export const BeatDraftSchema = z.object({
  claimIds: z.array(id()).min(1).max(3),
  learnerDelta: z.string().min(1).max(200),
  learningQuestion: z.string().trim().min(1).max(180),
  learnerBefore: z.string().trim().min(1).max(200),
  learnerAfter: z.string().trim().min(1).max(200),
  /** 1-based order indexes for earlier beats this learner transition depends on. */
  dependsOnOrders: z.array(z.number().int().min(1).max(MAX_BEATS_PER_SCENE)).max(MAX_BEATS_PER_SCENE - 1),
  beatType: z.enum(BEAT_TYPES),
  cognitiveOperation: z.enum(COGNITIVE_OPERATIONS),
  representationFamily: z.enum(REPRESENTATION_FAMILIES),
  entities: z.array(EntityRefSchema).max(8),
  /** Ordered semantic entity keys first revealed by this beat. */
  semanticRevealOrder: z.array(id()).max(8),
  /** Minimum learner-visible semantic changes required from this beat's representation. */
  requiredSemanticChanges: z.array(RequiredSemanticChangeSchema).max(8),
  relationships: z.array(RelationSpecSchema).max(8),
  stateBefore: StateSpecSchema.optional(),
  stateAfter: StateSpecSchema.optional(),
  /** Scene misconception ids (m1, m2 ...) this beat addresses. */
  misconceptionIds: z.array(id()).max(2),
  narrationGoal: z.string().min(1).max(200),
  /** What must be visible when the beat ends. */
  visualInvariant: z.string().max(200),
  /** What a viewer with the sound off should conclude from the board at the end of the beat. Empty only for narration-only beats. */
  mutedMeaning: z.string().max(200),
  narrationOnly: z.boolean(),
  persistence: z.enum(BEAT_PERSISTENCE),
  pauseIntent: z.enum(PAUSE_INTENTS),
}).strict();

export const BeatPlanDraftSchema = z.object({ beats: z.array(BeatDraftSchema).min(1).max(MAX_BEATS_PER_SCENE) }).strict();

export type BeatDraft = z.infer<typeof BeatDraftSchema>;
export type BeatPlanDraft = z.infer<typeof BeatPlanDraftSchema>;
export type EntityRef = z.infer<typeof EntityRefSchema>;
export type RequiredSemanticChange = z.infer<typeof RequiredSemanticChangeSchema>;
export type RelationSpec = z.infer<typeof RelationSpecSchema>;
export type PauseIntent = (typeof PAUSE_INTENTS)[number];
export type StateSpec = z.infer<typeof StateSpecSchema>;

/** Stable identity for a model-proposed key inside its scene-planning scope. */
export function semanticEntityId(identityKey: string, sceneId: string): string {
  return `se_${createHash('sha256').update(`${sceneId}\0${identityKey}`, 'utf8').digest('hex').slice(0, 24)}`;
}

export type CompiledEntityRef = z.infer<typeof CompiledEntityRefSchema>;
export type CompiledSemanticChange = z.infer<typeof CompiledSemanticChangeSchema>;

/** A beat after compilation: ids, order and evidence are assigned by code from the scene contract. */
export interface TeachingBeat extends Omit<BeatDraft, 'entities' | 'requiredSemanticChanges' | 'semanticRevealOrder'> {
  entities: CompiledEntityRef[];
  requiredSemanticChanges: CompiledSemanticChange[];
  /** Compiled stable semantic entity ids, in first-reveal order. */
  semanticRevealOrder: string[];
  /** Entity ids kept across beats when persistence is scene/lesson. */
  persistentEntityIds: string[];
  beatId: string;
  sceneId: string;
  order: number;
  /** Stable references compiled from model-declared earlier beat order indexes. */
  dependsOnBeatIds: string[];
  /** Union of the cited claims' evidence spans; never written by the model. */
  evidenceSpanIds: string[];
}
