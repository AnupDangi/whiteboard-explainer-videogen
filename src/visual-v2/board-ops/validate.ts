import type { ValidatorProblem } from '../../llm/structuredCall.js';
import type { BoardOp, ElementSpec, Expect, Placement } from './types.js';
import { KIT_REGISTRY, parseKitParams } from '../kits/registry.js';
import { verifyEquation, verifyStep } from '../provenance/verify.js';
import { createdBy, dependenciesOf } from './deps.js';
import { sourceFormulaProblem, type Grounding } from '../provenance/ground.js';
import type { BoardState, Condition } from '../board-state/types.js';
import { BoardOpError } from '../board-state/types.js';
import { applyOpAfter, containerContents, duplicateId } from '../board-state/reducer.js';

/** Declared pre/postconditions of an op, derived from its shape (V2 plan Phase 4: every op carries them). */
export function derivePrePost(op: BoardOp): { pre: Condition[]; post: Condition[] } {
  switch (op.op) {
    case 'add': return {
      pre: [{ kind: 'absentEver', id: op.id }, ...(op.at.container ? [{ kind: 'container', id: op.at.container } as Condition] : [])],
      post: [{ kind: 'exists', id: op.id }, ...(op.at.container ? [{ kind: 'inContainer', id: op.id, container: op.at.container } as Condition] : [])],
    };
    case 'connect': return { pre: [{ kind: 'absentEver', id: op.id }, { kind: 'exists', id: op.from }, { kind: 'exists', id: op.to }], post: [] };
    case 'move': return { pre: [{ kind: 'exists', id: op.target }, ...(op.to.container ? [{ kind: 'container', id: op.to.container } as Condition] : [])], post: op.to.container ? [{ kind: 'inContainer', id: op.target, container: op.to.container }] : [] };
    case 'transform': case 'highlight': case 'deemphasize': case 'strike': return { pre: [{ kind: 'exists', id: op.target }], post: [{ kind: 'exists', id: op.target }] };
    case 'replace': return { pre: [{ kind: 'exists', id: op.target }, { kind: 'absentEver', id: op.id }], post: [{ kind: 'removed', id: op.target }, { kind: 'exists', id: op.id }] };
    case 'remove': return { pre: [{ kind: 'exists', id: op.target }], post: [{ kind: 'removed', id: op.target }] };
    case 'updateValue': return { pre: [{ kind: 'isValue', id: op.target }], post: [{ kind: 'isValue', id: op.target }] };
    case 'split': return { pre: [{ kind: 'exists', id: op.target }, ...op.into.map((part) => ({ kind: 'absentEver', id: part.id }) as Condition)], post: [{ kind: 'removed', id: op.target }, ...op.into.map((part) => ({ kind: 'exists', id: part.id }) as Condition)] };
    case 'merge': return { pre: [...op.targets.map((id) => ({ kind: 'exists', id }) as Condition), { kind: 'absentEver', id: op.into.id }], post: [...op.targets.map((id) => ({ kind: 'removed', id }) as Condition), { kind: 'exists', id: op.into.id }] };
    case 'equationStep': return { pre: [{ kind: 'isEquation', id: op.target }], post: [{ kind: 'isEquation', id: op.target }] };
    case 'revealRegion': case 'clearRegion': return { pre: [], post: [] };
  }
}

function unmet(expect: Expect, state: BoardState): string | undefined {
  const live = (id: string) => state.elements[id] !== undefined && state.elements[id]!.lifecycle.removedAtBeat === undefined;
  switch (expect.kind) {
    case 'exists': return live(expect.target) ? undefined : `${expect.target} should exist but does not`;
    case 'absent': return live(expect.target) ? `${expect.target} should be gone but is still on the board` : undefined;
    case 'contents': { const actual = containerContents(state, expect.container); return actual.join(',') === expect.ids.join(',') ? undefined : `${expect.container} holds ${actual.join(', ') || '(nothing)'} but the op expects ${expect.ids.join(', ') || '(nothing)'}`; }
    case 'value': return live(expect.target) && state.elements[expect.target]!.value === expect.value ? undefined : `${expect.target} has value ${String(state.elements[expect.target]?.value)} but the op expects ${String(expect.value)}`;
    case 'emphasis': return live(expect.target) && state.elements[expect.target]!.emphasis === expect.emphasis ? undefined : `${expect.target} is ${state.elements[expect.target]?.emphasis ?? 'missing'} but the op expects ${expect.emphasis}`;
  }
}

function kitProblems(spec: ElementSpec, path: string): ValidatorProblem[] {
  if (spec.type !== 'kit') return [];
  const parsed = parseKitParams(spec.kit, spec.paramsJson);
  return parsed.ok ? [] : [{ path: `${path}/paramsJson`, message: parsed.error }];
}

