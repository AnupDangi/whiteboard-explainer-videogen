import { ErrorContrastSchema, type ErrorContrast } from './types.js';

/** Structural validation of an error contrast. Semantic correctness stays with judges. */
export function validateErrorContrast(contrast: ErrorContrast, misconceptionIds: readonly string[] = []): string[] {
  const parsed = ErrorContrastSchema.safeParse(contrast);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('/')}: ${i.message}`);
  const problems: string[] = [];
  if (misconceptionIds.length > 0 && !misconceptionIds.includes(contrast.misconceptionId)) {
    problems.push(`misconceptionId ${contrast.misconceptionId} is not one of this beat's ids (${misconceptionIds.join(', ')})`);
  }
  const wrong = contrast.divergence.wrongStep.step.trim().toLowerCase();
  const correct = contrast.divergence.correctStep.step.trim().toLowerCase();
  if (wrong === correct) problems.push('wrongStep and correctStep are identical: there is no divergence to teach');
  return problems;
}
