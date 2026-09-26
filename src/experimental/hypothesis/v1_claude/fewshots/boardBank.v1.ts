/**
 * Versioned few-shot boards for the S6 board planner (claude-board/v2).
 *
 * Hand-authored and marked illustrative: they teach the output shape and the
 * layout/icon/label choices, never lesson facts. The board validator only
 * accepts label words from the target scene's own mentions and concepts, so
 * nothing in these examples can be copied into a generated scene. They are
 * never counted as generated planner results.
 */
export const BOARD_BANK_VERSION = 'board-bank-v1';

export interface BoardExample {
  id: string;
  origin: 'illustrative-example';
  sceneData: {
    narration: string;
    mentions: Array<{ id: string; phrase: string; iconSuggestions: string[] }>;
    concepts: Array<{ id: string; label: string }>;
    relations: Array<{ from: string; to: string; type: string }>;
  };
  board: {
    schemaVersion: 'claude-board/v2';
    title: string;
    layout: 'flow' | 'fan_out' | 'convergence' | 'list' | 'compare' | 'cycle' | 'hub';
    nodes: Array<{ id: string; mention: string; concept: string; icon: string; label: string; role: 'input' | 'process' | 'output' | 'item' | 'attribute' }>;
    visual: { kind: 'process' } | { kind: 'comparison' };
  };
}

export const BOARD_EXAMPLES: readonly BoardExample[] = [
  {
    id: 'convergence-bakery',
    origin: 'illustrative-example',
    sceneData: {
      narration: 'A baker mixes flour and water, the oven bakes the dough, and out comes bread.',
      mentions: [
        { id: 'flour', phrase: 'flour', iconSuggestions: ['bread', 'plant'] },
        { id: 'water', phrase: 'water', iconSuggestions: ['drop', 'water-glass'] },
        { id: 'oven', phrase: 'oven bakes', iconSuggestions: ['fire-nature', 'thermometer'] },
        { id: 'bread', phrase: 'bread', iconSuggestions: ['bread'] },
      ],
      concepts: [
        { id: 'flour', label: 'Flour' },
        { id: 'water', label: 'Water' },
        { id: 'baking', label: 'Baking' },
        { id: 'bread', label: 'Bread' },
      ],
      relations: [
        { from: 'flour', to: 'baking', type: 'feeds' },
        { from: 'water', to: 'baking', type: 'feeds' },
        { from: 'baking', to: 'bread', type: 'produces' },
      ],
    },
    board: {
      schemaVersion: 'claude-board/v2',
      title: 'Dough Becomes Bread',
      layout: 'convergence',
      visual: { kind: 'process' },
      nodes: [
        { id: 'n1', mention: 'flour', concept: 'flour', icon: 'label', label: 'Flour', role: 'input' },
        { id: 'n2', mention: 'water', concept: 'water', icon: 'drop', label: 'Water', role: 'input' },
        { id: 'n3', mention: 'oven', concept: 'baking', icon: 'fire-nature', label: 'Baking', role: 'process' },
        { id: 'n4', mention: 'bread', concept: 'bread', icon: 'bread', label: 'Bread', role: 'output' },
      ],
    },
  },
  {
    id: 'flow-parcel',
    origin: 'illustrative-example',
    sceneData: {
      narration: 'A parcel leaves the warehouse, rides a truck across town, and reaches your house.',
      mentions: [
        { id: 'warehouse', phrase: 'warehouse', iconSuggestions: ['warehouse', 'factory'] },
        { id: 'truck', phrase: 'truck', iconSuggestions: ['delivery-truck', 'truck'] },
        { id: 'house', phrase: 'your house', iconSuggestions: ['house', 'home'] },
      ],
      concepts: [
        { id: 'warehouse', label: 'Warehouse' },
        { id: 'delivery', label: 'Delivery Truck' },
        { id: 'home', label: 'Home' },
      ],
      relations: [
        { from: 'warehouse', to: 'delivery', type: 'feeds' },
        { from: 'delivery', to: 'home', type: 'feeds' },
      ],
    },
    board: {
      schemaVersion: 'claude-board/v2',
      title: 'A Parcel Travels Home',
      layout: 'flow',
      visual: { kind: 'process' },
      nodes: [
        { id: 'n1', mention: 'warehouse', concept: 'warehouse', icon: 'warehouse', label: 'Warehouse', role: 'input' },
        { id: 'n2', mention: 'truck', concept: 'delivery', icon: 'delivery-truck', label: 'Truck', role: 'process' },
        { id: 'n3', mention: 'house', concept: 'home', icon: 'house', label: 'House', role: 'output' },
      ],
    },
  },
];
