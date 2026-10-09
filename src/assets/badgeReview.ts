import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referentOf } from './referent.js';

/** Reviewed verdicts on whether one catalog asset correctly depicts one referent. Data, like metaphors.v1.json; never inferred. */
export interface BadgeDecision { assetId: string; referent: string; verdict: 'accept' | 'reject'; reviewer: string; date: string; note?: string }
export interface BadgeReview { accepted: ReadonlySet<string>; rejected: ReadonlySet<string> }

export const reviewKey = (assetId: string, referent: string): string => `${assetId}|${referent}`;
export const EMPTY_BADGE_REVIEW: BadgeReview = { accepted: new Set(), rejected: new Set() };

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_SRC = `${sep}dist${sep}src${sep}`;
export const BADGE_REVIEW_DATA = resolve(HERE.includes(DIST_SRC) ? HERE.replace(DIST_SRC, `${sep}src${sep}`) : HERE, 'data', 'badge-review.v1.json');

export function validateBadgeDecisions(entries: unknown): { ok: BadgeDecision[]; problems: string[] } {
  if (!Array.isArray(entries)) return { ok: [], problems: ['entries must be an array'] };
  const ok: BadgeDecision[] = [];
  const problems: string[] = [];
  const verdicts = new Map<string, string>();
  entries.forEach((raw: unknown, index) => {
    const e = (raw ?? {}) as Partial<BadgeDecision>;
    if (typeof e.assetId !== 'string' || !e.assetId) { problems.push(`entry ${index}: assetId is required`); return; }
    if (typeof e.referent !== 'string' || !e.referent || referentOf(e.referent) !== e.referent) { problems.push(`entry ${index}: referent must be referentOf(label), got "${String(e.referent)}"`); return; }
    if (e.verdict !== 'accept' && e.verdict !== 'reject') { problems.push(`entry ${index}: verdict must be accept or reject`); return; }
    if (typeof e.reviewer !== 'string' || !e.reviewer.trim()) { problems.push(`entry ${index}: reviewer is required`); return; }
    if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) { problems.push(`entry ${index}: date must be YYYY-MM-DD`); return; }
    const key = reviewKey(e.assetId, e.referent);
    const prior = verdicts.get(key);
    if (prior !== undefined && prior !== e.verdict) { problems.push(`entry ${index}: conflicting verdicts for ${key}`); return; }
    verdicts.set(key, e.verdict);
    ok.push({ assetId: e.assetId, referent: e.referent, verdict: e.verdict, reviewer: e.reviewer, date: e.date, ...(typeof e.note === 'string' ? { note: e.note } : {}) });
  });
  return { ok, problems };
}

export function badgeReviewFrom(decisions: readonly BadgeDecision[]): BadgeReview {
  const keys = (verdict: BadgeDecision['verdict']) => new Set(decisions.filter((d) => d.verdict === verdict).map((d) => reviewKey(d.assetId, d.referent)));
  return { accepted: keys('accept'), rejected: keys('reject') };
}

let cached: BadgeReview | undefined;
export function loadBadgeReview(file: string = BADGE_REVIEW_DATA): BadgeReview {
  if (file === BADGE_REVIEW_DATA && cached) return cached;
  const { ok, problems } = validateBadgeDecisions((JSON.parse(readFileSync(file, 'utf8')) as { entries: unknown }).entries);
  if (problems.length) throw new Error(`badge review rejected: ${problems.join('; ')}`);
  const review = badgeReviewFrom(ok);
  if (file === BADGE_REVIEW_DATA) cached = review;
  return review;
}
