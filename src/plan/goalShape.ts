/**
 * Detect requests whose requested learning outcome is relational rather than a
 * definition of one item. This is an intent check only: evidence and graph
 * edges are still required to establish any fact.
 */
const comparisonIntent = /\b(compare|contrast|versus|vs\.?|difference(?:s)?|relationship|relate|interact(?:ion|s)?)\b/iu;
const explanatoryHowIntent = /\bhow\b(?!\s+to\b)/iu;
const causalWhyIntent = /\bwhy\b/iu;

export const CONCEPT_STRUCTURE_GUIDANCE = 'Match concept granularity to the requested learning goal. When the request asks how distinct parts interact, how a process changes from one state to another, or how alternatives differ, represent each source-supported part/state/alternative needed for that explanation as its own concept ID; a single umbrella event must not replace those parts. Connect the distinct concepts with relations only where the source states that connection, citing the exact supporting evidence. When assigning kind, an entity is a source-named object, material, component, or participant with an identity distinct from the action; a process or event names the action, change, transformation, or occurrence itself. Keep source-named participants, inputs, and products as distinct concepts alongside the process when the evidence supports them. Never classify an action or process label as an entity just to make it drawable, and never add an inferred participant or product. Keep a straightforward request to define one idea as one concept; do not split synonyms, wording variants, or incidental details into separate concepts.';
export const SYLLABUS_COMPONENT_GUIDANCE = 'When the learner goal asks how parts interact, how a process changes state, or how alternatives differ, model each independently supported part/state/alternative as its own stable concept ID and assign the connected components to the same module; do not use one umbrella concept in place of those components. When explaining a source-described process or transformation, include each independently source-backed physical participant, component, material or substrate, input, and product/output needed to understand it as its own stable concept with its source term and evidence, alongside the process concept. Name a material input or output with the source noun for that thing; do not append its production, release, or transformation action to the product name. Choose a concise source term that can be reused naturally as the participant in a factual clause. Preserve the process/action as a separate concept; do not use its label as a substitute for its participants or infer objects, inputs, or products not supported by evidence. These are source-grounded extraction decisions: never shorten a fixed concept label, reclassify an action as an object, or infer a new referent merely to make a relation or picture fit. A straightforward request to define one idea may use one concept; do not split synonyms or incidental details.';
export const PLAN_COMPONENT_GUIDANCE = 'When the learner goal asks for a comparison, interaction, or transformation, assign the distinct source-backed concepts that make up that explanation together in a scene and include their graph relations. Do not collapse multiple graph components into one umbrella concept; if the graph lacks the requested components, the upstream concept extraction must be repaired rather than inventing IDs or facts here. A simple definition goal may use one concept.';

export function relationalGoalNeedsComponents(instruction: string | undefined): boolean {
  if (!instruction?.trim()) return false;
  return comparisonIntent.test(instruction) || explanatoryHowIntent.test(instruction) || causalWhyIntent.test(instruction);
}

export function relationalGraphProblems(instruction: string | undefined, conceptCount: number, relationCount: number, scopeOwnsCompleteness = false): string[] {
  // Hierarchical module requests carry the course-wide objective but their
  // concept scope is intentionally local. Syllabus validation owns coverage
  // across modules; do not demand every module repeat all course components.
  if (scopeOwnsCompleteness || !relationalGoalNeedsComponents(instruction)) return [];
  const problems: string[] = [];
  if (conceptCount < 2) problems.push('the learner request requires explaining a relationship among distinct parts, but the source-backed concept graph has fewer than two concepts; split only independently supported components and cite each one');
  if (conceptCount >= 2 && relationCount === 0) problems.push('the learner request requires explaining a relationship among distinct parts, but the source-backed concept graph has no evidence-backed relation; add only a relation stated by the source');
  return problems;
}
