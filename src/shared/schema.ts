import { z } from 'zod';
import { TEMPLATE_IDS } from '../layout/templates/catalog.js';
import type { SceneSpec } from './types.js';
import { MAX_ELEMENTS_PER_SCENE, MAX_LABEL_WORDS, MAX_TITLE_WORDS } from '../render/style.js';
import { RELATION_TYPES } from '../plan/schemas.js';
import { validateChemistryEvidence } from '../render/chemistry.js';

/**
 * Schema-level rejection gate. Every string that can end up rendered as text
 * (labels, titles, token text, matrix cells, formula source) is checked here
 * for raw markup / script content so a model can never smuggle SVG or code
 * onto the critical path (AGENTS.md #3, claude_pipeline.md hard-failure list).
 */
const NO_RAW_MARKUP = /^[^<>]*$/;
const noRawMarkup = (message = 'raw SVG/HTML/code is not permitted in scene text') =>
  z.string().regex(NO_RAW_MARKUP, message);
const codeSource = z.string()
  .min(1)
  .max(1024, 'code excerpt exceeds 1024 characters')
  .refine((source) => source.trim().length > 0, 'code excerpt must contain visible source text')
  .refine((source) => !/[\r\t\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(source), 'code excerpt must use LF line breaks, spaces for indentation, and printable characters')
  .refine((source) => {
    const lines = source.split('\n');
    return lines.length <= 14 && lines.every((line) => [...line].length <= 40);
  }, 'code excerpt is limited to 14 lines and 40 characters per line');

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const label = () =>
  noRawMarkup('label may not contain raw markup')
    .max(64)
    .refine((s) => wordCount(s) <= MAX_LABEL_WORDS, `label exceeds ${MAX_LABEL_WORDS} words`);

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

const ANCHOR_RE = /^(sceneStart|mention:[^\s:]+|after:[^\s:]+)$/;
export const AnchorSchema = z.string().regex(ANCHOR_RE, 'anchor must be sceneStart | mention:<id> | after:<id>');

export const PaletteTokenSchema = z.enum(['blue', 'yellow', 'green', 'orange', 'purple', 'red', 'grey', 'none']);
export const BadgeSchema = z.enum(['✓', '✗', '?', '!', '$', '⚠', '↑', '↓', '⏱', '🔒', '★', '+', '−']);
export const GlyphSchema = z.enum(['?', '!', '✓', '✗', '$', 'Σ']);
export const OperatorSymbolSchema = z.enum(['×', '+', '−', '÷', 'Σ', '∫', '=', '→', 'softmax']);
const NativeSourceLocationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pdf-page'), page: z.number().int().positive() }),
  z.object({ kind: z.literal('pptx-slide'), slide: z.number().int().positive() }),
  z.object({ kind: z.literal('docx-paragraph'), bodyBlock: z.number().int().positive(), paragraph: z.number().int().positive() }),
  z.object({ kind: z.literal('docx-table'), bodyBlock: z.number().int().positive(), table: z.number().int().positive() }),
  z.object({
    kind: z.literal('web-url'),
    // Local HTML uses file:<path> as its parser-authored locator; URL fetches still require HTTPS.
    url: z.string().url().refine((url) => url.startsWith('https://') || url.startsWith('file:'), 'source location must be HTTPS or a local file'),
    selector: z.string().min(1).optional(),
  }).strict(),
]);
const EvidenceReferenceSchema = z.object({
  sourceId: z.string().min(1),
  spanId: z.string().min(1),
  startChar: z.number().int().nonnegative(),
  endChar: z.number().int().positive(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  quote: z.string().min(1).max(600),
  sourceLocation: NativeSourceLocationSchema.optional(),
}).strict().refine((ref) => ref.endChar > ref.startChar && ref.endLine >= ref.startLine, 'invalid source evidence range');
const evidenceRefs = z.array(EvidenceReferenceSchema).min(1).max(6).optional();
const chemistryAtom = z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/), element: z.enum(['H', 'C', 'N', 'O', 'F', 'Cl']) }).strict();
const chemistryBond = z.object({ from: z.string().min(1), to: z.string().min(1), order: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict();
export const MoleculeGraphSchema = z.object({ atoms: z.array(chemistryAtom).min(2).max(12), bonds: z.array(chemistryBond).min(1).max(11) }).strict();
const reactionSpecies = z.object({ coefficient: z.number().int().min(1).max(8), molecule: MoleculeGraphSchema }).strict();
export const ReactionGraphSchema = z.object({ reactants: z.array(reactionSpecies).min(1).max(3), products: z.array(reactionSpecies).min(1).max(3) }).strict();
export const StructureNotationSchema = z.string().min(7).max(300);
const origin = z.enum(['illustrative-example', 'fixture']).optional();

const elementBase = {
  id: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, 'element id must be a plain token, not markup/coordinates'),
  slot: z.string().min(1).optional(),
  anchor: AnchorSchema,
  label: label().optional(),
  fill: PaletteTokenSchema.optional(),
  conceptIds: z.array(z.string().min(1)).min(1).max(4).optional(),
  evidenceRefs,
  origin,
  iconBasis: z.enum(['retrieval', 'metaphor']).optional(),
  semanticRole: z.string().min(1).max(48).optional(),
  visualStrategy: z.enum(['diagram', 'semantic-core', 'literal', 'metaphor', 'retrieval', 'topology', 'labelled', 'text']).optional(),
};

// Every branch is `.strict()`: a model that tries to emit x/y/w/h/coordinates,
// raw `svg`/`path`/`d` fields, or any other undeclared key is rejected at the
// schema boundary (satisfies "coordinates before layout" hard rejection).
const ElementSchema = z.discriminatedUnion('prim', [
  z.object({ ...elementBase, prim: z.literal('box'), text: noRawMarkup().max(80).optional(), glyph: GlyphSchema.optional() }).strict(),
  z.object({ ...elementBase, prim: z.literal('pill'), text: noRawMarkup().max(40) }).strict(),
  z
    .object({
      ...elementBase,
      prim: z.literal('tokenStrip'),
      tokens: z.array(noRawMarkup().max(24)).min(1).max(12),
      highlight: z.array(z.number().int().nonnegative()).optional(),
    })
    .strict(),
  z.object({ ...elementBase, prim: z.literal('operator'), symbol: OperatorSymbolSchema }).strict(),
  z
    .object({
      ...elementBase,
      prim: z.literal('meter'),
      values: z.array(z.number().min(0).max(1)).min(1).max(8),
      labels: z.array(noRawMarkup().max(24)).optional(),
    })
    .strict(),
  z
    .object({ ...elementBase, prim: z.literal('matrix'), rows: z.array(z.array(noRawMarkup().max(16)).min(1).max(6)).min(1).max(6) })
    .strict(),
  // LaTeX may legitimately contain \, {, }, ^, _, but never angle brackets (no HTML/SVG smuggling via "latex").
  z
    .object({
      ...elementBase,
      prim: z.literal('formula'),
      latex: noRawMarkup().min(1).max(200).optional(),
      parts: z.array(z.object({ tex: noRawMarkup().min(1).max(120), anchor: AnchorSchema.optional() }).strict()).min(1).max(8).optional(),
    })
    .strict(),
  z
    .object({
      ...elementBase,
      prim: z.literal('plot'),
      fn: z.enum(['linear', 'quadratic', 'cubic', 'sine', 'exp', 'log', 'normal']),
      params: z.array(z.number().finite()).min(2).max(4),
      domain: z.tuple([z.number().finite(), z.number().finite()]),
      markers: z.array(z.object({ x: z.number().finite(), label: label().optional() }).strict()).max(6).optional(),
      tangentAt: z.number().finite().optional(),
      tangentAnchor: AnchorSchema.optional(),
      trajectory: z.array(z.number().finite()).min(2).max(8).optional(),
      stepsAnchor: AnchorSchema.optional(),
      riseRun: z.tuple([z.number().finite(), z.number().finite()]).optional(),
      riseRunAnchor: AnchorSchema.optional(),
      xLabel: label().optional(),
      yLabel: label().optional(),
    })
    .strict(),
  z
    .object({
      ...elementBase,
      prim: z.literal('numberLine'),
      min: z.number().finite(),
      max: z.number().finite(),
      ticks: z.number().int().min(2).max(20),
      points: z.array(z.object({ x: z.number().finite(), label: label().optional() }).strict()).max(6).optional(),
      interval: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    })
    .strict(),
  z
    .object({
      ...elementBase,
      prim: z.literal('shape'),
      kind: z.enum(['rightTriangle', 'triangle', 'square', 'rectangle', 'circle']),
      sideLabels: z.array(noRawMarkup().max(16)).max(3).optional(),
      text: noRawMarkup().max(24).optional(),
    })
    .strict(),
  z
    .object({
      ...elementBase,
      prim: z.literal('container'),
      children: z.array(z.string().min(1)).min(1).max(9),
      style: z.enum(['solid', 'dashed']),
    })
    .strict(),
  z.object({ ...elementBase, prim: z.literal('cylinder'), text: noRawMarkup().max(40).optional() }).strict(),
  z.object({ ...elementBase, prim: z.literal('stack'), count: z.number().int().min(1).max(12), text: noRawMarkup().max(40).optional() }).strict(),
  z
    .object({
      ...elementBase,
      prim: z.literal('axis'),
      kind: z.enum(['line', 'curve', 'bars']),
      points: z.array(z.tuple([z.number(), z.number()])).max(64).optional(),
    })
    .strict(),
  z
    .object({ ...elementBase, prim: z.literal('hill'), peaks: z.array(z.number()).min(1).max(16), marker: z.number().optional() })
    .strict(),
  // Object concepts must be plain catalog-lookup keys, never asset ids / paths chosen by the model.
  z
    .object({
      ...elementBase,
      prim: z.literal('object'),
      concept: z.string().min(1).max(48).regex(/^[a-z0-9_ -]+$/i, 'concept must be a plain noun phrase, not an asset id/path'),
      badge: BadgeSchema.optional(),
      count: z.number().int().min(1).max(12).optional(),
    })
    .strict(),
  z.object({ ...elementBase, prim: z.literal('text'), text: noRawMarkup().max(200), size: z.enum(['title', 'body', 'note']) }).strict(),
  z.object({
    ...elementBase,
    prim: z.literal('code'),
    language: z.enum(['python', 'javascript', 'typescript', 'sql', 'pseudocode']),
    source: codeSource,
  }).strict(),
  z.object({ ...elementBase, evidenceRefs: z.array(EvidenceReferenceSchema).min(1).max(6), prim: z.literal('molecule'), molecule: MoleculeGraphSchema, structureNotation: StructureNotationSchema }).strict(),
  z.object({ ...elementBase, evidenceRefs: z.array(EvidenceReferenceSchema).min(1).max(6), prim: z.literal('reaction'), reaction: ReactionGraphSchema, structureNotation: StructureNotationSchema }).strict(),
]);

const EdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    label: noRawMarkup().max(40).optional(),
    style: z.enum(['solid', 'dashed']).optional(),
    head: z.enum(['forward', 'none']).optional(),
    anchor: AnchorSchema.optional(),
    evidenceRefs,
    origin,
    factualRelation: z.object({
      fromConceptId: z.string().min(1),
      toConceptId: z.string().min(1),
      type: z.enum(RELATION_TYPES),
      evidenceRefs: z.array(EvidenceReferenceSchema).min(1).max(6),
    }).strict().optional(),
  })
  .strict();

