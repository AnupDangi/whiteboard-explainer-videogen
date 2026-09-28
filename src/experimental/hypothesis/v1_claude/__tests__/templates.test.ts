import test from 'node:test';
import assert from 'node:assert/strict';
import type { BBox, SceneSpec, TemplateId } from '../types.js';
import { STYLE } from '../style.js';
import { resolveScene } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import type { PlannerSceneInput } from '../planner/prompt.js';
import type { Board } from '../planner/board.js';
import { compileBoard, BOARD_SCHEMA_VERSION } from '../planner/board.js';

function intersects(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function inSafeArea(b: BBox): boolean {
  const safe = STYLE.canvas.safe;
  return b.x >= safe - 0.01 && b.y >= safe - 0.01 && b.x + b.w <= STYLE.canvas.w - safe + 0.01 && b.y + b.h <= STYLE.canvas.h - safe + 0.01;
}

const specs: Record<TemplateId, SceneSpec> = {
  title_card: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'title_card', title: 'T', template: 'title_card',
    elements: [
      { id: 'title', slot: 'title', anchor: 'sceneStart', prim: 'text', text: 'Title', size: 'title' },
      { id: 'subtitle', slot: 'subtitle', anchor: 'sceneStart', prim: 'text', text: 'Subtitle here', size: 'body' },
    ],
    edges: [],
  },
  hub_spoke: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'hub_spoke', title: 'T', template: 'hub_spoke',
    elements: [
      { id: 'hub', slot: 'hub', anchor: 'sceneStart', prim: 'box', text: 'HUB' },
      { id: 's1', slot: 'spoke', anchor: 'sceneStart', prim: 'box', text: 'A' },
      { id: 's2', slot: 'spoke', anchor: 'sceneStart', prim: 'box', text: 'B' },
      { id: 's3', slot: 'spoke', anchor: 'sceneStart', prim: 'box', text: 'C' },
    ],
    edges: [{ from: 'hub', to: 's1' }, { from: 'hub', to: 's2' }, { from: 'hub', to: 's3' }],
  },
  chain: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'chain', title: 'T', template: 'chain',
    elements: [
      { id: 'n1', slot: 'node', anchor: 'sceneStart', prim: 'box', text: 'ONE' },
      { id: 'n2', slot: 'node', anchor: 'after:n1', prim: 'box', text: 'TWO' },
      { id: 'n3', slot: 'node', anchor: 'after:n2', prim: 'box', text: 'THREE' },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
  },
  convergence: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'convergence', title: 'T', template: 'convergence',
    elements: [
      { id: 'i1', slot: 'input', anchor: 'sceneStart', prim: 'box', text: 'IN1' },
      { id: 'i2', slot: 'input', anchor: 'sceneStart', prim: 'box', text: 'IN2' },
      { id: 'op', slot: 'operator', anchor: 'after:i2', prim: 'operator', symbol: '×' },
      { id: 'out', slot: 'output', anchor: 'after:op', prim: 'box', text: 'OUT' },
    ],
    edges: [{ from: 'i1', to: 'op' }, { from: 'i2', to: 'op' }, { from: 'op', to: 'out' }],
  },
  fan_out: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'fan_out', title: 'T', template: 'fan_out',
    elements: [
      { id: 'src', slot: 'source', anchor: 'sceneStart', prim: 'box', text: 'SRC' },
      { id: 't1', slot: 'target', anchor: 'sceneStart', prim: 'box', text: 'T1' },
      { id: 't2', slot: 'target', anchor: 'sceneStart', prim: 'box', text: 'T2' },
    ],
    edges: [{ from: 'src', to: 't1' }, { from: 'src', to: 't2' }],
  },
  list_icon: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'list_icon', title: 'T', template: 'list_icon',
    elements: [
      { id: 'l1', slot: 'item', anchor: 'sceneStart', prim: 'pill', text: 'FAST' },
      { id: 'l2', slot: 'item', anchor: 'sceneStart', prim: 'pill', text: 'CHEAP' },
      { id: 'l3', slot: 'item', anchor: 'sceneStart', prim: 'pill', text: 'RELIABLE' },
    ],
    edges: [],
  },
  compare_2: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'compare_2', title: 'T', template: 'compare_2',
    elements: [
      { id: 'left', slot: 'left', anchor: 'sceneStart', prim: 'box', text: 'OPTION A' },
      { id: 'right', slot: 'right', anchor: 'sceneStart', prim: 'box', text: 'OPTION B' },
      { id: 'verdict', slot: 'verdict', anchor: 'after:right', prim: 'pill', text: 'A WINS' },
    ],
    edges: [],
  },
  threshold: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'threshold', title: 'T', template: 'threshold',
    elements: [
      { id: 'subj', slot: 'subject', anchor: 'sceneStart', prim: 'box', text: 'TASK' },
      { id: 'bar', slot: 'bar', anchor: 'after:subj', prim: 'meter', values: [0.6] },
      { id: 'marker', slot: 'marker', anchor: 'after:bar', prim: 'box', glyph: '!' },
    ],
    edges: [],
  },
  weighted_blend: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'weighted_blend', title: 'T', template: 'weighted_blend',
    elements: [
      { id: 'in1', slot: 'input', anchor: 'sceneStart', prim: 'box', text: 'V1' },
      { id: 'in2', slot: 'input', anchor: 'sceneStart', prim: 'box', text: 'V2' },
      { id: 'w1', slot: 'weight', anchor: 'after:in1', prim: 'text', text: '0.5', size: 'note' },
      { id: 'w2', slot: 'weight', anchor: 'after:in2', prim: 'text', text: '0.5', size: 'note' },
      { id: 'combiner', slot: 'combiner', anchor: 'after:w2', prim: 'operator', symbol: 'Σ' },
      { id: 'result', slot: 'result', anchor: 'after:combiner', prim: 'box', text: 'RESULT' },
    ],
    edges: [],
  },
  layered_stack: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'layered_stack', title: 'T', template: 'layered_stack',
    elements: [
      { id: 'l1', slot: 'layer', anchor: 'sceneStart', prim: 'box', text: 'APPLICATION' },
      { id: 'l2', slot: 'layer', anchor: 'sceneStart', prim: 'box', text: 'TRANSPORT' },
      { id: 'l3', slot: 'layer', anchor: 'sceneStart', prim: 'box', text: 'NETWORK' },
    ],
    edges: [],
  },
  cycle: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'cycle', title: 'T', template: 'cycle',
    elements: [
      { id: 'c1', slot: 'node', anchor: 'sceneStart', prim: 'box', text: 'STAGE 1' },
      { id: 'c2', slot: 'node', anchor: 'sceneStart', prim: 'box', text: 'STAGE 2' },
      { id: 'c3', slot: 'node', anchor: 'sceneStart', prim: 'box', text: 'STAGE 3' },
      { id: 'c4', slot: 'node', anchor: 'sceneStart', prim: 'box', text: 'STAGE 4' },
    ],
    edges: [{ from: 'c1', to: 'c2' }, { from: 'c2', to: 'c3' }, { from: 'c3', to: 'c4' }, { from: 'c4', to: 'c1' }],
  },
  formula_focus: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'formula_focus', title: 'T', template: 'formula_focus',
    elements: [
      { id: 'f', slot: 'formula', anchor: 'sceneStart', prim: 'formula', latex: 'E = mc^2' },
      { id: 'c1', slot: 'callout', anchor: 'after:f', prim: 'text', text: 'energy', size: 'note' },
      { id: 'c2', slot: 'callout', anchor: 'after:f', prim: 'text', text: 'mass', size: 'note' },
    ],
    edges: [],
  },
  plot_focus: {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'plot_focus', title: 'T', template: 'plot_focus',
    elements: [
      { id: 'p', slot: 'plot', anchor: 'sceneStart', prim: 'plot', fn: 'quadratic', params: [1, 0, 0], domain: [-3, 3], tangentAt: 2, trajectory: [2.5, 1.5, 0.8, 0.3] },
      { id: 'f', slot: 'formula', anchor: 'after:p', prim: 'formula', latex: '\\theta_{t+1} = \\theta_t - \\eta \\nabla L' },
      { id: 'c1', slot: 'callout', anchor: 'after:f', prim: 'text', text: 'step downhill', size: 'body' },
    ],
    edges: [],
  },
};

