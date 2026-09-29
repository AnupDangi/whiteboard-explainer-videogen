import type { SceneExemplar } from '../planner/exemplars.js';
import { SCENE_EXEMPLARS as BANK_V1 } from './exampleBank.v1.js';

/** v1 entries unchanged, plus template-complete, icon-rich structural demonstrations. Not lesson answers. */
const O = 'illustrative-example' as const;
const base = {
  sourceClass: 'hand-authored-example' as const, reviewStatus: 'experimental' as const, qualityScore: 0,
  provenance: { source: 'exampleBank.v2.ts', authoring: 'repository-authored structural demonstration', thirdPartyAssets: false, evaluationSplit: 'none' as const },
  review: { factuality: 'pending' as const, visual: 'pending' as const, license: 'pending' as const, leakage: 'pending' as const, human: 'pending' as const },
};

const BANK_V2_ADDITIONS: SceneExemplar[] = [
  { ...base, id: 'title-library-01', domain: 'libraries', teachingSkill: 'definition', visualMechanism: 'focus', complexity: 1,
    requiredCapabilities: ['text', 'tokenStrip'], inputIntent: { learningDelta: 'Introduce how a lending library moves one volume between readers' }, designRationale: ['one headline claim', 'a strip previews the steps'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'title_library_example', title: 'How A Library Lends', template: 'title_card', elements: [
      { id: 'headline', prim: 'text', slot: 'title', anchor: 'sceneStart', text: 'ONE VOLUME, MANY READERS', size: 'title', origin: O },
      { id: 'sub', prim: 'text', slot: 'subtitle', anchor: 'mention:loan', text: 'A LOAN IS A PROMISE TO RETURN', size: 'body', origin: O },
      { id: 'steps', prim: 'tokenStrip', slot: 'strip', anchor: 'mention:steps', tokens: ['FIND', 'BORROW', 'RETURN'], highlight: [1], origin: O },
    ], edges: [] } },
  { ...base, id: 'hub-rocket-01', domain: 'aerospace', teachingSkill: 'mechanism', visualMechanism: 'fan_out', complexity: 2,
    requiredCapabilities: ['object', 'pill'], inputIntent: { learningDelta: 'Show the parts that must work together to launch a vehicle' }, designRationale: ['the whole sits in the centre', 'each part points into the whole'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'hub_rocket_example', title: 'Three Parts Lift A Rocket', template: 'hub_spoke', elements: [
      { id: 'vehicle', prim: 'object', slot: 'hub', anchor: 'mention:vehicle', concept: 'rocket', label: 'ROCKET', fill: 'orange', origin: O },
      { id: 'fuel', prim: 'pill', slot: 'spoke', anchor: 'mention:fuel', text: 'FUEL', origin: O },
      { id: 'thrust', prim: 'pill', slot: 'spoke', anchor: 'mention:thrust', text: 'THRUST', origin: O },
      { id: 'steering', prim: 'pill', slot: 'spoke', anchor: 'mention:steering', text: 'STEERING', origin: O },
    ], edges: [{ from: 'fuel', to: 'vehicle', origin: O }, { from: 'thrust', to: 'vehicle', origin: O }, { from: 'steering', to: 'vehicle', origin: O }] } },
  { ...base, id: 'chain-delivery-02', domain: 'logistics', teachingSkill: 'process', visualMechanism: 'chain', complexity: 2,
    requiredCapabilities: ['object'], inputIntent: { learningDelta: 'Follow goods from where they are made to where they are sold' }, designRationale: ['concrete stages drawn as labelled icons', 'labelled arrows name each action'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'chain_delivery_example', title: 'From Maker To Shelf', template: 'chain', elements: [
      { id: 'maker', prim: 'object', slot: 'node', anchor: 'mention:maker', concept: 'factory plant', label: 'FACTORY', fill: 'grey', origin: O },
      { id: 'carrier', prim: 'object', slot: 'node', anchor: 'mention:carrier', concept: 'shipping truck', label: 'TRUCK', fill: 'blue', origin: O },
      { id: 'seller', prim: 'object', slot: 'node', anchor: 'mention:seller', concept: 'store', label: 'STORE', fill: 'yellow', origin: O },
    ], edges: [{ from: 'maker', to: 'carrier', label: 'LOADS', origin: O }, { from: 'carrier', to: 'seller', label: 'DELIVERS', origin: O }] } },
  { ...base, id: 'converge-kitchen-01', domain: 'cooking', teachingSkill: 'mechanism', visualMechanism: 'convergence', complexity: 3,
    requiredCapabilities: ['object', 'operator', 'meter'], inputIntent: { learningDelta: 'Show two conditions combining to decide when food is ready' }, designRationale: ['concrete inputs as icons', 'the result is a quantity, drawn as a meter'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'converge_kitchen_example', title: 'Heat And Time Cook Food', template: 'convergence', elements: [
      { id: 'heat', prim: 'object', slot: 'input', anchor: 'mention:heat', concept: 'thermometer', label: 'HEAT', fill: 'red', origin: O },
      { id: 'time', prim: 'object', slot: 'input', anchor: 'mention:time', concept: 'hourglass', label: 'TIME', fill: 'yellow', origin: O },
      { id: 'combine', prim: 'operator', slot: 'operator', anchor: 'after:time', symbol: '×', origin: O },
      { id: 'ready', prim: 'meter', slot: 'output', anchor: 'after:combine', values: [0.8], labels: ['DONENESS'], origin: O },
    ], edges: [{ from: 'heat', to: 'combine', origin: O }, { from: 'time', to: 'combine', origin: O }, { from: 'combine', to: 'ready', origin: O }] } },
  { ...base, id: 'fanout-newsletter-01', domain: 'communication', teachingSkill: 'mechanism', visualMechanism: 'fan_out', complexity: 2,
    requiredCapabilities: ['object', 'box'], inputIntent: { learningDelta: 'Show one message reaching many readers at once' }, designRationale: ['one source on the left', 'identical targets show a copy each'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'fanout_newsletter_example', title: 'One Send, Many Inboxes', template: 'fan_out', elements: [
      { id: 'send', prim: 'object', slot: 'source', anchor: 'mention:send', concept: 'mail send', label: 'NEWSLETTER', fill: 'blue', origin: O },
      { id: 'r1', prim: 'box', slot: 'target', anchor: 'mention:readers', text: 'READER A', origin: O },
      { id: 'r2', prim: 'box', slot: 'target', anchor: 'after:r1', text: 'READER B', origin: O },
      { id: 'r3', prim: 'box', slot: 'target', anchor: 'after:r2', text: 'READER C', origin: O },
    ], edges: [{ from: 'send', to: 'r1', origin: O }, { from: 'send', to: 'r2', origin: O }, { from: 'send', to: 'r3', origin: O }] } },
  { ...base, id: 'list-homesafety-01', domain: 'home safety', teachingSkill: 'application', visualMechanism: 'focus', complexity: 1,
    requiredCapabilities: ['object'], inputIntent: { learningDelta: 'List three independent habits that keep a home safe' }, designRationale: ['parallel items only because the narration lists them', 'each habit has its own icon'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'list_homesafety_example', title: 'Three Safe Habits', template: 'list_icon', elements: [
      { id: 'guard', prim: 'object', slot: 'item', anchor: 'mention:guard', concept: 'shield', label: 'PROTECT', fill: 'green', origin: O },
      { id: 'locked', prim: 'object', slot: 'item', anchor: 'mention:locked', concept: 'padlock square', label: 'LOCK UP', fill: 'yellow', origin: O },
      { id: 'alarm', prim: 'object', slot: 'item', anchor: 'mention:alarm', concept: 'bell', label: 'ALERT', fill: 'orange', origin: O },
    ], edges: [] } },
  { ...base, id: 'stack-storage-01', domain: 'computing', teachingSkill: 'process', visualMechanism: 'chain', complexity: 2,
    requiredCapabilities: ['box', 'object'], inputIntent: { learningDelta: 'Show a lookup passing down through storage layers until it finds data' }, designRationale: ['layers read top to bottom', 'arrows only between neighbours'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'stack_storage_example', title: 'A Lookup Goes Down', template: 'layered_stack', elements: [
      { id: 'app', prim: 'box', slot: 'layer', anchor: 'mention:app', text: 'APP', fill: 'purple', origin: O },
      { id: 'fastcopy', prim: 'box', slot: 'layer', anchor: 'mention:fastcopy', text: 'FAST COPY', fill: 'blue', origin: O },
      { id: 'store', prim: 'object', slot: 'layer', anchor: 'mention:store', concept: 'database server', label: 'DATABASE', fill: 'grey', origin: O },
    ], edges: [{ from: 'app', to: 'fastcopy', label: 'ASKS', origin: O }, { from: 'fastcopy', to: 'store', label: 'MISSES', style: 'dashed', origin: O }] } },
  { ...base, id: 'cycle-battery-01', domain: 'electronics', teachingSkill: 'process', visualMechanism: 'cycle', complexity: 2,
    requiredCapabilities: ['object', 'box'], inputIntent: { learningDelta: 'Show a rechargeable cell repeating the same stages' }, designRationale: ['stages in a ring', 'the last arrow closes the loop'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'cycle_battery_example', title: 'Charge, Use, Repeat', template: 'cycle', elements: [
      { id: 'charge', prim: 'object', slot: 'node', anchor: 'mention:charge', concept: 'battery charging', label: 'CHARGE', fill: 'green', origin: O },
      { id: 'hold', prim: 'box', slot: 'node', anchor: 'mention:hold', text: 'HOLD ENERGY', origin: O },
      { id: 'drain', prim: 'object', slot: 'node', anchor: 'mention:drain', concept: 'battery low', label: 'DRAIN', fill: 'red', origin: O },
    ], edges: [{ from: 'charge', to: 'hold', origin: O }, { from: 'hold', to: 'drain', origin: O }, { from: 'drain', to: 'charge', origin: O }] } },
  { ...base, id: 'formula-speed-01', domain: 'kinematics', teachingSkill: 'derivation', visualMechanism: 'equation', complexity: 3,
    requiredCapabilities: ['formula', 'text'], inputIntent: { learningDelta: 'Build the speed formula one term at a time' }, designRationale: ['each term appears when named', 'callouts explain the parts'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'formula_speed_example', title: 'Speed Is A Ratio', template: 'formula_focus', elements: [
      { id: 'eq', prim: 'formula', slot: 'formula', anchor: 'mention:speed', parts: [{ tex: 'v', anchor: 'mention:speed' }, { tex: '=' }, { tex: '\\frac{d}{t}', anchor: 'mention:ratio' }], origin: O },
      { id: 'dist', prim: 'text', slot: 'callout', anchor: 'mention:distance', text: 'D: DISTANCE COVERED', size: 'note', origin: O },
      { id: 'dur', prim: 'text', slot: 'callout', anchor: 'mention:duration', text: 'T: TIME TAKEN', size: 'note', origin: O },
    ], edges: [] } },
  { ...base, id: 'plot-cooling-01', domain: 'thermal physics', teachingSkill: 'mechanism', visualMechanism: 'trajectory', complexity: 2,
    requiredCapabilities: ['plot', 'text'], inputIntent: { learningDelta: 'Show a hot drink cooling quickly at first and then slowly' }, designRationale: ['the curve carries the change', 'a tangent shows the early rate'],
    sceneSpec: { schemaVersion: 'claude-scene-spec/v1', sceneId: 'plot_cooling_example', title: 'Cooling Slows Down', template: 'plot_focus', elements: [
      { id: 'curve', prim: 'plot', slot: 'plot', anchor: 'mention:curve', fn: 'exp', params: [60, -0.3, 20], domain: [0, 10], markers: [{ x: 0, label: 'HOT' }, { x: 8, label: 'NEAR ROOM' }], tangentAt: 1, tangentAnchor: 'mention:rate', xLabel: 'TIME', yLabel: 'TEMPERATURE', origin: O },
      { id: 'note', prim: 'text', slot: 'callout', anchor: 'after:curve', text: 'FAST AT FIRST, THEN SLOW', size: 'note', origin: O },
    ], edges: [] } },
];

export const SCENE_EXEMPLARS: readonly SceneExemplar[] = [...BANK_V1, ...BANK_V2_ADDITIONS];