const BoardIntentSchema = z.object({
  schemaVersion: z.literal('typed-board-intent/v4-layout-recipes'),
  layout: z.enum(['flow', 'fan_out', 'convergence', 'list', 'compare', 'cycle', 'hub', 'hierarchy_tree', 'decision_tree', 'timeline', 'rule_exception', 'claim_evidence']),
  visualKind: z.enum(['process', 'plain', 'comparison', 'worked-example', 'formula', 'code', 'molecule', 'reaction', 'plot', 'matrix', 'number-line', 'array', 'geometry']),
  roles: z.array(z.object({ elementId: z.string().min(1), role: z.enum(['input', 'process', 'output', 'item', 'attribute', 'root', 'branch', 'leaf', 'outcome', 'event', 'rule', 'exception', 'consequence', 'claim', 'evidence']) }).strict()).max(7),
  requiredConceptIds: z.array(z.string().min(1)).max(8),
  requiredRelations: z.array(z.object({
    from: z.string().min(1), to: z.string().min(1), type: z.enum(RELATION_TYPES), evidenceRefs: z.array(EvidenceReferenceSchema).min(1).max(6),
  }).strict()).max(24),
  visualIntents: z.array(z.object({
    claimId: z.string().min(1),
    strategy: z.enum(['literal', 'process', 'comparison', 'quantitative', 'labelled-diagram']),
    targets: z.array(z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('element'), elementId: z.string().min(1), evidenceSpanIds: z.array(z.string().min(1)).min(1).max(3) }).strict(),
      z.object({ kind: z.literal('edge'), fromElementId: z.string().min(1), toElementId: z.string().min(1), relationType: z.enum(RELATION_TYPES), evidenceSpanIds: z.array(z.string().min(1)).min(1).max(3) }).strict(),
    ])).min(1).max(12),
  }).strict()).max(8),
}).strict();

