import { BOARD_EXAMPLES as V1_EXAMPLES, type BoardExample } from './boardBank.v1.js';

/**
 * board-bank-v2 = board-bank-v1 plus one abstract-topic example that shows
 * instance nodes: one concept drawn as two concrete examples, each with its
 * own mention and label, feeding one process. Like v1 it is hand-authored,
 * marked illustrative, and teaches only the output shape; the validator
 * accepts label words only from the target scene's own mentions and
 * concepts, so none of it can be copied into a generated board.
 */
export type { BoardExample };
export const BOARD_BANK_VERSION = 'board-bank-v3-current-wire-shape';

const ABSTRACT_INSTANCES: BoardExample = {
  id: 'convergence-effort-instances',
  origin: 'illustrative-example',
  sceneData: {
    narration: 'Effort, whether daily practice or finished homework, feeds learning, and learning builds skill.',
    mentions: [
      { id: 'practice', phrase: 'daily practice', iconSuggestions: ['calendar', 'pencil'] },
      { id: 'homework', phrase: 'finished homework', iconSuggestions: ['notebook', 'book'] },
      { id: 'learning', phrase: 'feeds learning', iconSuggestions: ['brain', 'lightbulb'] },
      { id: 'skill', phrase: 'builds skill', iconSuggestions: ['trophy'] },
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
    schemaVersion: 'claude-board/v2',
    title: 'Effort Builds Skill',
    layout: 'convergence',
    visual: { kind: 'process' },
    nodes: [
      { id: 'n1', mention: 'practice', concept: 'effort', icon: 'calendar', label: 'Daily Practice', role: 'input' },
      { id: 'n2', mention: 'homework', concept: 'effort', icon: 'notebook', label: 'Homework', role: 'input' },
      { id: 'n3', mention: 'learning', concept: 'learning', icon: 'brain', label: 'Learning', role: 'process' },
      { id: 'n4', mention: 'skill', concept: 'skill', icon: 'trophy', label: 'Skill', role: 'output' },
    ],
  },
};

export const BOARD_EXAMPLES: readonly BoardExample[] = [...V1_EXAMPLES, ABSTRACT_INSTANCES];
