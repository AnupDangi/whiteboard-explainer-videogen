import { z } from 'zod';

const semanticId = () => z.string().min(1).max(80).regex(/^[a-z0-9_.-]+$/);
const claimIds = () => z.array(semanticId()).min(1).max(12).refine((ids) => new Set(ids).size === ids.length, 'claim ids must be unique');
const scalar = () => z.union([z.string().min(1).max(80), z.number().finite()]);
const eventId = () => z.string().min(1).max(100).regex(/^[a-z0-9_.-]+\.e[1-8]$/);

export const SEMANTIC_ENTITY_LIFECYCLES = ['active', 'finalized', 'merged', 'separated'] as const;
export const SemanticEntitySchema = z.object({
  id: semanticId(),
  conceptId: semanticId(),
  label: z.string().trim().min(1).max(100),
  claimIds: claimIds(),
  state: z.string().trim().min(1).max(160).optional(),
  /** A semantic location identity, never a screen region or coordinate. */
  locationId: semanticId().optional(),
  quantity: scalar().optional(),
  unit: z.string().trim().min(1).max(24).optional(),
  lifecycle: z.enum(SEMANTIC_ENTITY_LIFECYCLES),
}).strict();
export type SemanticEntity = z.infer<typeof SemanticEntitySchema>;

export const SemanticRelationSchema = z.object({
  id: semanticId(),
  fromEntityId: semanticId(),
  toEntityId: semanticId(),
  type: z.string().trim().min(1).max(48),
  claimIds: claimIds(),
  weight: scalar().optional(),
}).strict();
export type SemanticRelation = z.infer<typeof SemanticRelationSchema>;

/** Numerical data values on semantic axes, never screen coordinates. */
const plotPoint = z.object({ independentValue: z.number().finite(), dependentValue: z.number().finite() }).strict();
export const SemanticPlotSchema = z.object({
  id: semanticId(),
  label: z.string().trim().min(1).max(80),
  claimIds: claimIds(),
  xUnit: z.string().trim().min(1).max(24).optional(),
  yUnit: z.string().trim().min(1).max(24).optional(),
  points: z.array(plotPoint).min(1).max(128),
  thresholds: z.array(z.object({ id: semanticId(), value: z.number().finite(), label: z.string().trim().min(1).max(60), claimIds: claimIds() }).strict()).max(16),
}).strict();
export type SemanticPlot = z.infer<typeof SemanticPlotSchema>;

export const SemanticFeedbackLoopSchema = z.object({
  id: semanticId(),
  sourceEntityId: semanticId(),
  targetEntityId: semanticId(),
  polarity: z.enum(['reinforcing', 'balancing']),
  claimIds: claimIds(),
}).strict();
export type SemanticFeedbackLoop = z.infer<typeof SemanticFeedbackLoopSchema>;

export const SemanticAnnotationSchema = z.object({
  id: semanticId(),
  entityId: semanticId(),
  text: z.string().trim().min(1).max(120),
  kind: z.enum(['qualifier', 'evidence', 'example', 'warning']),
  claimIds: claimIds(),
}).strict();
export type SemanticAnnotation = z.infer<typeof SemanticAnnotationSchema>;

export const SemanticSceneStateSchema = z.object({
  sceneId: semanticId(),
  entities: z.array(SemanticEntitySchema).max(128),
  relations: z.array(SemanticRelationSchema).max(256),
  selectedEntityIds: z.array(semanticId()).max(32),
  plots: z.array(SemanticPlotSchema).max(32),
  feedbackLoops: z.array(SemanticFeedbackLoopSchema).max(32),
  annotations: z.array(SemanticAnnotationSchema).max(128),
}).strict();
export type SemanticSceneState = z.infer<typeof SemanticSceneStateSchema>;

const common = {
  eventId: eventId(),
  beatId: semanticId(),
  claimIds: claimIds(),
  dependsOnEventIds: z.array(eventId()).max(32).refine((ids) => new Set(ids).size === ids.length, 'event dependencies must be unique'),
};
const opEntity = semanticId();