const TemplateIdSchema = z.enum(TEMPLATE_IDS);

export const SceneSpecSchema = z
  .object({
    schemaVersion: z.literal('claude-scene-spec/v1'),
    sceneId: z.string().min(1),
    // Titles are not labels: the spec's <=4-word rule is for element labels (01 §3.3), and the reference
    // titles run to six words ("EVERY TASK HAS AN INTELLIGENCE THRESHOLD"). Keep them short, not truncated.
    title: noRawMarkup('title may not contain raw markup')
      .min(1)
      .max(60)
      .refine((s) => wordCount(s) <= MAX_TITLE_WORDS, `title exceeds ${MAX_TITLE_WORDS} words`),
    template: TemplateIdSchema,
    elements: z.array(ElementSchema).min(1).max(MAX_ELEMENTS_PER_SCENE),
    edges: z.array(EdgeSchema).max(24),
    focus: z.array(z.string()).optional(),
    carryOver: z.array(z.string()).optional(),
    titleConceptIds: z.array(z.string().min(1)).min(1).max(4).optional(),
    titleEvidenceRefs: evidenceRefs,
    titleOrigin: origin,
    boardIntent: BoardIntentSchema.optional(),
  })
  .strict();

export interface SceneSpecStructuralIssue {
  code:
    | 'dangling-id'
    | 'anchor-cycle'
    | 'invalid-anchor-target'
    | 'unresolved-object-candidate'
    | 'duplicate-element-id'
    | 'invalid-math'
    | 'invalid-chemistry';
  message: string;
}

