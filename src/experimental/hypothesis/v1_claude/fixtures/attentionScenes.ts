import type { SceneSpec } from '../types.js';

/**
 * Historical hand-authored renderer fixture. These SceneSpecs are not produced
 * by the Scene Planner and are retained only to exercise offline renderer
 * plumbing. They are excluded from generated-lesson and visual-quality claims.
 *
 * Raw narration (with `[[id|phrase]]` markers) lives alongside each spec so
 * the whole S4->S9 chain can run end to end in fixture mode.
 */

export const WHY_ATTENTION_RAW =
  '[[q|A query]] represents what [[token|one token]] is looking for when it reads the sentence.';

export const WHY_ATTENTION_SPEC: SceneSpec = {
  schemaVersion: 'claude-scene-spec/v1',
  sceneId: 'why_attention',
  title: 'Why Attention',
  template: 'title_card',
  elements: [
    { id: 'title', slot: 'title', anchor: 'sceneStart', prim: 'text', text: 'Why Attention', size: 'title' },
    { id: 'subtitle', slot: 'subtitle', anchor: 'mention:q', prim: 'text', text: 'A query looks for relevant tokens', size: 'body' },
    { id: 'strip', slot: 'strip', anchor: 'mention:token', prim: 'tokenStrip', tokens: ['THE', 'CAT', 'SAT', 'ON', 'THE', 'MAT'], highlight: [1] },
  ],
  edges: [],
};

export const QUERY_MEETS_KEYS_RAW =
  'The [[q|query]] compares itself with [[k1|the first key]], [[k2|the second key]], and [[k3|the third key]]. ' +
  'Their dot products become relevance [[softmax|scores]] once softmax normalizes them.';

export const QUERY_MEETS_KEYS_SPEC: SceneSpec = {
  schemaVersion: 'claude-scene-spec/v1',
  sceneId: 'query_meets_keys',
  title: 'Query Meets Keys',
  template: 'convergence',
  elements: [
    { id: 'query', slot: 'input', anchor: 'mention:q', prim: 'box', text: 'QUERY', fill: 'blue' },
    { id: 'key1', slot: 'input', anchor: 'mention:k1', prim: 'box', text: 'KEY 1', fill: 'yellow' },
    { id: 'key2', slot: 'input', anchor: 'mention:k2', prim: 'box', text: 'KEY 2', fill: 'yellow' },
    { id: 'key3', slot: 'input', anchor: 'mention:k3', prim: 'box', text: 'KEY 3', fill: 'yellow' },
    { id: 'dot', slot: 'operator', anchor: 'after:key3', prim: 'operator', symbol: '×' },
    { id: 'softmax', slot: 'output', anchor: 'after:dot', prim: 'operator', symbol: 'softmax' },
    { id: 'scores', slot: 'output', anchor: 'after:softmax', prim: 'meter', values: [0.1, 0.6, 0.3], labels: ['K1', 'K2', 'K3'], fill: 'orange' },
  ],
  edges: [
    { from: 'query', to: 'dot' },
    { from: 'key1', to: 'dot' },
    { from: 'key2', to: 'dot' },
    { from: 'key3', to: 'dot' },
    { from: 'dot', to: 'softmax' },
    { from: 'softmax', to: 'scores' },
  ],
  focus: ['scores'],
};

export const BLENDING_THE_VALUES_RAW =
  'Softmax weights blend [[v1|the first value]], [[v2|the second value]], and [[v3|the third value]] into one output vector.';

export const BLENDING_THE_VALUES_SPEC: SceneSpec = {
  schemaVersion: 'claude-scene-spec/v1',
  sceneId: 'blending_the_values',
  title: 'Blending the Values',
  template: 'weighted_blend',
  elements: [
    { id: 'v1', slot: 'input', anchor: 'mention:v1', prim: 'box', text: 'VALUE 1', fill: 'green' },
    { id: 'v2', slot: 'input', anchor: 'mention:v2', prim: 'box', text: 'VALUE 2', fill: 'green' },
    { id: 'v3', slot: 'input', anchor: 'mention:v3', prim: 'box', text: 'VALUE 3', fill: 'green' },
    { id: 'w1', slot: 'weight', anchor: 'after:v1', prim: 'text', text: '0.1', size: 'body' },
    { id: 'w2', slot: 'weight', anchor: 'after:v2', prim: 'text', text: '0.6', size: 'body' },
    { id: 'w3', slot: 'weight', anchor: 'after:v3', prim: 'text', text: '0.3', size: 'body' },
    { id: 'combine', slot: 'combiner', anchor: 'after:w3', prim: 'operator', symbol: 'Σ' },
    { id: 'result', slot: 'result', anchor: 'after:combine', prim: 'box', text: 'BLENDED OUTPUT', fill: 'purple' },
  ],
  edges: [
    { from: 'v1', to: 'combine' },
    { from: 'v2', to: 'combine' },
    { from: 'v3', to: 'combine' },
    { from: 'combine', to: 'result' },
  ],
  focus: ['result'],
};

export const ATTENTION_SCENES = [
  { sceneId: 'why_attention', raw: WHY_ATTENTION_RAW, spec: WHY_ATTENTION_SPEC },
  { sceneId: 'query_meets_keys', raw: QUERY_MEETS_KEYS_RAW, spec: QUERY_MEETS_KEYS_SPEC },
  { sceneId: 'blending_the_values', raw: BLENDING_THE_VALUES_RAW, spec: BLENDING_THE_VALUES_SPEC },
];
