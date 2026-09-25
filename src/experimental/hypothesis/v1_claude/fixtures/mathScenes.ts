import type { SceneSpec } from '../types.js';

/**
 * Renderer-first proof for math teaching (claude_pipeline.md §17 applied to
 * the Phase 3 math primitives): hand-authored SceneSpecs that must look and
 * teach well BEFORE the Scene Planner is asked to produce them. Narration is
 * paced like the Lamina reference (~18 s per scene, several mentions each —
 * harness/reference/lamina/OBSERVATIONS.md).
 *
 *  - M1 slope: a one-step idea (rise over run) in one scene.
 *  - M4 gradient descent: a multi-step idea across two scenes (the loss
 *    valley, then the update rule walked step by step on the same curve).
 */
export interface MathFixtureScene {
  caseId: string;
  sceneId: string;
  raw: string;
  spec: SceneSpec;
  /** Nominal scene length for fixture timing (real runs use aligned audio). */
  durationMs: number;
}

const pythagoras: MathFixtureScene = {
  caseId: 'math-pythagoras',
  sceneId: 'pythagoras_squares',
  durationMs: 18000,
  raw:
    'Here is [[triangle|a right triangle]]. Its two shorter sides are [[legs|the legs]], a and b, and the long side across from the right angle is [[hyp|the hypotenuse]], c. ' +
    'Build a square on each side. [[area_a|The square on a]] plus [[area_b|the square on b]] exactly fills [[area_c|the square on c]]. ' +
    'That is [[theorem|the Pythagorean theorem]].',
  spec: {
    schemaVersion: 'claude-scene-spec/v1',
    sceneId: 'pythagoras_squares',
    title: 'Squares On The Sides',
    template: 'hub_spoke',
    elements: [
      { id: 'tri', slot: 'hub', anchor: 'mention:triangle', prim: 'shape', kind: 'rightTriangle', sideLabels: ['a', 'b', 'c'], fill: 'yellow' },
      { id: 'sq_a', slot: 'spoke', anchor: 'mention:area_a', prim: 'shape', kind: 'square', text: 'a²', fill: 'blue' },
      { id: 'sq_b', slot: 'spoke', anchor: 'mention:area_b', prim: 'shape', kind: 'square', text: 'b²', fill: 'green' },
      { id: 'sq_c', slot: 'spoke', anchor: 'mention:area_c', prim: 'shape', kind: 'square', text: 'c²', fill: 'orange' },
      { id: 'rule', slot: 'spoke', anchor: 'mention:theorem', prim: 'formula', parts: [{ tex: 'a^2 + b^2' }, { tex: '= c^2', anchor: 'mention:theorem' }] },
    ],
    edges: [
      { from: 'tri', to: 'sq_a', label: 'side a' },
      { from: 'tri', to: 'sq_b', label: 'side b' },
      { from: 'tri', to: 'sq_c', label: 'side c' },
    ],
    focus: ['rule'],
  },
};

const valley = { fn: 'quadratic' as const, params: [0.5, 0, 0.4], domain: [-4, 4] as [number, number] };

export const MATH_SCENES: MathFixtureScene[] = [
  pythagoras,
  {
    caseId: 'math-slope',
    sceneId: 'slope_rise_over_run',
    durationMs: 18000,
    raw:
      '[[line|A straight line]] climbs at a steady rate. Pick [[points|two points]] on it. ' +
      'The horizontal change between them is [[run|the run]], and the vertical change is [[rise|the rise]]. ' +
      'Divide the rise by the run and you get [[slope|the slope]], and it is [[same|the same everywhere]] on the line.',
    spec: {
      schemaVersion: 'claude-scene-spec/v1',
      sceneId: 'slope_rise_over_run',
      title: 'Slope Is Rise Over Run',
      template: 'plot_focus',
      elements: [
        {
          id: 'line', slot: 'plot', anchor: 'mention:line', prim: 'plot', fn: 'linear', params: [0.6, 1], domain: [0, 8],
          markers: [{ x: 2, label: 'A' }, { x: 6, label: 'B' }], riseRun: [2, 6], riseRunAnchor: 'mention:run', xLabel: 'x', yLabel: 'y',
        },
        { id: 'rule', slot: 'formula', anchor: 'mention:rise', prim: 'formula', parts: [{ tex: 'm =' }, { tex: '\\dfrac{\\text{rise}}{\\text{run}}', anchor: 'mention:slope' }] },
        { id: 'same', slot: 'callout', anchor: 'mention:same', prim: 'text', text: 'Same everywhere', size: 'body' },
      ],
      edges: [],
      focus: ['rule'],
    },
  },
  {
    caseId: 'math-gradient-descent',
    sceneId: 'gd_loss_valley',
    durationMs: 18000,
    raw:
      'Every choice of [[param|a parameter]] gives [[loss|a loss]], a number that says how wrong the model is. ' +
      'Plot them and you get [[valley|a valley]]. We start partway up the side, at [[start|this point]], ' +
      'and the goal is [[bottom|the bottom]], where the loss is smallest.',
    spec: {
      schemaVersion: 'claude-scene-spec/v1',
      sceneId: 'gd_loss_valley',
      title: 'The Loss Valley',
      template: 'plot_focus',
      elements: [
        { id: 'curve', slot: 'plot', anchor: 'mention:valley', prim: 'plot', ...valley, markers: [{ x: 3, label: 'start' }], xLabel: 'parameter', yLabel: 'loss' },
        { id: 'wrong', slot: 'callout', anchor: 'mention:loss', prim: 'text', text: 'Loss = how wrong', size: 'body' },
        { id: 'goal', slot: 'callout', anchor: 'mention:bottom', prim: 'object', concept: 'trophy', label: 'Lowest loss', fill: 'yellow' },
      ],
      edges: [],
    },
  },
  {
    caseId: 'math-gradient-descent',
    sceneId: 'gd_update_rule',
    durationMs: 20000,
    raw:
      'The [[gradient|gradient]] is the slope under our feet, and it points uphill. So we step the other way. ' +
      'The new value is [[current|the current value]] minus [[rate|a small step size]] times [[grad2|the gradient]]. ' +
      'Repeat it, and [[steps|the steps]] shrink as we settle into [[min|the minimum]].',
    spec: {
      schemaVersion: 'claude-scene-spec/v1',
      sceneId: 'gd_update_rule',
      title: 'Step Against The Slope',
      template: 'plot_focus',
      elements: [
        {
          id: 'curve', slot: 'plot', anchor: 'sceneStart', prim: 'plot', ...valley, xLabel: 'parameter', yLabel: 'loss',
          tangentAt: 3, tangentAnchor: 'mention:gradient', trajectory: [3, 1.9, 1.2, 0.7, 0.35], stepsAnchor: 'mention:steps',
        },
        {
          id: 'update', slot: 'formula', anchor: 'mention:current', prim: 'formula',
          parts: [
            { tex: '\\theta_{t+1} =' },
            { tex: '\\theta_t', anchor: 'mention:current' },
            { tex: '-\\,\\eta', anchor: 'mention:rate' },
            { tex: '\\nabla L(\\theta_t)', anchor: 'mention:grad2' },
          ],
        },
        { id: 'downhill', slot: 'callout', anchor: 'after:update', prim: 'text', text: 'Step downhill', size: 'body' },
        { id: 'minimum', slot: 'callout', anchor: 'mention:min', prim: 'text', text: 'Minimum', size: 'body' },
      ],
      edges: [],
      focus: ['update'],
    },
  },
];
