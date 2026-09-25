import { ATTENTION_SCENES } from './attentionScenes.js';

/**
 * Versioned C6 renderer experiment. The original Attention fixture remains
 * frozen; this copy changes only query/key depictions to test the generic
 * catalog-icon path and convergence-grid layout. These are illustrative
 * metaphors, not generated factual visuals.
 */
export const ATTENTION_SCENES_C6 = ATTENTION_SCENES.map((scene) => {
  if (scene.sceneId === 'why_attention') {
    return {
      ...scene,
      spec: {
        ...scene.spec,
        // An explicit, fixture-only metaphor lets the C6 renderer proof test
        // a source-independent icon choice without teaching runtime branches.
        elements: scene.spec.elements.map((element) => element.id === 'subtitle'
          ? { id: 'query', slot: 'subtitle', anchor: 'mention:q' as const, prim: 'object' as const, concept: 'magnifying glass', label: 'QUERY', fill: 'blue' as const, origin: 'illustrative-example' as const }
          : element),
        edges: [{ from: 'query', to: 'strip' }],
      },
    };
  }
  if (scene.sceneId !== 'query_meets_keys') return scene;
  return {
    ...scene,
    spec: {
      ...scene.spec,
      elements: scene.spec.elements.map((element) => {
        if (element.id === 'query') return { id: 'query', slot: 'input', anchor: 'mention:q' as const, prim: 'object' as const, concept: 'magnifying glass', label: 'QUERY', fill: 'blue' as const, origin: 'illustrative-example' as const };
        if (element.id === 'key1' || element.id === 'key2' || element.id === 'key3') return { id: element.id, slot: 'input', anchor: element.anchor, prim: 'object' as const, concept: 'key', label: `KEY ${element.id.slice(-1)}`, fill: 'yellow' as const, origin: 'illustrative-example' as const };
        return element;
      }),
    },
  };
});