export const IntroduceSemanticOpSchema = z.object({ type: z.literal('introduce'), ...common, entity: SemanticEntitySchema }).strict();
export const FocusSemanticOpSchema = z.object({ type: z.literal('focus'), ...common, entityIds: z.array(opEntity).min(1).max(16) }).strict();
export const CompareSemanticOpSchema = z.object({ type: z.literal('compare'), ...common, entityIds: z.array(opEntity).min(2).max(12), dimension: z.string().trim().min(1).max(80), result: z.enum(['less', 'greater', 'equal', 'different', 'similar', 'related']) }).strict();
export const FlowSemanticOpSchema = z.object({ type: z.literal('flow'), ...common, entityId: opEntity, fromLocationId: semanticId(), toLocationId: semanticId(), mode: z.enum(['net', 'diffusion', 'active', 'passive', 'generic']) }).strict();
export const TransformSemanticOpSchema = z.object({ type: z.literal('transform'), ...common, entityId: opEntity, fromState: z.string().trim().min(1).max(160), toState: z.string().trim().min(1).max(160) }).strict();
export const MoveSemanticOpSchema = z.object({ type: z.literal('move'), ...common, entityId: opEntity, fromLocationId: semanticId(), toLocationId: semanticId() }).strict();
export const SeparateSemanticOpSchema = z.object({ type: z.literal('separate'), ...common, sourceEntityId: opEntity, results: z.array(SemanticEntitySchema).min(2).max(16) }).strict();
export const MergeSemanticOpSchema = z.object({ type: z.literal('merge'), ...common, entityIds: z.array(opEntity).min(2).max(16), result: SemanticEntitySchema }).strict();
export const UpdateQuantitySemanticOpSchema = z.object({ type: z.literal('update_quantity'), ...common, entityId: opEntity, fromValue: scalar(), toValue: scalar(), fromUnit: z.string().trim().min(1).max(24).optional(), unit: z.string().trim().min(1).max(24).optional() }).strict();
export const WeightSemanticOpSchema = z.object({ type: z.literal('weight'), ...common, relationId: semanticId(), fromValue: scalar().optional(), toValue: scalar() }).strict();
export const SelectSemanticOpSchema = z.object({ type: z.literal('select'), ...common, entityId: opEntity, reason: z.string().trim().min(1).max(120) }).strict();
export const FinalizeSemanticOpSchema = z.object({ type: z.literal('finalize'), ...common, entityId: opEntity }).strict();
export const PlotSemanticOpSchema = z.object({ type: z.literal('plot'), ...common, plot: SemanticPlotSchema }).strict();
export const MarkThresholdSemanticOpSchema = z.object({ type: z.literal('mark_threshold'), ...common, plotId: semanticId(), threshold: z.object({ id: semanticId(), value: z.number().finite(), label: z.string().trim().min(1).max(60), claimIds: claimIds() }).strict() }).strict();
export const CauseSemanticOpSchema = z.object({ type: z.literal('cause'), ...common, relation: SemanticRelationSchema }).strict();
export const FeedbackSemanticOpSchema = z.object({ type: z.literal('feedback'), ...common, loop: SemanticFeedbackLoopSchema }).strict();
export const AnnotateSemanticOpSchema = z.object({ type: z.literal('annotate'), ...common, annotation: SemanticAnnotationSchema }).strict();

/** Meaning-level changes only. No renderer objects, screen coordinates, paths, or timings are part of this IR. */
export const SemanticOpSchema = z.discriminatedUnion('type', [
  IntroduceSemanticOpSchema,
  FocusSemanticOpSchema,
  CompareSemanticOpSchema,
  FlowSemanticOpSchema,
  TransformSemanticOpSchema,
  MoveSemanticOpSchema,
  SeparateSemanticOpSchema,
  MergeSemanticOpSchema,
  UpdateQuantitySemanticOpSchema,
  WeightSemanticOpSchema,
  SelectSemanticOpSchema,
  FinalizeSemanticOpSchema,
  PlotSemanticOpSchema,
  MarkThresholdSemanticOpSchema,
  CauseSemanticOpSchema,
  FeedbackSemanticOpSchema,
  AnnotateSemanticOpSchema,
]);
export type SemanticOp = z.infer<typeof SemanticOpSchema>;

export interface SemanticIrProblem {
  path: string;
  message: string;
}