/**
 * Structural checks zod cannot express as a pure shape schema: id references
 * must resolve, `after:*` anchors must form a DAG, and (when a catalog is
 * supplied) every `object` element's concept must have at least one
 * admissible candidate — otherwise the model is inventing an unresolvable
 * concept rather than letting the resolution ladder's rung-4 text fallback
 * take over via a plain box/text primitive.
 */
export function validateSceneSpecStructure(
  spec: Pick<SceneSpec, 'elements' | 'edges' | 'focus' | 'carryOver'>,
  opts?: { knownCatalogConcepts?: Set<string> },
): SceneSpecStructuralIssue[] {
  const issues: SceneSpecStructuralIssue[] = [];
  const ids = new Set<string>();
  for (const el of spec.elements) {
    if (ids.has(el.id)) issues.push({ code: 'duplicate-element-id', message: `duplicate element id ${el.id}` });
    ids.add(el.id);
  }
  const resolvesTo = (ref: string) => ids.has(ref);
  for (const el of spec.elements) {
    if (el.prim === 'container') {
      for (const child of el.children) if (!resolvesTo(child)) issues.push({ code: 'dangling-id', message: `container ${el.id} references unknown child ${child}` });
    }
  }
  for (const edge of spec.edges) {
    if (!resolvesTo(edge.from)) issues.push({ code: 'dangling-id', message: `edge references unknown source ${edge.from}` });
    if (!resolvesTo(edge.to)) issues.push({ code: 'dangling-id', message: `edge references unknown target ${edge.to}` });
  }
  for (const ref of [...(spec.focus ?? []), ...(spec.carryOver ?? [])]) {
    if (!resolvesTo(ref)) issues.push({ code: 'dangling-id', message: `scene references unknown element ${ref}` });
  }

  // after:<id> must reference another element in this scene (or be a carry-over
  // id, which is legal — carried elements exist before the scene begins) and
  // the after-graph restricted to in-scene ids must be acyclic.
  const carry = new Set(spec.carryOver ?? []);
  const afterEdges = new Map<string, string>();
  for (const el of spec.elements) {
    if (el.anchor.startsWith('after:')) {
      const target = el.anchor.slice('after:'.length);
      if (!resolvesTo(target) && !carry.has(target)) issues.push({ code: 'invalid-anchor-target', message: `${el.id} anchors after unknown element ${target}` });
      else if (resolvesTo(target)) afterEdges.set(el.id, target);
    }
    // Formula term anchors: after:* must name an element; they never feed back into the element DAG
    // (a term is revealed after its formula exists, so they cannot create a cycle).
    for (const sub of subAnchors(el)) {
      if (sub.startsWith('after:') && !resolvesTo(sub.slice('after:'.length))) {
        issues.push({ code: 'invalid-anchor-target', message: `${el.id} sub-reveal anchors after unknown element ${sub.slice('after:'.length)}` });
      }
    }
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const visit = (node: string): boolean => {
    color.set(node, GRAY);
    stack.push(node);
    const next = afterEdges.get(node);
    if (next) {
      const state = color.get(next) ?? WHITE;
      if (state === GRAY) {
        issues.push({ code: 'anchor-cycle', message: `after:* cycle detected: ${[...stack, next].join(' -> ')}` });
        return true;
      }
      if (state === WHITE && visit(next)) return true;
    }
    color.set(node, BLACK);
    stack.pop();
    return false;
  };
  for (const el of spec.elements) if ((color.get(el.id) ?? WHITE) === WHITE) visit(el.id);

  for (const el of spec.elements) issues.push(...mathIssues(el));
  for (const el of spec.elements) {
    if (el.prim !== 'molecule' && el.prim !== 'reaction') continue;
    try {
      validateChemistryEvidence(el.prim, el.prim === 'molecule' ? el.molecule : el.reaction, el.structureNotation, el.evidenceRefs);
    } catch (error) {
      issues.push({ code: 'invalid-chemistry', message: `${el.id}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  if (opts?.knownCatalogConcepts) {
    for (const el of spec.elements) {
      if (el.prim === 'object' && !opts.knownCatalogConcepts.has(el.concept.toLowerCase())) {
        issues.push({ code: 'unresolved-object-candidate', message: `object concept "${el.concept}" has no catalog candidate; planner must fall back to box/text` });
      }
    }
  }
  return issues;
}

/** Anchors of an element's sub-reveals (formula parts, plot tangent/steps/rise-run). */
function subAnchors(el: SceneSpec['elements'][number]): string[] {
  if (el.prim === 'formula') return (el.parts ?? []).flatMap((p) => (p.anchor ? [p.anchor] : []));
  if (el.prim === 'plot') return [el.tangentAnchor, el.stepsAnchor, el.riseRunAnchor].filter((a): a is NonNullable<typeof a> => Boolean(a));
  return [];
}

const PLOT_ARITY: Record<string, number> = { linear: 2, quadratic: 3, cubic: 4, sine: 4, exp: 3, log: 3, normal: 3 };

/** Math element checks zod's shape schema cannot express (domain order, arity, in-domain positions). */
function mathIssues(el: SceneSpec['elements'][number]): SceneSpecStructuralIssue[] {
  const bad = (message: string): SceneSpecStructuralIssue => ({ code: 'invalid-math', message: `${el.id}: ${message}` });
  const out: SceneSpecStructuralIssue[] = [];
  if (el.prim === 'formula') {
    if ((el.latex === undefined) === (el.parts === undefined)) out.push(bad('formula needs exactly one of "latex" or "parts"'));
  }
  if (el.prim === 'plot') {
    const [a, b] = el.domain;
    if (!(a < b)) out.push(bad(`domain [${a}, ${b}] must be increasing`));
    if (el.params.length !== PLOT_ARITY[el.fn]) out.push(bad(`${el.fn} takes ${PLOT_ARITY[el.fn]} params, got ${el.params.length}`));
    if (el.fn === 'log') {
      const multiplier = el.params[1] ?? 0;
      const argumentPositiveAcrossDomain = multiplier > 0 ? a > 0 : multiplier < 0 ? b < 0 : false;
      if (!argumentPositiveAcrossDomain) out.push(bad(`log plot requires ${multiplier} * x > 0 across domain [${a}, ${b}]`));
    }
    if (el.fn === 'normal' && !((el.params[2] ?? 0) > 0)) out.push(bad('normal plot needs sigma > 0'));
    const xs = [...(el.markers ?? []).map((m) => m.x), ...(el.trajectory ?? []), ...(el.riseRun ?? []), ...(el.tangentAt !== undefined ? [el.tangentAt] : [])];
    if (el.riseRun && !(el.riseRun[0] < el.riseRun[1])) out.push(bad('riseRun must be [x1, x2] with x1 < x2'));
    for (const x of xs) if (x < a || x > b) out.push(bad(`x=${x} lies outside the domain [${a}, ${b}]`));
  }
  if (el.prim === 'numberLine') {
    if (!(el.min < el.max)) out.push(bad(`numberLine min ${el.min} must be < max ${el.max}`));
    for (const p of el.points ?? []) if (p.x < el.min || p.x > el.max) out.push(bad(`point ${p.x} outside [${el.min}, ${el.max}]`));
    if (el.interval && !(el.interval[0] < el.interval[1])) out.push(bad('interval must be increasing'));
  }
  return out;
}


/**
 * zod's static inference widens regex-validated strings (e.g. `anchor`) back
 * to `string`, even though the regex enforces exactly the `Anchor` template
 * literal shape at runtime. This wrapper re-asserts the precise `SceneSpec`
 * type (from types.ts, the single source of truth for the Scene DSL) after
 * successful runtime validation, instead of scattering `as unknown as`
 * casts across every call site.
 */
export type SceneSpecParseResult = { success: true; data: SceneSpec } | { success: false; error: z.ZodError };

export function safeParseSceneSpec(value: unknown): SceneSpecParseResult {
  const result = SceneSpecSchema.safeParse(value);
  if (!result.success) return { success: false, error: result.error };
  const chemistryIssues = validateSceneSpecStructure(result.data as SceneSpec).filter((issue) => issue.code === 'invalid-chemistry');
  if (chemistryIssues.length) return { success: false, error: new z.ZodError(chemistryIssues.map((issue) => ({ code: 'custom' as const, path: ['elements'], message: issue.message }))) };
  return { success: true, data: result.data as unknown as SceneSpec };
}
