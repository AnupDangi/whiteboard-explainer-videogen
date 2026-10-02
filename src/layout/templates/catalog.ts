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
  'hierarchy_tree', 'decision_tree', 'timeline', 'rule_exception', 'claim_evidence',
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
  hierarchy_tree: {
    slots: [{ name: 'root', capacity: 1 }, { name: 'branch', capacity: 'many' }, { name: 'leaf', capacity: 'many' }],
    requiredSlots: [{ slot: 'root', explanation: 'one hierarchy root' }, { slot: 'branch', explanation: 'at least one child branch' }],
    recipe: { useWhen: 'a whole is divided into nested levels or categories', build: 'place nodes in source order by level: one root, then up to two children, then up to four leaves; connect each child to its stated parent', avoid: 'implying a parent-child relation not supported by the scene contract' },
  },
  decision_tree: {
    slots: [{ name: 'root', capacity: 1 }, { name: 'branch', capacity: 'many' }, { name: 'outcome', capacity: 'many' }],
    requiredSlots: [{ slot: 'root', explanation: 'one decision root' }, { slot: 'branch', explanation: 'at least one labelled branch' }, { slot: 'outcome', explanation: 'at least one outcome' }],
    recipe: { useWhen: 'a decision branches through conditions to different outcomes', build: 'put the initial condition at the top, branches on the next level, and outcomes below in source order; each branch edge carries an exact source-backed condition label', avoid: 'invented or unlabeled branch conditions and outcomes' },
  },
  timeline: {
    slots: [{ name: 'event', capacity: 'many' }],
    requiredSlots: [{ slot: 'event', explanation: 'at least one event' }],
    recipe: { useWhen: 'events or stages are ordered in time', build: 'place events in source order along a timeline, wrapping into ordered rows only when needed; connect adjacent events', avoid: 'implying durations or dates the evidence does not establish' },
  },
  rule_exception: {
    slots: [{ name: 'rule', capacity: 1 }, { name: 'exception', capacity: 1 }, { name: 'consequence', capacity: 1 }],
    requiredSlots: [{ slot: 'rule', explanation: 'the general rule' }, { slot: 'exception', explanation: 'the exception' }],
    recipe: { useWhen: 'a general rule has a stated exception', build: 'show rule and exception in distinct labelled regions; add a consequence region only when the source states one', avoid: 'presenting the exception as the rule or adding an unstated consequence' },
  },
  claim_evidence: {
    slots: [{ name: 'claim', capacity: 1 }, { name: 'evidence', capacity: 'many' }],
    requiredSlots: [{ slot: 'claim', explanation: 'the claim being supported' }, { slot: 'evidence', explanation: 'at least one supporting evidence item' }],
    recipe: { useWhen: 'the scene connects a claim to its supporting observations or source evidence', build: 'place the claim prominently beside or above evidence items; connect only evidence that the contract links to the claim', avoid: 'implying that a citation proves more than its cited span supports' },
  },
};

/** A template's slot plan, as a fresh array the solver may consume. */
export const templateSlots = (id: TemplateId) => TEMPLATE_SPECS[id].slots.map((slot) => ({ ...slot }));
