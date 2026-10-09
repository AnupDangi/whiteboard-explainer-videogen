import { reviewKey, type BadgeReview } from '../assets/badgeReview.js';
import type { IconUse } from './v2Richness.js';

/** Wrong-icon rate over human-reviewed uses only; coverage says how much of what was drawn has a verdict. */
export interface WrongIconScore { uses: number; reviewed: number; wrong: number; coverage: number | null; wrongIconRate: number | null; unreviewedKeys: string[] }

export function scoreWrongIcons(uses: readonly IconUse[], review: BadgeReview): WrongIconScore {
  const keys = uses.map((use) => reviewKey(use.assetId, use.referent));
  const reviewed = keys.filter((key) => review.accepted.has(key) || review.rejected.has(key));
  const wrong = keys.filter((key) => review.rejected.has(key)).length;
  return {
    uses: keys.length,
    reviewed: reviewed.length,
    wrong,
    coverage: keys.length ? reviewed.length / keys.length : null,
    wrongIconRate: reviewed.length ? wrong / reviewed.length : null,
    unreviewedKeys: [...new Set(keys.filter((key) => !review.accepted.has(key) && !review.rejected.has(key)))].sort(),
  };
}