/** A placement inside a container must name a zone exactly when the container's kit has zones, and one of its zones. */
function zoneProblems(state: BoardState, at: Placement, path: string): ValidatorProblem[] {
  if (!at.container) return at.zone ? [{ path: `${path}/zone`, message: 'a zone only applies inside a container' }] : [];
  const container = state.elements[at.container];
  if (!container || container.spec.type !== 'kit') return [];
  const parsed = parseKitParams(container.spec.kit, container.spec.paramsJson);
  if (!parsed.ok) return [];
  const zones: string[] = KIT_REGISTRY[container.spec.kit].zones(parsed.value);
  if (zones.length === 0) return at.zone ? [{ path: `${path}/zone`, message: `${at.container} has no zones; remove the zone` }] : [];
  if (!at.zone) return [{ path: `${path}/zone`, message: `${at.container} needs a zone: ${zones.join(', ')}` }];
  return zones.includes(at.zone) ? [] : [{ path: `${path}/zone`, message: `${at.zone} is not a zone of ${at.container}; use one of: ${zones.join(', ')}` }];
}

/** Source equations must be grounded in cited source text; other equations need a verified numeric equality or supported affine example. Unknown is a failure. */
function equationProblems(spec: ElementSpec, path: string, grounding?: Grounding): ValidatorProblem[] {
  let latex: string;
  let pointer: string;
  if (spec.type === 'equation') { latex = spec.latex; pointer = `${path}/latex`; }
  else if (spec.type === 'kit' && spec.kit === 'equation') {
    const parsed = parseKitParams(spec.kit, spec.paramsJson);
    if (!parsed.ok) return []; // kitProblems reports malformed parameters.
    latex = (parsed.value as { latex: string }).latex;
    pointer = `${path}/paramsJson`;
  } else return [];
  if (spec.provenance === 'source') {
    const message = sourceFormulaProblem(latex, spec.type === 'equation' || spec.type === 'kit' ? spec.evidence : undefined, grounding);
    return message ? [{ path: `${path}/evidence`, message }] : [];
  }
  const verdict = verifyEquation(latex);
  if (verdict.status === 'verified') return [];
  const description = spec.provenance === 'illustrative' ? 'illustrative example' : `${spec.provenance} equation`;
  return [{ path: pointer, message: verdict.status === 'refuted' ? `this ${description} is wrong (${verdict.detail}); give a correct example` : `could not verify this ${description} (${verdict.detail}); if the source states this equation, set provenance source and copy evidence {spanId, quote} from the SOURCE EVIDENCE list; otherwise use a numeric example the checker can evaluate` }];
}

function stepProblems(op: BoardOp, state: BoardState, at: string, grounding?: Grounding): ValidatorProblem[] {
  if (op.op !== 'equationStep') return [];
  const target = state.elements[op.target];
  if (!target || target.spec.type !== 'equation') return [];
  if (target.spec.provenance === 'source') {
    const message = sourceFormulaProblem(op.latex, op.evidence, grounding);
    return message ? [{ path: `${at}/evidence`, message: `this derivation line of a source equation is not grounded: ${message}` }] : [];
  }
  const verdict = verifyStep(String(target.value ?? target.spec.latex), op.latex);
  if (verdict.status === 'verified') return [];
  return [{ path: `${at}/latex`, message: verdict.status === 'refuted' ? `this line does not follow from the previous one (${verdict.detail})` : `could not verify this line follows from the previous one (${verdict.detail})` }];
}

export const TRANSFORM_SCALE = { min: 0.5, max: 1.6 } as const;
const TRANSFORM_COLORS = ['blue', 'yellow', 'green', 'orange', 'purple', 'red', 'grey'];
/** A transform may only change what the renderer draws: `scale` (number) or `color` (palette name). It never changes content. */
function transformKeyProblem(change: { key: string; value: string | number }, path: string): ValidatorProblem[] {
  if (change.key === 'scale') return typeof change.value === 'number' && change.value >= TRANSFORM_SCALE.min && change.value <= TRANSFORM_SCALE.max ? [] : [{ path: `${path}/value`, message: `scale must be a number from ${TRANSFORM_SCALE.min} to ${TRANSFORM_SCALE.max}` }];
  if (change.key === 'color') return typeof change.value === 'string' && TRANSFORM_COLORS.includes(change.value) ? [] : [{ path: `${path}/value`, message: `color must be one of ${TRANSFORM_COLORS.join(', ')}` }];
  return [{ path: `${path}/key`, message: 'transform can change only scale or color; use equationStep, updateValue or replace to change content' }];
}

function transformProblems(op: BoardOp, state: BoardState, at: string): ValidatorProblem[] {
  if (op.op !== 'transform') return [];
  const spec = state.elements[op.target]?.spec;
  const supported = op.changes.flatMap((change, j) => transformKeyProblem(change, `${at}/changes/${j}`));
  if (!spec || !(spec.type === 'equation' || (spec.type === 'kit' && spec.kit === 'equation'))) return supported;
  // transform writes generic props, not equation value/steps or kit params. Do not accept an apparent content edit that
  // either evades verification or silently leaves the displayed equation unchanged.
  const contentKeys = new Set(['latex', 'value', 'steps', 'paramsJson', 'provenance', 'type', 'kit']);
  const content = op.changes.flatMap((change, j) => contentKeys.has(change.key) ? [{ path: `${at}/changes/${j}/key`, message: 'equation content changes require equationStep or replace, with verified content' }] : []);
  return content.length > 0 ? content : supported;
}

