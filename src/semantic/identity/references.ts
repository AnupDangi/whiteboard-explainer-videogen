/** Reference-resolution helpers for semantic keys and runtime IDs. */
import { SemanticReferenceError, type SemanticKey } from './types.js';
import type { VisualObject, VisualRelation } from '../types.js';

/** Extract the canonical concept key from a runtime object id. */
export function conceptKeyFromObjectId(objectId: string): SemanticKey {
  const parts = objectId.split(':');
  if (parts.length < 3 || parts[0] !== 'concept') {
    throw new SemanticReferenceError('OBJECT_NOT_IN_SCENE', {});
  }
  return parts[2]!;
}

/** Find a VisualObject by its runtime ID. */
export function objectById(objects: VisualObject[], id: string): VisualObject {
  const found = objects.find(o => o.id === id);
  if (!found) throw new SemanticReferenceError('OBJECT_NOT_IN_SCENE', {});
  return found;
}

/** Find a VisualRelation by its runtime ID. */
export function relationById(relations: VisualRelation[], id: string): VisualRelation {
  const found = relations.find(r => r.id === id);
  if (!found) throw new SemanticReferenceError('OBJECT_NOT_IN_SCENE', {});
  return found;
}

/** Resolve a semantic reference error code when returning JSON errors to a client. */
export function referenceErrorToRecord(err: SemanticReferenceError): { code: string; context: Record<string, unknown> } {
  return { code: err.code, context: err.context as Record<string, unknown> };
}
