import type { SceneExemplar } from '../planner/exemplars.js';

/** Cross-domain structural examples, not target lesson answers or frozen evaluation fixtures. */
export const SCENE_EXEMPLARS: readonly SceneExemplar[] = [
  {
    id: 'flow-transport-01', sourceClass: 'hand-authored-example', reviewStatus: 'experimental', provenance: { source: 'exampleBank.v1.ts', authoring: 'repository-authored structural demonstration', thirdPartyAssets: false, evaluationSplit: 'none' }, review: { factuality: 'pending', visual: 'pending', license: 'pending', leakage: 'pending', human: 'pending' }, domain: 'logistics', teachingSkill: 'process', visualMechanism: 'chain', complexity: 2, qualityScore: 0,
    requiredCapabilities: ['box', 'operator'], inputIntent: { learningDelta: 'Trace a package through a transfer process' }, designRationale: ['stages read left to right', 'arrows carry the mechanism'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'flow_transport_example', title: 'A Package Changes Hands', template: 'chain', elements: [
      { id: 'sender', prim: 'box', slot: 'node', anchor: 'mention:sender', text: 'SENDER', origin: 'illustrative-example' },
      { id: 'depot', prim: 'box', slot: 'node', anchor: 'mention:depot', text: 'DEPOT', origin: 'illustrative-example' },
      { id: 'receiver', prim: 'box', slot: 'node', anchor: 'mention:receiver', text: 'RECEIVER', origin: 'illustrative-example' },
    ], edges: [{ from: 'sender', to: 'depot', origin: 'illustrative-example' }, { from: 'depot', to: 'receiver', origin: 'illustrative-example' }] },
  },
  {
    id: 'converge-sensors-01', sourceClass: 'hand-authored-example', reviewStatus: 'experimental', provenance: { source: 'exampleBank.v1.ts', authoring: 'repository-authored structural demonstration', thirdPartyAssets: false, evaluationSplit: 'none' }, review: { factuality: 'pending', visual: 'pending', license: 'pending', leakage: 'pending', human: 'pending' }, domain: 'engineering', teachingSkill: 'mechanism', visualMechanism: 'convergence', complexity: 3, qualityScore: 0,
    requiredCapabilities: ['box', 'operator'], inputIntent: { learningDelta: 'Show multiple sensor readings combining into one decision' }, designRationale: ['inputs converge on an operation', 'output appears after inputs'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'converge_sensors_example', title: 'Readings Guide A Decision', template: 'convergence', elements: [
      { id: 'heat', prim: 'box', slot: 'input', anchor: 'mention:heat', text: 'HEAT', origin: 'illustrative-example' },
      { id: 'light', prim: 'box', slot: 'input', anchor: 'mention:light', text: 'LIGHT', origin: 'illustrative-example' },
      { id: 'combine', prim: 'operator', slot: 'operator', anchor: 'after:light', symbol: 'Σ', origin: 'illustrative-example' },
      { id: 'decision', prim: 'box', slot: 'output', anchor: 'after:combine', text: 'DECISION', origin: 'illustrative-example' },
    ], edges: [{ from: 'heat', to: 'combine', origin: 'illustrative-example' }, { from: 'light', to: 'combine', origin: 'illustrative-example' }, { from: 'combine', to: 'decision', origin: 'illustrative-example' }] },
  },
  {
    id: 'compare-materials-01', sourceClass: 'hand-authored-example', reviewStatus: 'experimental', provenance: { source: 'exampleBank.v1.ts', authoring: 'repository-authored structural demonstration', thirdPartyAssets: false, evaluationSplit: 'none' }, review: { factuality: 'pending', visual: 'pending', license: 'pending', leakage: 'pending', human: 'pending' }, domain: 'materials', teachingSkill: 'comparison', visualMechanism: 'comparison', complexity: 1, qualityScore: 0,
    requiredCapabilities: ['box'], inputIntent: { learningDelta: 'Compare two materials on one stated property' }, designRationale: ['two alternatives share one visual scale', 'the deciding property is visible'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'compare_materials_example', title: 'Which Holds More Heat', template: 'compare_2', elements: [
      { id: 'tile_a', prim: 'box', slot: 'left', anchor: 'mention:tile_a', text: 'TILE A', origin: 'illustrative-example' },
      { id: 'tile_b', prim: 'box', slot: 'right', anchor: 'mention:tile_b', text: 'TILE B', origin: 'illustrative-example' },
      { id: 'measure', prim: 'box', slot: 'verdict', anchor: 'mention:measure', text: 'HEAT HELD', origin: 'illustrative-example' },
    ], edges: [] },
  },
  {
    id: 'threshold-thermostat-01', sourceClass: 'hand-authored-example', reviewStatus: 'experimental', provenance: { source: 'exampleBank.v1.ts', authoring: 'repository-authored structural demonstration', thirdPartyAssets: false, evaluationSplit: 'none' }, review: { factuality: 'pending', visual: 'pending', license: 'pending', leakage: 'pending', human: 'pending' }, domain: 'controls', teachingSkill: 'mechanism', visualMechanism: 'threshold', complexity: 2, qualityScore: 0,
    requiredCapabilities: ['box', 'meter'], inputIntent: { learningDelta: 'Show how a reading crosses a control threshold' }, designRationale: ['threshold is a visible boundary', 'state change follows crossing'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'threshold_thermostat_example', title: 'A Reading Crosses The Limit', template: 'threshold', elements: [
      { id: 'reading', prim: 'box', slot: 'subject', anchor: 'mention:reading', text: 'READING', origin: 'illustrative-example' },
      { id: 'bar', prim: 'meter', slot: 'bar', anchor: 'mention:limit', values: [0.7], labels: ['LIMIT'], origin: 'illustrative-example' },
      { id: 'state', prim: 'box', slot: 'marker', anchor: 'after:bar', text: 'ON', origin: 'illustrative-example' },
    ], edges: [{ from: 'bar', to: 'state', origin: 'illustrative-example' }] },
  },
  {
    id: 'weight-supplies-01', sourceClass: 'hand-authored-example', reviewStatus: 'experimental', provenance: { source: 'exampleBank.v1.ts', authoring: 'repository-authored structural demonstration', thirdPartyAssets: false, evaluationSplit: 'none' }, review: { factuality: 'pending', visual: 'pending', license: 'pending', leakage: 'pending', human: 'pending' }, domain: 'operations', teachingSkill: 'mechanism', visualMechanism: 'weighted_blend', complexity: 3, qualityScore: 0,
    requiredCapabilities: ['box', 'operator', 'text'], inputIntent: { learningDelta: 'Show different contributions combining into a total' }, designRationale: ['weights sit beside inputs', 'one result follows the combination'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'weight_supplies_example', title: 'Contributions Make A Total', template: 'weighted_blend', elements: [
      { id: 'a', prim: 'box', slot: 'input', anchor: 'mention:a', text: 'SOURCE A', origin: 'illustrative-example' },
      { id: 'b', prim: 'box', slot: 'input', anchor: 'mention:b', text: 'SOURCE B', origin: 'illustrative-example' },
      { id: 'wa', prim: 'text', slot: 'weight', anchor: 'after:a', text: 'ONE PART', size: 'body', origin: 'illustrative-example' },
      { id: 'wb', prim: 'text', slot: 'weight', anchor: 'after:b', text: 'TWO PARTS', size: 'body', origin: 'illustrative-example' },
      { id: 'sum', prim: 'operator', slot: 'combiner', anchor: 'after:wb', symbol: 'Σ', origin: 'illustrative-example' },
      { id: 'total', prim: 'box', slot: 'result', anchor: 'after:sum', text: 'TOTAL', origin: 'illustrative-example' },
    ], edges: [{ from: 'a', to: 'sum', origin: 'illustrative-example' }, { from: 'b', to: 'sum', origin: 'illustrative-example' }, { from: 'sum', to: 'total', origin: 'illustrative-example' }] },
  },
];
