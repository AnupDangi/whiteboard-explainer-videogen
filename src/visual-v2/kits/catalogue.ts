import type { KitName } from '../board-ops/types.js';

/**
 * What each kit is for, in topic-free words, with example parameters. The S6 prompt is built from this table, and a test
 * checks that every example parses with the kit's own schema, so the catalogue cannot drift from the code.
 */
export interface KitCatalogueEntry { purpose: string; slots: string; exampleParamsJson: string }

export const KIT_CATALOGUE: Record<KitName, KitCatalogueEntry> = {
  stack: { purpose: 'An ordered pile where the newest item sits on top and is the first to leave (last in, first out). Use for anything that grows and shrinks from one end.', slots: 'children use slot "top" to push; removing the top child pops it', exampleParamsJson: '{"capacity":5}' },
  queue: { purpose: 'A line where items enter at the end and leave from the front (first in, first out). Use for waiting, scheduling and pipelines.', slots: 'children use slot "end" to join; removing the first child serves it', exampleParamsJson: '{"capacity":4}' },
  array: { purpose: 'A row of numbered cells holding values by position. Use for lists, sequences, search ranges and tensors.', slots: 'a child\'s slot number is its cell (0-based)', exampleParamsJson: '{"length":6}' },
  compartment: { purpose: 'Zones separated by a boundary (solid, semipermeable or dashed). Use for anything that crosses a boundary, balances between two sides, or is sorted into groups.', slots: 'children name a zone and can move between zones', exampleParamsJson: '{"zones":["a","b"],"boundary":"semipermeable","zoneLabels":["A","B"]}' },
  'layered-stack': { purpose: 'N identical layers one above another, optionally labelled x N. Use when a part repeats (layers, stages, tiers).', slots: 'a child\'s slot is its layer number from the top (0-based)', exampleParamsJson: '{"layers":4,"repeat":6}' },
  cycle: { purpose: 'Slots around a closed ring joined by arrows. Use for loops, feedback and repeating processes.', slots: 'children fill the ring clockwise from the top with slot "end"', exampleParamsJson: '{"nodes":4}' },
  comparison: { purpose: 'Columns that share the same dimensions, one per side, each with a header. Use for before and after, trade-offs and contrasts.', slots: 'children name the side (zone) they belong to', exampleParamsJson: '{"sides":["before","after"]}' },
  graph: { purpose: 'Free nodes joined by relations you draw with connect ops. Use for networks, dependencies and any structure with arbitrary links.', slots: 'children take the next node position with slot "end"; join them with connect ops', exampleParamsJson: '{"nodes":5,"layout":"ring"}' },
  tree: { purpose: 'Nodes in levels with parent links. Use for hierarchies and branching structures.', slots: 'a child\'s slot number is its position in level order (0 is the root)', exampleParamsJson: '{"shape":[1,2,4]}' },
  'weighted-links': { purpose: 'Two columns of nodes joined by links whose strength is the weight (0 to 1) of each connect op. Use for influence and probability between two sets.', slots: 'children name a zone (left or right); connect ops carry the weight', exampleParamsJson: '{"left":3,"right":3,"labels":["from","to"]}' },
  'axes-plot': { purpose: 'Axes with a curve for how one quantity depends on another. A single picture: it holds no children.', slots: 'none', exampleParamsJson: '{"fn":"quadratic","params":[1,0,0],"domain":[-3,3],"xLabel":"x","yLabel":"y"}' },
  equation: { purpose: 'A typeset expression. For step-by-step algebra prefer an element of type equation and equationStep ops, which keep the whole derivation visible.', slots: 'none', exampleParamsJson: '{"latex":"a+b=c"}' },
};