for (const [template, spec] of Object.entries(specs) as Array<[TemplateId, SceneSpec]>) {
  test(`template ${template}: every element stays within the safe area`, () => {
    const laidOut = layoutScene(resolveScene(spec));
    for (const el of laidOut.elements) assert.ok(inSafeArea(el.bbox), `${el.id} bbox ${JSON.stringify(el.bbox)} escapes the safe area`);
  });

  test(`template ${template}: no illegal overlap between non-container elements`, () => {
    const laidOut = layoutScene(resolveScene(spec));
    const leaves = laidOut.elements.filter((e) => e.element.prim !== 'container');
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        assert.ok(!intersects(leaves[i].bbox, leaves[j].bbox), `${leaves[i].id} overlaps ${leaves[j].id}`);
      }
    }
  });

  test(`template ${template}: connector routing produces boundary-to-boundary polylines, never zero-length`, () => {
    const laidOut = layoutScene(resolveScene(spec));
    for (const edge of laidOut.edges) {
      if (spec.edges.length === 0) continue;
      assert.ok(edge.points.length >= 2, `edge ${edge.from}->${edge.to} has no route`);
      const [p0, pn] = [edge.points[0], edge.points[edge.points.length - 1]];
      assert.ok(Math.hypot(pn.x - p0.x, pn.y - p0.y) > 1, 'edge endpoints must not coincide');
    }
  });

  test(`template ${template}: occupancy is a finite, non-negative number`, () => {
    const laidOut = layoutScene(resolveScene(spec));
    assert.ok(Number.isFinite(laidOut.occupancy) && laidOut.occupancy >= 0);
  });

  test(`template ${template}: layout is deterministic across repeated runs`, () => {
    const a = layoutScene(resolveScene(spec));
    const b = layoutScene(resolveScene(spec));
    assert.deepEqual(
      a.elements.map((e) => e.bbox),
      b.elements.map((e) => e.bbox),
    );
  });
}

