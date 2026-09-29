import { TEMPLATE_IDS, TEMPLATE_SPECS, type TemplateId, type TemplateRecipe } from '../templates/catalog.js';

/** Topic-neutral composition guidance per template. Content always comes from the target scene's evidence. */
export const RECIPE_VERSION = 'visual-recipes/v1';

/** Recipes live with each template in templates/catalog.ts. */
export const RECIPE_CARDS = Object.fromEntries(TEMPLATE_IDS.map((id) => [id, TEMPLATE_SPECS[id].recipe])) as Record<TemplateId, TemplateRecipe>;

export function recipeSectionBody(): string {
  return (Object.entries(RECIPE_CARDS) as Array<[TemplateId, TemplateRecipe]>)
    .map(([template, card]) => `- ${template}: use when ${card.useWhen}. Build: ${card.build}. Avoid: ${card.avoid}.`)
    .join('\n') + '\nIcons: when a mention has icon candidates and one literally depicts the concrete thing, prefer that object icon with a short label. A scene with only boxes is acceptable only when nothing concrete is named.';
}
