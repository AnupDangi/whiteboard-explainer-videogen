import type {NodeKind} from './vocabulary.js';
/** Central design tokens. The LLM never invents colors, sizes or spacing — consistency
 *  comes from the renderer reading this one module, per the replication target's
 *  "visual consistency across scenes" requirement. */
export const STROKE = {border: 2.8, emphasis: 4.2, connector: 3.2, icon: 2.4};
// A handful of semantic accent strokes layered on top for kinds where a consistent
// color carries real meaning.
export const KIND_ACCENT: Partial<Record<NodeKind, string>> = {
  question: '#2f6fa8', key: '#a8791f', container: '#2f8f5b',
  success: '#2f8f5b', warning: '#b3401f', database: '#5b4fa8',
  attract: '#2f8f5b', repel: '#b3401f',
};
export const SEMANTIC_COLORS: Record<string, string> = {
  user: '#4a90d9', database: '#7c5cbf', model: '#e8725a', cloud: '#5bb8f5',
  memory: '#f5a623', search: '#7ed321', api: '#50e3c2', server: '#b8e986',
  agent: '#d0021b', process: '#f8e71c', input: '#7ed321', output: '#f5a623',
  loop: '#bd10e0', choice: '#ff6b6b', result: '#2f8f5b', success: '#2f8f5b',
  warning: '#b3401f', energy: '#ff9f43', light: '#feca57', temperature: '#ff6b6b',
  attract: '#2f8f5b', repel: '#b3401f', idea: '#a29bfe', equation: '#6c5ce7',
  probability: '#fd79a8', graph: '#00b894', matrix: '#6c5ce7', vector: '#00cec9',
  token: '#fdcb6e', brain: '#e84393', lock: '#2d3436', question: '#2f6fa8',
  key: '#a8791f', container: '#2f8f5b', document: '#74b9ff', file: '#a29bfe',
  image: '#fd79a8', request: '#00b894', response: '#fdcb6e', note: '#dfe6e9',
  tool: '#636e72', cycle: '#00b894', molecule: '#6c5ce7', atom: '#fd79a8',
  cell: '#55efc4', plant: '#00b894', sun: '#fdcb6e', browser: '#74b9ff',
  phone: '#a29bfe', robot: '#dfe6e9', pipeline: '#636e72', teacher: '#e8725a',
  student: '#4a90d9', book: '#a8791f', example: '#00cec9', generic: '#b2bec3',
};
