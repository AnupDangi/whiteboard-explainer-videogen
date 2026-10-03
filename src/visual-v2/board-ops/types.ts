import { z } from 'zod';

/**
 * BoardOps V2 (V2 plan Phase 4). The model decides WHAT CHANGES on the board in semantic terms (add this, move that,
 * strike this, update that value, take one equation step); it never writes coordinates, sizes, paths or timings. Layout owns
 * geometry, the timeline owns time.
 */
export const REGION_IDS = ['full', 'left', 'center', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const KIT_NAMES = ['compartment', 'stack', 'queue', 'array', 'tree', 'graph', 'layered-stack', 'equation', 'axes-plot', 'cycle', 'comparison', 'weighted-links'] as const;
export type KitName = (typeof KIT_NAMES)[number];
/** Kits whose children are placed into slots (everything except the two that draw a single closed picture). */
export const CONTAINER_KITS: ReadonlySet<string> = new Set(KIT_NAMES.filter((kit) => kit !== 'equation' && kit !== 'axes-plot'));

export const PROVENANCE = ['source', 'derived', 'illustrative', 'metaphorical'] as const;
export const PERSISTENCE = ['beat', 'scene', 'lesson'] as const;
export const EMPHASIS = ['normal', 'highlight', 'dim', 'struck'] as const;

const elementId = () => z.string().min(1).max(48).regex(/^[A-Za-z0-9_.-]+$/, 'ids use letters, digits, _ . -');
const beatIdField = () => z.string().min(1).max(60).regex(/^[a-z0-9_.]+$/);
const scalar = () => z.union([z.string().max(60), z.number()]);
/** Explicit semantic ownership for every visual or factual edge. Labels are never used as a proxy for meaning. */
export const BoardBindingsSchema = z.object({ conceptIds: z.array(z.string().min(1).max(40)).max(12), claimIds: z.array(z.string().min(1).max(40)).max(12) }).strict();
const bindingFields = { bindings: BoardBindingsSchema.optional() };

export const PlacementSchema = z.object({
  region: z.enum(REGION_IDS),
  /** Element id of a container kit that holds this element. */
  container: elementId().optional(),
  /** Named sub-area inside the container (a compartment side, a comparison column); the kit defines the names. */
  zone: z.string().min(1).max(24).optional(),
  slot: z.union([z.enum(['top', 'bottom', 'start', 'end']), z.number().int().min(0).max(63)]).optional(),
}).strict();
export type Placement = z.infer<typeof PlacementSchema>;

const label = () => z.string().min(1).max(40);

/** A verbatim quote from one source span; required when an equation claims `source` provenance. */
export const SourceCitationSchema = z.object({ spanId: z.string().min(1).max(40), quote: z.string().min(6).max(240) }).strict();

export const EntitySpecSchema = z.object({ type: z.literal('entity'), conceptId: z.string().min(1).max(40), label: label(), provenance: z.enum(PROVENANCE), ...bindingFields }).strict();
export const KitSpecSchema = z.object({
  type: z.literal('kit'), kit: z.enum(KIT_NAMES), label: label().optional(),
  /** Kit parameters as JSON text, validated by the kit's own schema (kits/registry). Keeps the wire schema bounded. */
  paramsJson: z.string().max(2000), provenance: z.enum(PROVENANCE), evidence: SourceCitationSchema.optional(), ...bindingFields,
}).strict();
export const TokenSpecSchema = z.object({ type: z.literal('token'), text: z.string().min(1).max(24), provenance: z.enum(PROVENANCE), ...bindingFields }).strict();
export const TextSpecSchema = z.object({ type: z.literal('text'), text: z.string().min(1).max(60), role: z.enum(['title', 'label', 'note']), provenance: z.enum(PROVENANCE), ...bindingFields }).strict();
export const EquationSpecSchema = z.object({ type: z.literal('equation'), latex: z.string().min(1).max(160), provenance: z.enum(PROVENANCE), evidence: SourceCitationSchema.optional(), ...bindingFields }).strict();
export const ValueSpecSchema = z.object({ type: z.literal('value'), label: label(), value: scalar(), unit: z.string().max(12).optional(), provenance: z.enum(PROVENANCE), ...bindingFields }).strict();

export const ElementSpecSchema = z.union([EntitySpecSchema, KitSpecSchema, TokenSpecSchema, TextSpecSchema, EquationSpecSchema, ValueSpecSchema]);
export type ElementSpec = z.infer<typeof ElementSpecSchema>;

/** What the writer claims is true right after an op; the reducer checks it (a mismatch is a pointer problem). */
export const ExpectSchema = z.union([
  z.object({ kind: z.literal('exists'), target: elementId() }).strict(),
  z.object({ kind: z.literal('absent'), target: elementId() }).strict(),
  z.object({ kind: z.literal('contents'), container: elementId(), ids: z.array(elementId()).max(64) }).strict(),
  z.object({ kind: z.literal('value'), target: elementId(), value: scalar() }).strict(),
  z.object({ kind: z.literal('emphasis'), target: elementId(), emphasis: z.enum(EMPHASIS) }).strict(),
]);
export type Expect = z.infer<typeof ExpectSchema>;

const base = {
  opId: z.string().min(1).max(80), beatId: beatIdField(), expects: z.array(ExpectSchema).max(4).optional(),
  /** Which sentence (0-based) of the beat's narration this change belongs to; the timeline turns it into a moment, never the writer. */
  cue: z.number().int().min(0).max(3).optional(),
};
const part = z.object({ id: elementId(), element: ElementSpecSchema, at: PlacementSchema }).strict();

export const AddOpSchema = z.object({ op: z.literal('add'), ...base, id: elementId(), element: ElementSpecSchema, at: PlacementSchema, persistence: z.enum(PERSISTENCE).optional() }).strict();
export const ConnectOpSchema = z.object({ op: z.literal('connect'), ...base, id: elementId(), from: elementId(), to: elementId(), relation: z.string().min(1).max(30), label: label().optional(), weight: z.number().min(0).max(1).optional(), bindings: BoardBindingsSchema.optional() }).strict();
export const MoveOpSchema = z.object({ op: z.literal('move'), ...base, target: elementId(), to: PlacementSchema }).strict();
export const TransformOpSchema = z.object({ op: z.literal('transform'), ...base, target: elementId(), changes: z.array(z.object({ key: z.string().min(1).max(30), value: scalar() }).strict()).min(1).max(4) }).strict();
export const ReplaceOpSchema = z.object({ op: z.literal('replace'), ...base, target: elementId(), id: elementId(), element: ElementSpecSchema }).strict();
export const RemoveOpSchema = z.object({ op: z.literal('remove'), ...base, target: elementId() }).strict();
export const HighlightOpSchema = z.object({ op: z.literal('highlight'), ...base, target: elementId() }).strict();
export const DeemphasizeOpSchema = z.object({ op: z.literal('deemphasize'), ...base, target: elementId() }).strict();
export const StrikeOpSchema = z.object({ op: z.literal('strike'), ...base, target: elementId() }).strict();
export const UpdateValueOpSchema = z.object({ op: z.literal('updateValue'), ...base, target: elementId(), value: scalar() }).strict();
export const SplitOpSchema = z.object({ op: z.literal('split'), ...base, target: elementId(), into: z.array(part).min(2).max(6) }).strict();
export const MergeOpSchema = z.object({ op: z.literal('merge'), ...base, targets: z.array(elementId()).min(2).max(6), into: part }).strict();
export const EquationStepOpSchema = z.object({ op: z.literal('equationStep'), ...base, target: elementId(), latex: z.string().min(1).max(160), rule: z.string().min(1).max(80), evidence: SourceCitationSchema.optional() }).strict();
export const RevealRegionOpSchema = z.object({ op: z.literal('revealRegion'), ...base, region: z.enum(REGION_IDS) }).strict();
export const ClearRegionOpSchema = z.object({ op: z.literal('clearRegion'), ...base, region: z.enum(REGION_IDS) }).strict();

export const BoardOpSchema = z.discriminatedUnion('op', [
  AddOpSchema, ConnectOpSchema, MoveOpSchema, TransformOpSchema, ReplaceOpSchema, RemoveOpSchema, HighlightOpSchema, DeemphasizeOpSchema, StrikeOpSchema,
  UpdateValueOpSchema, SplitOpSchema, MergeOpSchema, EquationStepOpSchema, RevealRegionOpSchema, ClearRegionOpSchema,
]);
export type BoardOp = z.infer<typeof BoardOpSchema>;
export type AddOp = z.infer<typeof AddOpSchema>;

export const BoardOpsDraftSchema = z.object({ ops: z.array(BoardOpSchema).min(1).max(40) }).strict();
export type BoardOpsDraft = z.infer<typeof BoardOpsDraftSchema>;

/** How a scene starts relative to the board it inherits (V2 plan Phase 5). */
export const SceneTransitionSchema = z.object({
  mode: z.enum(['retain-all', 'retain-regions', 'clean']),
  regions: z.array(z.enum(REGION_IDS)).max(10).optional(),
  fadePrevious: z.boolean().optional(),
  camera: z.enum(REGION_IDS).optional(),
}).strict();
export type SceneTransition = z.infer<typeof SceneTransitionSchema>;
