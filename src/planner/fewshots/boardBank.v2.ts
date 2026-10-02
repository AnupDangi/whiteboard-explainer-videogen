import { BOARD_EXAMPLES as V1_EXAMPLES } from './boardBank.v1.js';

/** Current S6 few-shot wire shape. Legacy catalog names are normalized here and
 * never serialized as model choices; S6 supplies typed representation intent,
 * while S7 selects the actual asset from the pinned authority. */
export interface BoardExample {
  id: string;
  origin: 'illustrative-example';
  sceneData: {
    narration: string;
    mentions: Array<{ id: string; phrase: string }>;
    concepts: Array<{ id: string; label: string }>;
    relations: Array<{ from: string; to: string; type: string }>;
  };
  board: {
    schemaVersion: 'claude-board/v5-representation-intent';
    title: string;
    layout: 'flow' | 'fan_out' | 'convergence' | 'list' | 'compare' | 'cycle' | 'hub';
    nodes: Array<{
      id: string;
      mention: string;
      concept: string;
      representation:
        | { kind: 'literal' }
        | { kind: 'metaphor' }
        | { kind: 'retrieval' }
        | { kind: 'semantic-role'; role: string }
        | { kind: 'topology'; topology: string }
        | { kind: 'shape'; shape: 'circle' | 'triangle' | 'rectangle' }
        | { kind: 'labelled' };
      label: string;
      role: 'input' | 'process' | 'output' | 'item' | 'attribute';
    }>;
    visual: { kind: 'process' } | { kind: 'comparison' };
  };
}

const adaptV1Example = (example: (typeof V1_EXAMPLES)[number]): BoardExample => ({
  id: example.id,
  origin: example.origin,
  sceneData: {
    narration: example.sceneData.narration,
    // Suggestions were catalog IDs presented to the model. Keep only source
    // language in the typed S6 example contract.
    mentions: example.sceneData.mentions.map(({ id, phrase }) => ({ id, phrase })),
    concepts: example.sceneData.concepts,
    relations: example.sceneData.relations,
  },
  board: {
    ...example.board,
    schemaVersion: 'claude-board/v5-representation-intent',
    nodes: example.board.nodes.map(({ icon, ...node }) => ({
      ...node,
      // The legacy "label" sentinel meant a truthful text box. Every other
      // legacy value was an asset/catalog choice, so reduce it to direct
      // depiction intent without carrying that identifier into the prompt.
      representation: icon === 'label' ? { kind: 'labelled' as const } : { kind: 'literal' as const },
    })),
  },
});

/** Bump whenever the normalized examples or their serialized shape changes. */
export const BOARD_BANK_VERSION = 'board-bank-v4-representation-intent';

const ABSTRACT_INSTANCES: BoardExample = {
  id: 'convergence-effort-instances',
  origin: 'illustrative-example',
  sceneData: {
    narration: 'Effort, whether daily practice or finished homework, feeds learning, and learning builds skill.',
    mentions: [
      { id: 'practice', phrase: 'daily practice' },
      { id: 'homework', phrase: 'finished homework' },
      { id: 'learning', phrase: 'feeds learning' },
      { id: 'skill', phrase: 'builds skill' },
    ],
    concepts: [
      { id: 'effort', label: 'Effort' },
      { id: 'learning', label: 'Learning' },
      { id: 'skill', label: 'Skill' },
    ],
    relations: [
      { from: 'effort', to: 'learning', type: 'feeds' },
      { from: 'learning', to: 'skill', type: 'produces' },
    ],
  },
  board: {
    schemaVersion: 'claude-board/v5-representation-intent',
    title: 'Effort Builds Skill',
    layout: 'convergence',
    visual: { kind: 'process' },
    nodes: [
      { id: 'n1', mention: 'practice', concept: 'effort', representation: { kind: 'literal' }, label: 'Daily Practice', role: 'input' },
      { id: 'n2', mention: 'homework', concept: 'effort', representation: { kind: 'literal' }, label: 'Homework', role: 'input' },
      { id: 'n3', mention: 'learning', concept: 'learning', representation: { kind: 'labelled' }, label: 'Learning', role: 'process' },
      { id: 'n4', mention: 'skill', concept: 'skill', representation: { kind: 'labelled' }, label: 'Skill', role: 'output' },
    ],
  },
};

export const BOARD_EXAMPLES: readonly BoardExample[] = [...V1_EXAMPLES.map(adaptV1Example), ABSTRACT_INSTANCES];
