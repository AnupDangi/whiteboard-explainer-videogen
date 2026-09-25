import type { TemplateId } from '../types.js';

/** Topic-neutral composition guidance per template. Content always comes from the target scene's evidence. */
export const RECIPE_VERSION = 'visual-recipes/v1';

export const RECIPE_CARDS: Record<TemplateId, { useWhen: string; build: string; avoid: string }> = {
  title_card: { useWhen: 'the scene opens a lesson or names one central claim', build: 'one short title text, one subtitle stating the claim, an optional tokenStrip previewing up to 4 steps', avoid: 'more than 3 elements; arrows' },
  hub_spoke: { useWhen: 'one thing connects to or is made of several parts', build: 'the central thing as an object icon or box in hub; each part as a pill, box, or icon in spoke; one edge per spoke-hub link in the direction the narration states', avoid: 'spokes that are not linked to the hub' },
  chain: { useWhen: 'a process runs through ordered stages', build: 'one node per stage, left to right; concrete stages as object icons with labels, abstract stages as boxes; an edge between consecutive nodes, labelled with the action when the narration names it', avoid: 'more than 5 nodes; unconnected nodes' },
  convergence: { useWhen: 'several inputs combine into one result', build: 'inputs in input, one operator whose symbol matches the combination, the result in output as a box, meter, or icon; edges from every input to the operator and from the operator to the output', avoid: 'an operator symbol the narration does not justify' },
  fan_out: { useWhen: 'one source spreads to several targets', build: 'the source in source, targets in target, one edge from the source to each target', avoid: 'edges between targets' },
  list_icon: { useWhen: 'the narration itself lists parallel items with no mechanism between them', build: '2-5 items, each an object icon with a label or a box', avoid: 'using it when the narration describes cause, order, or combination; choose chain, convergence, or cycle then' },
  compare_2: { useWhen: 'two alternatives differ on a stated property', build: 'left and right as matching icons or boxes; verdict as a meter or box naming the deciding property', avoid: 'unequal visual weight between the two sides' },
  threshold: { useWhen: 'a quantity crosses a limit and a state changes', build: 'subject as icon or box, bar as a meter with the limit labelled, marker as the resulting state with a badge when useful; an edge from bar to marker', avoid: 'a meter value that the source does not support; mark invented values illustrative-example' },
  weighted_blend: { useWhen: 'contributions of different size make a total', build: 'inputs, a weight text beside each input, a combiner operator, one result; edges from inputs to the combiner and from the combiner to the result', avoid: 'weights without inputs' },
  layered_stack: { useWhen: 'layers sit on top of each other or pass something down', build: 'one layer element per level, top to bottom; edges only between adjacent layers', avoid: 'more than 5 layers' },
  cycle: { useWhen: 'stages repeat and return to the start', build: '3-6 nodes; edges node to node and last back to first, in the narrated order', avoid: 'a missing closing edge' },
  formula_focus: { useWhen: 'the scene explains an equation', build: 'formula with parts so each term appears when named; callouts as short text anchored to the term they explain', avoid: 'a single unexplained latex block when the narration walks through terms' },
  plot_focus: { useWhen: 'a quantity changes over another quantity', build: 'one plot with axis labels; tangentAt, trajectory, or riseRun only when the narration describes slope, steps, or rise over run; callouts anchored after the curve', avoid: 'plot markers outside the domain' },
};

export function recipeSectionBody(): string {
  return (Object.entries(RECIPE_CARDS) as Array<[TemplateId, { useWhen: string; build: string; avoid: string }]>)
    .map(([template, card]) => `- ${template}: use when ${card.useWhen}. Build: ${card.build}. Avoid: ${card.avoid}.`)
    .join('\n') + '\nIcons: when a mention has icon candidates and one literally depicts the concrete thing, prefer that object icon with a short label. A scene with only boxes is acceptable only when nothing concrete is named.';
}
