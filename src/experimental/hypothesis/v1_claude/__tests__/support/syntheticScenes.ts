import type { SceneSpec } from '../../types.js';

/** Neutral test inputs for renderer/player/cache contracts; never quality or cost evidence. */
export const SYNTHETIC_SCENES: Array<{ sceneId: string; raw: string; spec: SceneSpec }> = ['sample_a', 'sample_b', 'sample_c'].map((sceneId) => ({
  sceneId,
  raw: 'A [[item_a|sample item A]] connects to [[item_b|sample item B]].',
  spec: {
    schemaVersion: 'claude-scene-spec/v1',
    sceneId,
    title: 'Sample Flow',
    template: 'chain',
    elements: [
      { id: 'item_a', anchor: 'mention:item_a', prim: 'box', text: 'A' },
      { id: 'item_b', anchor: 'mention:item_b', prim: 'box', text: 'B' },
    ],
    edges: [{ from: 'item_a', to: 'item_b' }],
  },
}));