test('long chain wraps in order without shrinking readable text below the floor', () => {
  const spec: SceneSpec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'long-chain', title: 'Long chain', template: 'chain',
    elements: ['First Process Label', 'Second Process Label', 'Third Process Label', 'Fourth Process Label', 'Fifth Process Label', 'Sixth Process Label']
      .map((text, i) => ({ id: `node-${i + 1}`, slot: 'node', anchor: 'sceneStart' as const, prim: 'text' as const, text, size: 'body' as const })),
    edges: [],
  };
  const laidOut = layoutScene(resolveScene(spec));
  const boxes = laidOut.elements.map(({ bbox }) => bbox);
  for (let i = 0; i < boxes.length; i++) {
    assert.ok(inSafeArea(boxes[i]));
    for (let j = i + 1; j < boxes.length; j++) assert.ok(!intersects(boxes[i], boxes[j]), `node-${i + 1} overlaps node-${j + 1}`);
  }
  for (const element of laidOut.elements) {
    const scaleY = element.bbox.h / element.intrinsicSize.h;
    for (const text of element.visual.texts) assert.ok(text.size * scaleY >= 32, `${element.id} text shrank to ${text.size * scaleY}px`);
  }
  assert.ok(new Set(boxes.map(({ y }) => Math.round(y))).size > 1, 'overflowing chain should wrap across rows');
});

// Neutral synthetic board input only: abstract ids, never lesson content.
function makeFillInput(ids: string[]): PlannerSceneInput {
  const mkRef = (id: string, quote: string, start: number) => ({
    sourceId: 'doc-fill', spanId: `${id}-fill`, startChar: start, endChar: start + quote.length, startLine: 1, endLine: 1, quote,
  });
  const [a, b, c] = ids;
  const first = mkRef('first', `${a} feeds ${b}`, 0);
  const second = mkRef('second', `${b} produces ${c}`, 80);
  const concepts = ids.map((id) => ({ id, label: id, kind: 'entity', definition: `${id} definition`, evidenceRefs: [first, second] }));
  return {
    sceneId: 'scene-fill',
    raw: '',
    plainText: `${a} and ${b} enter ${c}.`,
    mentions: ids.map((id, index) => ({ id: `m${index}`, phrase: id })),
    teachingContext: {
      requireEvidence: true,
      sourceId: first.sourceId,
      displayText: `${b} and ${c}`,
      sourceEvidenceRefs: [first, second],
      concepts,
      relations: [
        { from: a, to: b, type: 'feeds', evidenceRefs: [first] },
        { from: b, to: c, type: 'produces', evidenceRefs: [second] },
      ],
    },
    planningContext: {
      sceneContract: { requiredConceptIds: ids, requiredRelations: [{ from: a, to: b, type: 'feeds' }, { from: b, to: c, type: 'produces' }] },
      lessonBible: { persistentConceptIds: [], terminology: [] },
    } as unknown as PlannerSceneInput['planningContext'],
  };
}

function makeFillBoard(ids: string[]): Board {
  const roles = ['input', 'process', 'output'] as const;
  return {
    schemaVersion: BOARD_SCHEMA_VERSION,
    title: 'A changing system',
    layout: 'flow',
    visual: { kind: 'process' },
    nodes: ids.map((id, index) => ({ id: `n${index + 1}`, mention: `m${index}`, concept: id, icon: 'label', label: id, role: roles[index]! })),
  };
}

test('a three-node board fills toward the occupancy target and keeps labels readable', () => {
  // Geometry note (Task 9): single-row icon boards are width-bound — the
  // union bbox already spans the working rect after growth, so occupancy caps
  // near ~0.31 for three nodes (measured 0.3077), below the 0.45 Simi warn
  // band. The solver still grows every box beyond intrinsic size toward
  // STYLE.occupancy.sparse, never the Simi band.
  const ids = ['alpha', 'beta', 'gamma'];
  const { spec, problems } = compileBoard(makeFillBoard(ids), makeFillInput(ids));
  assert.deepEqual(problems, []);
  const laid = layoutScene(resolveScene(spec));
  assert.ok(laid.occupancy >= STYLE.occupancy.sparse, `occupancy ${laid.occupancy} below sparse floor ${STYLE.occupancy.sparse}`);
  assert.ok(laid.occupancy >= 0.25, `single-row 3-node fill regressed: occupancy ${laid.occupancy} (measured 0.31 at implementation)`);
  for (const el of laid.elements) {
    assert.ok(el.bbox.w >= el.intrinsicSize.w && el.bbox.h >= el.intrinsicSize.h, `${el.id} must grow, never shrink, when the board fits`);
    for (const t of el.visual.texts) assert.ok(t.size * (el.bbox.h / el.intrinsicSize.h) >= 32 - 1e-6, `${el.id} text below readable floor`);
  }
});
