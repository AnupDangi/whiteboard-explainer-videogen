import type { LaidOutScene, Timeline } from '../shared/types.js';
import { stablePositionViolations } from './boardMetrics.js';
import type { IconAudit } from './iconAudit.js';

/**
 * Automated subset of the Simi teaching rubric (SIMI_TEACHING_BENCHMARK_CONTEXT §52), each item 0-2.
 * These are structural PROXIES computed from the locked artifacts. They do not replace the human
 * muted-board protocol (final_plan/04 §25): `mute test` here is only "is there a pictorial/diagram
 * vocabulary plus relation coverage", and the score says so.
 */
export interface RubricItem { key: string; score: 0 | 1 | 2; basis: string }
export interface RubricInput {
  scenes: Array<{ laidOut: LaidOutScene; timeline: Timeline }>;
  audit: IconAudit;
  metrics: { majorClaimVisualCoverage?: number; relationCoverage?: number };
}

const grade = (value: number, good: number, ok: number): 0 | 1 | 2 => (value >= good ? 2 : value >= ok ? 1 : 0);

export function scoreSimiRubric(input: RubricInput): { items: RubricItem[]; total: number; max: number } {
  const items: RubricItem[] = [];
  // Progressive reveal: at the midpoint the board must still be meaningfully incomplete.
  const lateShare = input.scenes.map(({ timeline }) => {
    const reveals = timeline.events.filter((event) => event.track !== 'hold' && event.track !== 'emphasis');
    const mid = timeline.sceneStartMs + (timeline.sceneEndMs - timeline.sceneStartMs) / 2;
    return reveals.length ? reveals.filter((event) => event.t0 >= mid).length / reveals.length : 0;
  });
  const meanLate = lateShare.length ? lateShare.reduce((a, b) => a + b, 0) / lateShare.length : 0;
  items.push({ key: 'progressive-reveal', score: grade(meanLate, 0.3, 0.15), basis: `${(meanLate * 100).toFixed(0)}% of reveals happen after the scene midpoint` });
  const coverage = input.metrics.majorClaimVisualCoverage ?? 0;
  items.push({ key: 'critical-claim-coverage', score: grade(coverage, 0.9, 0.6), basis: `major-claim visual coverage ${(coverage * 100).toFixed(0)}%` });
  const edges = input.scenes.flatMap(({ laidOut }) => laidOut.edges);
  const labelled = edges.length ? edges.filter((edge) => edge.label).length / edges.length : 1;
  items.push({ key: 'relationship-clarity', score: edges.length === 0 ? 0 : grade(1 - labelled, 0.8, 0.5), basis: `${edges.length} arrows, ${(labelled * 100).toFixed(0)}% carry printed verbs` });
  // Measured over every concept node on the board: a box the planner left as text is a fallback even though it is not an object element.
  const pictureShare = input.audit.summary.pictureShareOfConceptNodes;
  items.push({ key: 'fallback-quality', score: grade(pictureShare, 0.6, 0.4), basis: `${(pictureShare * 100).toFixed(0)}% of ${input.audit.summary.conceptNodes} concept nodes are pictures or diagrams; the rest are labelled boxes or text` });
  let violations = 0;
  input.scenes.forEach(({ laidOut }, index) => { violations += stablePositionViolations(input.scenes[index - 1]?.laidOut, laidOut); });
  // A concept drawn in two consecutive scenes should sit where the learner last saw it (benchmark §5), carried or not.
  let recurring = 0;
  let moved = 0;
  input.scenes.forEach(({ laidOut }, index) => {
    const previous = input.scenes[index - 1]?.laidOut;
    if (!previous) return;
    const before = new Map(previous.elements.flatMap((element) => (element.element.conceptIds ?? []).map((id) => [id, element.bbox] as const)));
    for (const element of laidOut.elements) {
      const was = (element.element.conceptIds ?? []).map((id) => before.get(id)).find(Boolean);
      if (!was) continue;
      recurring += 1;
      if (Math.abs(was.x - element.bbox.x) > 40 || Math.abs(was.y - element.bbox.y) > 40) moved += 1;
    }
  });
  const stable = violations === 0 && (recurring === 0 || moved / recurring <= 0.25);
  items.push({ key: 'spatial-stability', score: violations > 2 || (recurring > 0 && moved / recurring > 0.6) ? 0 : stable ? 2 : 1, basis: `${violations} carried elements moved; ${moved} of ${recurring} concepts that recur in the next scene sit elsewhere` });
  const vocabulary = pictureShare;
  const relations = input.metrics.relationCoverage ?? coverage;
  items.push({ key: 'mute-test-proxy', score: vocabulary >= 0.4 && relations >= 0.9 ? 2 : vocabulary >= 0.2 && relations >= 0.6 ? 1 : 0, basis: `pictorial+diagram ${(vocabulary * 100).toFixed(0)}%, relation coverage ${(relations * 100).toFixed(0)}%; a proxy, not the human protocol` });
  const wrong = input.audit.summary.wrongBindingSuspects.length;
  items.push({ key: 'visual-correctness-suspects', score: wrong === 0 ? 2 : wrong <= 2 ? 1 : 0, basis: `${wrong} binding(s) flagged for human review` });
  const total = items.reduce((sum, item) => sum + item.score, 0);
  return { items, total, max: items.length * 2 };
}
