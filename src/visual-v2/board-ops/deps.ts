import type { BoardOp } from './types.js';

/** Elements an op needs to exist (and be fully drawn) before it can start. */
export function dependenciesOf(op: BoardOp): string[] {
  switch (op.op) {
    case 'add': return op.at.container ? [op.at.container] : [];
    case 'connect': return [op.from, op.to];
    case 'merge': return op.targets;
    case 'move': return [op.target, ...(op.to.container ? [op.to.container] : [])];
    case 'transform': case 'replace': case 'remove': case 'highlight': case 'deemphasize': case 'strike': case 'updateValue': case 'split': case 'equationStep': return [op.target];
    default: return [];
  }
}
/** Elements an op brings onto the board. */
export function createdBy(op: BoardOp): string[] {
  switch (op.op) {
    case 'add': case 'connect': case 'replace': return [op.id];
    case 'split': return op.into.map((part) => part.id);
    case 'merge': return [op.into.id];
    default: return [];
  }
}
