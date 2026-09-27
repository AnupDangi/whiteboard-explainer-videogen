/**
 * The one table of scene templates. Everything else is derived from it: the
 * TemplateId type and zod enum, the slot table in the planner prompt, the
 * composition recipes, the solver's slot plans (templates/definitions.ts)
 * and the slots the typed-board gate requires.
 *
 * Adding a template: add a spec here, add its geometry function to
 * `TEMPLATES` in templates/definitions.ts (the compiler enforces both), and
 * add a topic-swap regression test. A spec is topic-neutral: it says how to
 * draw, never what a lesson says.
 */
export interface TemplateSlot { name: string; capacity: number | 'many' }
export interface TemplateRecipe { useWhen: string; build: string; avoid: string }
export interface TemplateSpec {
  slots: readonly TemplateSlot[];
  /** Slots a typed board must fill with a concept node, and how a failure names them. */
  requiredSlots?: ReadonlyArray<{ slot: string; explanation: string }>;
  recipe: TemplateRecipe;
}

export const TEMPLATE_IDS = [
  'title_card', 'hub_spoke', 'chain', 'convergence', 'fan_out', 'list_icon', 'compare_2',
  'threshold', 'weighted_blend', 'layered_stack', 'cycle', 'formula_focus', 'plot_focus',
] as const;

export type TemplateId = typeof TEMPLATE_IDS[number];

export const TEMPLATE_SPECS: Record<TemplateId, TemplateSpec> = {
  title_card: {
    slots: [{ name: 'title', capacity: 1 }, { name: 'subtitle', capacity: 1 }, { name: 'strip', capacity: 'many' }],
    recipe: { useWhen: 'the scene opens a lesson or names one central claim', build: 'one short title text, one subtitle stating the claim, an optional tokenStrip previewing up to 4 steps', avoid: 'more than 3 elements; arrows' },
  },
  hub_spoke: {
    slots: [{ name: 'hub', capacity: 1 }, { name: 'spoke', capacity: 'many' }],
    requiredSlots: [{ slot: 'hub', explanation: 'a hub' }, { slot: 'spoke', explanation: 'at least one spoke' }],
    recipe: { useWhen: 'one thing connects to or is made of several parts', build: 'the central thing as an object icon or box in hub; each part as a pill, box, or icon in spoke; one edge per spoke-hub link in the direction the narration states', avoid: 'spokes that are not linked to the hub' },
  },
  chain: {
    slots: [{ name: 'node', capacity: 'many' }],
    recipe: { useWhen: 'a process runs through ordered stages', build: 'one node per stage, left to right; concrete stages as object icons with labels, abstract stages as boxes; an edge between consecutive nodes, labelled with the action when the narration names it', avoid: 'more than 5 nodes; unconnected nodes' },
  },
  convergence: {
    slots: [{ name: 'input', capacity: 'many' }, { name: 'operator', capacity: 1 }, { name: 'output', capacity: 'many' }],
    requiredSlots: [{ slot: 'input', explanation: 'at least one input' }, { slot: 'operator', explanation: 'a process/operator' }, { slot: 'output', explanation: 'at least one output' }],
    recipe: { useWhen: 'several inputs combine into one result', build: 'inputs in input, one operator whose symbol matches the combination, the result in output as a box, meter, or icon; edges from every input to the operator and from the operator to the output', avoid: 'an operator symbol the narration does not justify' },
  },
  fan_out: {
    slots: [{ name: 'source', capacity: 1 }, { name: 'target', capacity: 'many' }],
    requiredSlots: [{ slot: 'source', explanation: 'a source' }, { slot: 'target', explanation: 'at least one target' }],
    recipe: { useWhen: 'one source spreads to several targets', build: 'the source in source, targets in target, one edge from the source to each target', avoid: 'edges between targets' },
  },
  list_icon: {
    slots: [{ name: 'item', capacity: 'many' }],
    recipe: { useWhen: 'the narration itself lists parallel items with no mechanism between them', build: '2-5 items, each an object icon with a label or a box', avoid: 'using it when the narration describes cause, order, or combination; choose chain, convergence, or cycle then' },
  },
  compare_2: {
    slots: [{ name: 'left', capacity: 1 }, { name: 'right', capacity: 1 }, { name: 'verdict', capacity: 1 }],
    requiredSlots: [{ slot: 'left', explanation: 'a left alternative' }, { slot: 'right', explanation: 'a right alternative' }],
    recipe: { useWhen: 'two alternatives differ on a stated property', build: 'left and right as matching icons or boxes; verdict as a meter or box naming the deciding property', avoid: 'unequal visual weight between the two sides' },
  },
  threshold: {
    slots: [{ name: 'subject', capacity: 1 }, { name: 'bar', capacity: 1 }, { name: 'marker', capacity: 1 }],
    recipe: { useWhen: 'a quantity crosses a limit and a state changes', build: 'subject as icon or box, bar as a meter with the limit labelled, marker as the resulting state with a badge when useful; an edge from bar to marker', avoid: 'a meter value that the source does not support; mark invented values illustrative-example' },
  },
  weighted_blend: {
    slots: [{ name: 'input', capacity: 'many' }, { name: 'weight', capacity: 'many' }, { name: 'combiner', capacity: 1 }, { name: 'result', capacity: 1 }],
    recipe: { useWhen: 'contributions of different size make a total', build: 'inputs, a weight text beside each input, a combiner operator, one result; edges from inputs to the combiner and from the combiner to the result', avoid: 'weights without inputs' },
  },
  layered_stack: {
    slots: [{ name: 'layer', capacity: 'many' }],
    recipe: { useWhen: 'layers sit on top of each other or pass something down', build: 'one layer element per level, top to bottom; edges only between adjacent layers', avoid: 'more than 5 layers' },
  },
  cycle: {
    slots: [{ name: 'node', capacity: 'many' }],
    recipe: { useWhen: 'stages repeat and return to the start', build: '3-6 nodes; edges node to node and last back to first, in the narrated order', avoid: 'a missing closing edge' },
  },
  formula_focus: {
    slots: [{ name: 'formula', capacity: 4 }, { name: 'callout', capacity: 'many' }],
    recipe: { useWhen: 'the scene explains an equation', build: 'formula with parts so each term appears when named; callouts as short text anchored to the term they explain', avoid: 'a single unexplained latex block when the narration walks through terms' },
  },
  plot_focus: {
    slots: [{ name: 'plot', capacity: 1 }, { name: 'formula', capacity: 2 }, { name: 'callout', capacity: 'many' }],
    recipe: { useWhen: 'a quantity changes over another quantity', build: 'one plot with axis labels; tangentAt, trajectory, or riseRun only when the narration describes slope, steps, or rise over run; callouts anchored after the curve', avoid: 'plot markers outside the domain' },
  },
};

/** A template's slot plan, as a fresh array the solver may consume. */
export const templateSlots = (id: TemplateId) => TEMPLATE_SPECS[id].slots.map((slot) => ({ ...slot }));
