import type { TemplateId } from '../types.js';
import type { BoardLayout } from '../planner/board.js';

/**
 * VSR v1 — visual-semantic resolution, domain-general.
 *
 * Maps one micro-claim (scene heading plus narration) to a semantic
 * structure and a representation rung. Every cue below names a generic
 * role — actor, action, count, boundary, change — never a lesson topic,
 * so the same table serves any subject without edits.
 *
 * Representation ladder, checked in order:
 *   literal (a catalog name occurs in the claim)
 *   -> metaphor (a generic role cue matches a catalog asset)
 *   -> state (the structure is a condition or limit)
 *   -> topology (the structure links things)
 *   -> labeledPrimitive (abstract claim with backing material)
 *   -> text (short claim carried as written words, capped)
 */
export type SemanticStructure =
  | 'comparison'
  | 'cause'
  | 'transformation'
  | 'constraint'
  | 'tradeoff'
  | 'sequence'
  | 'hierarchy'
  | 'selection'
  | 'feedback'
  | 'accumulation'
  | 'threshold'
  | 'exception';

export type Representation =
  | 'literal'
  | 'metaphor'
  | 'state'
  | 'topology'
  | 'labeledPrimitive'
  | 'text';

/** Ladder order, weakest fallback last. */
export const REPRESENTATION_LADDER: readonly Representation[] = [
  'literal',
  'metaphor',
  'state',
  'topology',
  'labeledPrimitive',
  'text',
];

/** A text-rung label never carries more than this many words. */
export const TEXT_MAX_WORDS = 8;

/** Cap a label at `maxWords` words (default {@link TEXT_MAX_WORDS}). */
export function capTextWords(text: string, maxWords: number = TEXT_MAX_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, Math.max(0, Math.floor(maxWords))).join(' ');
}

/** Generic role cues per structure: counts, boundaries, changes, orderings. */
const STRUCTURE_CUES: Record<SemanticStructure, readonly string[]> = {
  comparison: ['compare', 'compares', 'compared', 'versus', 'vs', 'differ', 'differs', 'contrast', 'than', 'between', 'either', 'alternative'],
  threshold: ['threshold', 'exceed', 'exceeds', 'cross', 'crosses', 'tipping'],
  tradeoff: ['tradeoff', 'trade', 'cost', 'costs', 'balance', 'sacrifice', 'compromise'],
  exception: ['exception', 'except', 'unless', 'however', 'surprise', 'surprises', 'missing', 'lack'],
  feedback: ['feedback', 'loop', 'loops', 'repeat', 'repeats', 'cycle', 'cycles', 'return', 'returns', 'reinforce'],
  hierarchy: ['layer', 'layers', 'stack', 'stacked', 'level', 'levels', 'contain', 'contains', 'above', 'below', 'nest', 'nests'],
  selection: ['choose', 'chooses', 'select', 'selects', 'pick', 'picks', 'decide', 'decides', 'option', 'options'],
  constraint: ['limit', 'limits', 'restrict', 'restricts', 'bound', 'bounds', 'only', 'must', 'constrain', 'require', 'requires', 'never'],
  accumulation: ['accumulate', 'accumulates', 'gather', 'gathers', 'collect', 'collects', 'combine', 'combines', 'merge', 'merges', 'blend', 'blends', 'sum', 'total', 'add', 'adds'],
  transformation: ['transform', 'transforms', 'convert', 'converts', 'become', 'becomes'],
  cause: ['cause', 'causes', 'because', 'lead', 'leads', 'produce', 'produces', 'create', 'creates', 'make', 'makes', 'trigger', 'triggers', 'result', 'results', 'effect', 'effects'],
  sequence: ['step', 'steps', 'then', 'next', 'first', 'second', 'third', 'sequence', 'order', 'orders', 'stage', 'stages', 'series'],
};

/** Distinctive structures win over common verbs when several cues match. */
const STRUCTURE_PRIORITY: readonly SemanticStructure[] = [
  'comparison',
  'threshold',
  'tradeoff',
  'exception',
  'feedback',
  'hierarchy',
  'selection',
  'constraint',
  'accumulation',
  'transformation',
  'cause',
  'sequence',
];

/**
 * Generic role -> catalog asset table (~20 entries). Each asset is a plain
 * visual role a teacher could sketch (a gate for permission, a scale for
 * weighing options); matching needs the asset present in the catalog, so
 * this table suggests shapes without ever naming lesson content.
 */
const ROLE_METAPHORS: readonly { asset: string; cues: readonly string[] }[] = [
  { asset: 'question', cues: ['why', 'question'] },
  { asset: 'boundary', cues: ['boundary', 'border'] },
  { asset: 'pipe', cues: ['pipe', 'channel'] },
  { asset: 'stop', cues: ['stop', 'halt'] },
  { asset: 'check', cues: ['check', 'verify'] },
  { asset: 'container', cues: ['container', 'store'] },
  { asset: 'loop', cues: ['loop', 'cycle'] },
  { asset: 'scale', cues: ['balance', 'weigh'] },
  { asset: 'bridge', cues: ['bridge', 'connect'] },
  { asset: 'chain', cues: ['chain', 'sequence'] },
  { asset: 'lens', cues: ['lens', 'focus'] },
  { asset: 'gate', cues: ['gate', 'permit'] },
  { asset: 'weight', cues: ['weight', 'heavy'] },
  { asset: 'path', cues: ['path', 'route'] },
  { asset: 'fork', cues: ['fork', 'branch'] },
  { asset: 'hub', cues: ['hub', 'core'] },
  { asset: 'arrow', cues: ['arrow', 'point'] },
  { asset: 'meter', cues: ['meter', 'amount'] },
  { asset: 'key', cues: ['key', 'unlock'] },
  { asset: 'filter', cues: ['filter', 'sift'] },
];

