import type {NodeKind} from './vocabulary.js';
/** Central design tokens. The LLM never invents colors, sizes or spacing — consistency
 *  comes from the renderer reading this one module, per the replication target's
 *  "visual consistency across scenes" requirement. */
export const INK = '#243a41';
export const STROKE = {border: 2.8, emphasis: 4.2, connector: 3.2, icon: 2.4};
// Base fill cycle (unchanged from the original palette) plus a handful of semantic
// accent strokes layered on top for kinds where a consistent color carries real meaning.
export const PALETTE = ['#d9edf4', '#e6dff5', '#f9ebbd', '#dbecdd', '#f6ded4'];
export const KIND_ACCENT: Partial<Record<NodeKind, string>> = {
  question: '#2f6fa8', key: '#a8791f', container: '#2f8f5b',
  success: '#2f8f5b', warning: '#b3401f', database: '#5b4fa8',
  attract: '#2f8f5b', repel: '#b3401f',
};
