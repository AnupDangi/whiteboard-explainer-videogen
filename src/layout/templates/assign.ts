import type { IntrinsicSize } from '../measure.js';

export interface SlotAssignment {
  elementId: string;
  intrinsic: IntrinsicSize;
  slot?: string;
}

export interface SlotPlanEntry {
  name: string;
  capacity: number | 'many';
}

/**
 * Bucket elements into a template's declared slots. Elements with a matching
 * `slot` name win their bucket first (respecting capacity); anything left
 * over (no slot, unmatched slot name, or capacity overflow) fills the
 * remaining declared slots in template order, then spills into the last
 * `'many'` bucket. No element is ever dropped — an under-specified SceneSpec
 * degrades to a reasonable default arrangement instead of silently losing
 * content (a dropped element would itself be an unresolved-visual hard
 * failure).
 */
export function assignSlots(elements: SlotAssignment[], plan: SlotPlanEntry[]): Map<string, SlotAssignment[]> {
  const buckets = new Map<string, SlotAssignment[]>(plan.map((p) => [p.name, []]));
  const remaining: SlotAssignment[] = [];

  for (const el of elements) {
    const entry = plan.find((p) => p.name.toLowerCase() === el.slot?.toLowerCase());
    const bucket = entry ? buckets.get(entry.name)! : undefined;
    if (entry && bucket && (entry.capacity === 'many' || bucket.length < entry.capacity)) bucket.push(el);
    else remaining.push(el);
  }

  for (const p of plan) {
    if (remaining.length === 0) break;
    const bucket = buckets.get(p.name)!;
    while (remaining.length > 0 && (p.capacity === 'many' || bucket.length < p.capacity)) bucket.push(remaining.shift()!);
  }

  if (remaining.length > 0) {
    const many = plan.find((p) => p.capacity === 'many');
    const bucket = buckets.get((many ?? plan[plan.length - 1]).name)!;
    bucket.push(...remaining);
  }

  return buckets;
}