/** Structures that describe a condition or limit: drawn as a state. */
export const STATE_STRUCTURES: readonly SemanticStructure[] = ['constraint', 'threshold', 'exception', 'selection'];

/** Structures that link things: drawn as a topology. */
export const TOPOLOGY_STRUCTURES: readonly SemanticStructure[] = [
  'comparison',
  'cause',
  'transformation',
  'tradeoff',
  'sequence',
  'hierarchy',
  'feedback',
  'accumulation',
];

/**
 * Canonical topology per structure. Fan direction (one source spreading vs
 * many inputs joining) is refined at the call site, which sees the relation
 * graph; hierarchy maps to the layered stack here, and the board fallback
 * projects it onto the nearest board layout (see {@link boardLayoutForStructure}).
 */
export const STRUCTURE_TEMPLATE: Record<SemanticStructure, TemplateId> = {
  comparison: 'compare_2',
  cause: 'convergence',
  transformation: 'chain',
  constraint: 'threshold',
  tradeoff: 'weighted_blend',
  sequence: 'chain',
  hierarchy: 'layered_stack',
  selection: 'list_icon',
  feedback: 'cycle',
  accumulation: 'convergence',
  threshold: 'threshold',
  exception: 'list_icon',
};

export interface VisualSemantics {
  structure: SemanticStructure;
  representation: Representation;
  rationale: string;
}

const tokenize = (text: string): string[] =>
  text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

function detectStructure(tokens: Set<string>): { structure: SemanticStructure; matched: boolean } {
  for (const structure of STRUCTURE_PRIORITY) {
    if (STRUCTURE_CUES[structure].some((cue) => tokens.has(cue))) return { structure, matched: true };
  }
  // No role cue: keep narration order as the structure; the representation
  // rung below still falls back to a labelled box or short text.
  return { structure: 'sequence', matched: false };
}

/**
 * Pure function: claim + catalog names + backing material -> structure and
 * representation rung. No lesson vocabulary anywhere in the decision.
 */
export function resolveRepresentation(
  claim: string,
  availableCatalogNames: string[],
  evidence?: string,
): VisualSemantics {
  const text = (claim ?? '').trim();
  const tokens = new Set(tokenize(text));
  const catalog = new Set(
    (availableCatalogNames ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  const { structure, matched } = detectStructure(tokens);

  for (const name of catalog) {
    if (tokens.has(name)) {
      return { structure, representation: 'literal', rationale: `catalog names the pictured thing directly (${name})` };
    }
  }
  for (const entry of ROLE_METAPHORS) {
    if (entry.cues.some((cue) => tokens.has(cue)) && catalog.has(entry.asset)) {
      return { structure, representation: 'metaphor', rationale: `generic role reads as ${entry.asset}` };
    }
  }
  if (matched && STATE_STRUCTURES.includes(structure)) {
    return { structure, representation: 'state', rationale: `${structure} describes a condition to hold` };
  }
  if (matched && TOPOLOGY_STRUCTURES.includes(structure)) {
    return { structure, representation: 'topology', rationale: `${structure} links things to draw` };
  }
  const words = text.split(/\s+/).filter(Boolean);
  const backed = (evidence ?? '').trim().length > 0;
  if (backed || words.length > TEXT_MAX_WORDS) {
    return { structure, representation: 'labeledPrimitive', rationale: 'abstract claim needs a labelled box' };
  }
  return {
    structure,
    representation: 'text',
    rationale: `short claim fits as written text (${Math.min(words.length, TEXT_MAX_WORDS)} of ${TEXT_MAX_WORDS} words)`,
  };
}

export interface BoardRelationShape {
  fanOut: number;
  fanIn: number;
  edges: number;
}

/**
 * Project a semantic structure onto the board planner's layout vocabulary.
 * Spec mapping: comparison -> compare, sequence -> flow (chain), feedback ->
 * cycle, hierarchy -> hub (nearest board layout to the layered stack, which
 * has no board-layout counterpart; it groups one centre with its parts),
 * fan relations -> fan_out / convergence, default list. Cause and
 * transformation flows stay flows when the relation graph is a linear chain.
 */
export function boardLayoutForStructure(
  structure: SemanticStructure,
  shape: BoardRelationShape,
  nodeCount: number,
): BoardLayout {
  if (structure === 'comparison' && nodeCount >= 2 && nodeCount <= 3) return 'compare';
  if (structure === 'feedback' && nodeCount >= 3) return 'cycle';
  if (structure === 'sequence' && nodeCount >= 2) return 'flow';
  if (shape.fanOut >= 2 && nodeCount >= 3 && shape.fanOut >= shape.fanIn) return 'fan_out';
  if (shape.fanIn >= 2 && nodeCount >= 3) return 'convergence';
  if (
    (structure === 'cause' || structure === 'transformation') &&
    shape.edges > 0 &&
    shape.fanOut <= 1 &&
    shape.fanIn <= 1
  ) {
    return 'flow';
  }
  if (structure === 'hierarchy' && nodeCount >= 3) return 'hub';
  return 'list';
}