function opShapeProblems(op: BoardOp, state: BoardState, index: number, grounding?: Grounding): ValidatorProblem[] {
  const at = `/ops/${index}`;
  switch (op.op) {
    case 'add': return [...kitProblems(op.element, `${at}/element`), ...equationProblems(op.element, `${at}/element`, grounding), ...zoneProblems(state, op.at, `${at}/at`)];
    case 'equationStep': return stepProblems(op, state, at, grounding);
    case 'transform': return transformProblems(op, state, at);
    case 'replace': return [...kitProblems(op.element, `${at}/element`), ...equationProblems(op.element, `${at}/element`, grounding)];
    case 'move': return zoneProblems(state, op.to, `${at}/to`);
    case 'split': return [...(duplicateId(op.into.map((part) => part.id)) ? [{ path: `${at}/into`, message: `split parts must have distinct ids; ${duplicateId(op.into.map((part) => part.id))} is repeated` }] : []), ...op.into.flatMap((part, j) => [...kitProblems(part.element, `${at}/into/${j}/element`), ...equationProblems(part.element, `${at}/into/${j}/element`, grounding), ...zoneProblems(state, part.at, `${at}/into/${j}/at`)])];
    case 'merge': return [...kitProblems(op.into.element, `${at}/into/element`), ...equationProblems(op.into.element, `${at}/into/element`, grounding), ...zoneProblems(state, op.into.at, `${at}/into/at`)];
    default: return [];
  }
}

/**
 * Simulate the ops on a copy of the board. A failed precondition or a mismatched `expects` becomes a problem at its JSON
 * pointer, so a repair patches that one op. A failed op leaves the board unchanged and simulation continues.
 */
/** Density caps: a board must stay readable, so a scene draws a handful of things and a kit holds a handful of children. */
export const MAX_BOARD_ELEMENTS = 10;
export const MAX_KIT_CHILDREN = 6;
/** Zoned kits split their width between zones, so each zone holds fewer. */
export const MAX_ZONE_CHILDREN = 4;

export function validateBoardOps(ops: readonly BoardOp[], initial: BoardState, grounding?: Grounding, beatOrder?: readonly string[]): ValidatorProblem[] {
  const problems: ValidatorProblem[] = [];
  let state = initial;
  // Elements a failed op would have created. Dependent operations are not
  // simulated, but are explicitly included in the pointer repair closure.
  const phantom = new Set<string>();
  let created = 0;
  const skip = (op: BoardOp): void => { for (const id of createdBy(op)) phantom.add(id); };
  ops.forEach((op, index) => {
    const previousBeat = ops[index - 1]?.beatId;
    const blockedBy = dependenciesOf(op).filter((id) => phantom.has(id));
    if (blockedBy.length) {
      problems.push({ path: `/ops/${index}`, message: `this operation depends on an earlier invalid creator (${blockedBy.join(', ')}); repair this reference together with the creator while preserving its opId and other accepted operations` });
      skip(op);
      return;
    }
    const shape = opShapeProblems(op, state, index, grounding);
    problems.push(...shape);
    if (shape.length > 0) { skip(op); return; }
    const drawn = op.op === 'add' || op.op === 'replace' || op.op === 'merge' ? 1 : op.op === 'split' ? op.into.length : 0;
    if (drawn > 0 && created + drawn > MAX_BOARD_ELEMENTS) {
      problems.push({ path: `/ops/${index}`, message: `this scene already draws ${created} elements; at most ${MAX_BOARD_ELEMENTS} per scene, so reuse, move or restyle what is on the board instead of adding more` });
      skip(op); return;
    }
    try { state = applyOpAfter(state, op, previousBeat, beatOrder).state; } catch (error) {
      if (!(error instanceof BoardOpError)) throw error;
      problems.push({ path: `/ops/${index}`, message: error.message.replace(`${op.opId}: `, '') });
      skip(op);
      return;
    }
    created += drawn;
    const placed = op.op === 'add' ? [op.at] : op.op === 'move' ? [op.to] : op.op === 'split' ? op.into.map((part) => part.at) : op.op === 'merge' ? [op.into.at] : [];
    for (const at of placed) if (at.container && at.zone && containerContents(state, at.container).filter((id) => state.elements[id]?.placement.zone === at.zone).length > MAX_ZONE_CHILDREN) problems.push({ path: `/ops/${index}`, message: `zone ${at.zone} of ${at.container} would hold more than ${MAX_ZONE_CHILDREN} children; each zone gets only part of the kit's width, so keep zones to ${MAX_ZONE_CHILDREN} or fewer` });
    for (const at of placed) if (at.container && containerContents(state, at.container).length > MAX_KIT_CHILDREN) problems.push({ path: `/ops/${index}`, message: `${at.container} would hold more than ${MAX_KIT_CHILDREN} children; slots become too small to read, so remove one first or use a second kit in another region` });

    (op.expects ?? []).forEach((expect, j) => { const message = unmet(expect, state); if (message) problems.push({ path: `/ops/${index}/expects/${j}`, message }); });
  });
  return problems;
}
