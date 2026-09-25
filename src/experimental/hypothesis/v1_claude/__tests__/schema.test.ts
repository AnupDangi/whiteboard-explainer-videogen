import test from 'node:test';
import assert from 'node:assert/strict';
import { safeParseSceneSpec, validateSceneSpecStructure } from '../schema.js';
import type { SceneSpec } from '../types.js';

function baseSpec(overrides: Partial<SceneSpec> = {}): SceneSpec {
  return {
    schemaVersion: 'claude-scene-spec/v1',
    sceneId: 's1',
    title: 'Test Scene',
    template: 'chain',
    elements: [
      { id: 'a', anchor: 'sceneStart', prim: 'box', text: 'A' },
      { id: 'b', anchor: 'after:a', prim: 'box', text: 'B' },
    ],
    edges: [{ from: 'a', to: 'b' }],
    ...overrides,
  };
}

test('schema: a well-formed hand-authored scene passes', () => {
  const result = safeParseSceneSpec(baseSpec());
  assert.equal(result.success, true);
});

test('schema: rejects raw markup/code smuggled into text fields', () => {
  const spec = baseSpec({ elements: [{ id: 'a', anchor: 'sceneStart', prim: 'box', text: '<script>alert(1)</script>' }] });
  const result = safeParseSceneSpec(spec);
  assert.equal(result.success, false);
});

test('schema: rejects raw markup smuggled into a formula latex field', () => {
  const spec = baseSpec({ elements: [{ id: 'a', anchor: 'sceneStart', prim: 'formula', latex: '<img src=x onerror=alert(1)>' }] });
  const result = safeParseSceneSpec(spec);
  assert.equal(result.success, false);
});

test('schema: rejects an element carrying pre-layout coordinates (unknown keys are stripped/rejected)', () => {
  const spec = baseSpec({
    elements: [{ id: 'a', anchor: 'sceneStart', prim: 'box', text: 'A', x: 100, y: 200 } as unknown as SceneSpec['elements'][number]],
  });
  const result = safeParseSceneSpec(spec);
  assert.equal(result.success, false);
});

test('schema: rejects a made-up "sourceFigure"/source-crop primitive (no such primitive exists in the Claude hypothesis)', () => {
  const spec = baseSpec({
    elements: [{ id: 'a', anchor: 'sceneStart', prim: 'sourceFigure', crop: [0, 0, 100, 100] } as unknown as SceneSpec['elements'][number]],
  });
  const result = safeParseSceneSpec(spec);
  assert.equal(result.success, false, 'a source-figure/crop primitive must be rejected — falsifying evidence for the Claude hypothesis, not a feature to add');
});

test('schema: rejects an invalid anchor string', () => {
  const spec = baseSpec({ elements: [{ id: 'a', anchor: 'floating:free' as never, prim: 'box', text: 'A' }] });
  const result = safeParseSceneSpec(spec);
  assert.equal(result.success, false);
});

test('schema: rejects an object concept that looks like an asset id/path rather than a plain noun', () => {
  const spec = baseSpec({ elements: [{ id: 'a', anchor: 'sceneStart', prim: 'object', concept: '../../etc/assets/key.svg' }] });
  const result = safeParseSceneSpec(spec);
  assert.equal(result.success, false);
});

test('schema: rejects more than 9 elements', () => {
  const elements = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, anchor: 'sceneStart' as const, prim: 'box' as const, text: 'X' }));
  const result = safeParseSceneSpec(baseSpec({ elements }));
  assert.equal(result.success, false);
});

test('schema: rejects a label longer than 4 words', () => {
  const spec = baseSpec({ elements: [{ id: 'a', anchor: 'sceneStart', prim: 'box', label: 'this label has way too many words' }] });
  const result = safeParseSceneSpec(spec);
  assert.equal(result.success, false);
});

test('structural: dangling edge id is rejected', () => {
  const spec = baseSpec({ edges: [{ from: 'a', to: 'ghost' }] });
  const parsed = safeParseSceneSpec(spec);
  assert.ok(parsed.success);
  const issues = validateSceneSpecStructure(parsed.data);
  assert.ok(issues.some((i) => i.code === 'dangling-id'));
});

test('structural: dangling container child id is rejected', () => {
  const spec = baseSpec({
    elements: [
      { id: 'a', anchor: 'sceneStart', prim: 'box', text: 'A' },
      { id: 'grp', anchor: 'sceneStart', prim: 'container', children: ['ghost'], style: 'solid' },
    ],
    edges: [],
  });
  const parsed = safeParseSceneSpec(spec);
  assert.ok(parsed.success);
  const issues = validateSceneSpecStructure(parsed.data);
  assert.ok(issues.some((i) => i.code === 'dangling-id'));
});

test('structural: a two-element after: cycle is detected', () => {
  const spec = baseSpec({
    elements: [
      { id: 'a', anchor: 'after:b', prim: 'box', text: 'A' },
      { id: 'b', anchor: 'after:a', prim: 'box', text: 'B' },
    ],
    edges: [],
  });
  const parsed = safeParseSceneSpec(spec);
  assert.ok(parsed.success);
  const issues = validateSceneSpecStructure(parsed.data);
  assert.ok(issues.some((i) => i.code === 'anchor-cycle'), 'a 2-cycle in after:* anchors must be caught, not silently accepted');
});

test('structural: a longer acyclic after: chain is accepted', () => {
  const spec = baseSpec({
    elements: [
      { id: 'a', anchor: 'sceneStart', prim: 'box', text: 'A' },
      { id: 'b', anchor: 'after:a', prim: 'box', text: 'B' },
      { id: 'c', anchor: 'after:b', prim: 'box', text: 'C' },
    ],
    edges: [],
  });
  const parsed = safeParseSceneSpec(spec);
  assert.ok(parsed.success);
  const issues = validateSceneSpecStructure(parsed.data);
  assert.equal(issues.filter((i) => i.code === 'anchor-cycle').length, 0);
});

test('structural: after:<carried-id> is legal even though the carried id was not placed by this scene (it existed before sceneStart)', () => {
  const spec = baseSpec({
    elements: [{ id: 'b', anchor: 'after:carried', prim: 'box', text: 'B' }],
    edges: [],
    carryOver: ['carried'],
  });
  const parsed = safeParseSceneSpec(spec);
  assert.ok(parsed.success);
  // Note: 'carried' also isn't a real element in THIS scene's elements array,
  // so it also fails the general dangling-id check for carryOver refs. This
  // documents a real ambiguity: claude_pipeline.md doesn't specify whether a
  // carried element must be re-listed in the carrying scene's own elements.
  // This implementation requires it — see docs/HANDOFF.md.
  const issues = validateSceneSpecStructure(parsed.data);
  assert.ok(issues.length > 0);
});

test('structural: duplicate element ids are rejected', () => {
  const spec = baseSpec({
    elements: [
      { id: 'a', anchor: 'sceneStart', prim: 'box', text: 'A' },
      { id: 'a', anchor: 'sceneStart', prim: 'box', text: 'A2' },
    ],
    edges: [],
  });
  const parsed = safeParseSceneSpec(spec);
  assert.ok(parsed.success);
  const issues = validateSceneSpecStructure(parsed.data);
  assert.ok(issues.some((i) => i.code === 'duplicate-element-id'));
});
