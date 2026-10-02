import { SEMANTIC_ROLES, SEMANTIC_TOPOLOGIES } from '../render/semanticCore.js';

/**
 * Deterministic repair of a MODEL-written board before validation (never-fail composition).
 * Every rule fixes a shape error code can correct without inventing content: unknown enum values become the
 * safe default, impossible layouts become the layout that fits the node count, a missing visual becomes the
 * plain process form. Facts (concepts, mentions, evidence, relations) are never touched; they are still
 * validated afterwards, and a board that remains invalid still goes to the bounded model repair.
 */
const REPRESENTATION_KINDS = new Set(['literal', 'metaphor', 'retrieval', 'semantic-role', 'topology', 'shape', 'labelled']);
const MAX_LABEL_CHARS = 40;
const COMPARE_MAX_NODES = 3;

export interface BoardRepairContext {
  /** Concepts the scene must show (contract + relation endpoints). */
  requiredConceptCount: number;
  maxLabelWords: number;
}

export function repairRawBoard(value: unknown, context: BoardRepairContext): { board: unknown; repairs: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { board: value, repairs: [] };
  const repairs: string[] = [];
  const raw: Record<string, unknown> = { ...(value as Record<string, unknown>) };

  if (!raw.visual || typeof raw.visual !== 'object') { raw.visual = { kind: 'process' }; repairs.push('visual defaulted to process'); }

  if (Array.isArray(raw.nodes)) {
    raw.nodes = raw.nodes.map((node, index) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
      const next: Record<string, unknown> = { ...(node as Record<string, unknown>) };
      const representation = next.representation as Record<string, unknown> | undefined;
      if (!representation || typeof representation !== 'object' || !REPRESENTATION_KINDS.has(String(representation.kind))) {
        next.representation = { kind: 'literal' };
        repairs.push(`node ${index + 1}: unknown representation became literal`);
      } else if (representation.kind === 'semantic-role' && !(SEMANTIC_ROLES as readonly string[]).includes(String(representation.role))) {
        next.representation = { kind: 'literal' };
        repairs.push(`node ${index + 1}: unknown semantic role became literal`);
      } else if (representation.kind === 'topology' && !(SEMANTIC_TOPOLOGIES as readonly string[]).includes(String(representation.topology))) {
        next.representation = { kind: 'literal' };
        repairs.push(`node ${index + 1}: unknown topology became literal`);
      }
      if (typeof next.label === 'string') {
        const words = next.label.trim().split(/\s+/).filter(Boolean).slice(0, context.maxLabelWords).join(' ').slice(0, MAX_LABEL_CHARS).trim();
        if (words !== next.label) { next.label = words || 'item'; repairs.push(`node ${index + 1}: label shortened`); }
      }
      return next;
    });
  }

  const nodeCount = Array.isArray(raw.nodes) ? raw.nodes.length : 0;
  // A compare board holds 2-3 nodes; more concepts need a layout that can hold them.
  if (raw.layout === 'compare' && (nodeCount < 2 || nodeCount > COMPARE_MAX_NODES || context.requiredConceptCount > COMPARE_MAX_NODES)) {
    raw.layout = nodeCount >= 3 ? 'fan_out' : 'flow';
    repairs.push(`compare layout with ${nodeCount} nodes became ${String(raw.layout)}`);
    if (raw.layout === 'fan_out' && Array.isArray(raw.nodes)) {
      raw.nodes = (raw.nodes as Array<Record<string, unknown>>).map((node, index) => ({ ...node, role: index === 0 ? 'process' : 'output' }));
    } else if (Array.isArray(raw.nodes)) {
      raw.nodes = (raw.nodes as Array<Record<string, unknown>>).map((node, index) => ({ ...node, role: index === 0 ? 'process' : 'output' }));
    }
  }
  const visual = raw.visual as Record<string, unknown>;
  if (visual.kind === 'comparison' && raw.layout !== 'compare') { raw.visual = { kind: 'process' }; repairs.push('comparison form without compare layout became process'); }
  if (raw.layout === 'compare' && visual.kind !== 'comparison') {
    // A structured picture (geometry, array, formula, plot...) is the content of the scene: keep it and give the nodes a
    // plain layout. Only a plain process form is replaced by the comparison form.
    if (visual.kind === 'process' || visual.kind === 'plain') { raw.visual = { kind: 'comparison' }; repairs.push('compare layout got the comparison form'); }
    else { raw.layout = 'list'; repairs.push(`compare layout with a ${String(visual.kind)} picture became list`); }
  }

  // Process form needs one process-role node on legacy layouts: promote the first node.
  const legacy = ['flow', 'fan_out', 'convergence', 'list', 'cycle', 'hub'].includes(String(raw.layout));
  if (legacy && (raw.visual as Record<string, unknown>).kind === 'process' && Array.isArray(raw.nodes) && raw.nodes.length && !raw.nodes.some((node) => (node as Record<string, unknown>)?.role === 'process')) {
    const nodes = raw.nodes as Array<Record<string, unknown>>;
    raw.nodes = nodes.map((node, index) => (index === Math.floor(nodes.length / 2) ? { ...node, role: 'process' } : node));
    repairs.push('process role assigned to the middle node');
  }
  // A convergence board needs inputs, exactly one process and an output. A board that cannot hold that shape is a flow of the same nodes.
  if (raw.layout === 'convergence' && Array.isArray(raw.nodes)) {
    const nodes = raw.nodes as Array<Record<string, unknown>>;
    const processCount = nodes.filter((node) => node?.role === 'process').length;
    if (!nodes.some((node) => node?.role === 'output') || processCount !== 1) {
      raw.layout = 'flow';
      let processSeen = false;
      raw.nodes = nodes.map((node) => (node?.role === 'process' ? (processSeen ? { ...node, role: 'item' } : (processSeen = true, node)) : node));
      repairs.push('convergence layout without exactly one process and an output became flow');
    }
  }
  // Surplus bookkeeping: at most 12 targets per claim, 8 claims, and a title within its length.
  if (typeof raw.title === 'string' && raw.title.length > 60) raw.title = raw.title.slice(0, 60).replace(/\s+\S*$/u, '').trim() || raw.title.slice(0, 60);
  if (Array.isArray(raw.visualIntents)) raw.visualIntents = (raw.visualIntents as unknown[]).slice(0, 8).map((intent) => (intent && typeof intent === 'object' && !Array.isArray(intent) && Array.isArray((intent as Record<string, unknown>).targets) && ((intent as Record<string, unknown>).targets as unknown[]).length > 12 ? { ...(intent as Record<string, unknown>), targets: ((intent as Record<string, unknown>).targets as unknown[]).slice(0, 12) } : intent));
  // A claim target the schema cannot read: infer its kind from the fields it carries, drop it when it carries none.
  if (Array.isArray(raw.visualIntents)) {
    raw.visualIntents = raw.visualIntents.map((intent, intentIndex) => {
      if (!intent || typeof intent !== 'object' || Array.isArray(intent) || !Array.isArray((intent as Record<string, unknown>).targets)) return intent;
      const targets = ((intent as Record<string, unknown>).targets as unknown[]).flatMap((target) => {
        if (!target || typeof target !== 'object' || Array.isArray(target)) return [];
        const item = target as Record<string, unknown>;
        if (item.kind === 'element' || item.kind === 'edge') return [item];
        // The structured picture (formula, plot, array...) is addressed as the element "visual"; models often write kind "visual".
        if (item.kind === 'visual' || item.kind === 'figure' || item.kind === 'picture') { const { kind: _kind, ...rest } = item; return [{ ...rest, kind: 'element', elementId: 'visual' }]; }
        if (typeof item.elementId === 'string') return [{ ...item, kind: 'element' }];
        if (typeof item.fromElementId === 'string' && typeof item.toElementId === 'string') return [{ ...item, kind: 'edge' }];
        return [];
      });
      if (targets.length !== ((intent as Record<string, unknown>).targets as unknown[]).length || ((intent as Record<string, unknown>).targets as Array<Record<string, unknown>>).some((target, index) => target?.kind !== (targets[index] as Record<string, unknown> | undefined)?.kind)) repairs.push(`visual intent ${intentIndex + 1}: unreadable target kinds repaired`);
      return { ...(intent as Record<string, unknown>), targets };
    });
  }
  return { board: raw, repairs };
}
