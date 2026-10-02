import type { KitName } from '../board-ops/types.js';
import { stackKit } from './stack.js';
import { queueKit } from './queue.js';
import { arrayKit } from './array.js';
import { compartmentKit } from './compartment.js';
import { layeredStackKit } from './layered-stack.js';
import { cycleKit } from './cycle.js';
import { comparisonKit } from './comparison.js';
import { graphKit } from './graph.js';
import { treeKit } from './tree.js';
import { weightedLinksKit } from './weighted-links.js';
import { axesPlotKit } from './axes-plot.js';
import { equationKit } from './equation.js';
import type { KitDef } from './types.js';

export const KIT_REGISTRY: Record<KitName, KitDef<any>> = {
  stack: stackKit, queue: queueKit, array: arrayKit, compartment: compartmentKit, 'layered-stack': layeredStackKit, cycle: cycleKit,
  comparison: comparisonKit, graph: graphKit, tree: treeKit, 'weighted-links': weightedLinksKit, 'axes-plot': axesPlotKit, equation: equationKit,
};

export type ParsedKit = { ok: true; value: unknown } | { ok: false; error: string };

/** Parse and validate a kit's parameter JSON with the kit's own schema. */
export function parseKitParams(kit: KitName, paramsJson: string): ParsedKit {
  let raw: unknown;
  try { raw = JSON.parse(paramsJson); } catch { return { ok: false, error: `paramsJson is not valid JSON text for kit ${kit}` }; }
  const parsed = KIT_REGISTRY[kit].paramsSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: `${kit} params: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}` };
}
