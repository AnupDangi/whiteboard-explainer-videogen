import { normalizeSemanticKey, SemanticIdentityRegistry, SemanticReferenceError } from './types.js';
import type { SemanticKey, SemanticRelationRef } from './types.js';
import type { VisualSceneV2, VisualObject, VisualRelation, VisualBeat, VisualAction } from '../types.js';
import { resolveObjects, resolveRelations } from './resolver.js';

/** Builds a typed semantic relation reference from the model's preferred
 *  shape: either the canonical tuple `{fromConcept, relation, toConcept}` or
 *  the legacy `{fromConceptId, relationType, toConceptId, targetAnchor}`. */
export function canonicalizeRelation(
  raw: Record<string, unknown>,
  allowedRelations: readonly string[],
): SemanticRelationRef {
  const from = asString(raw.fromConcept ?? raw.fromConceptId);
  const to = asString(raw.toConcept ?? raw.toConceptId);
  const relation = asString(raw.relation ?? raw.relationType);
  const targetPart = raw.targetPart && typeof raw.targetPart === 'string' ? normalizeSemanticKey(raw.targetPart) : undefined;
  if (!from || !to || !relation) {
    throw new Error(`Missing semantic relation fields in ${JSON.stringify(raw)}`);
  }
  if (!allowedRelations.includes(relation)) {
    throw new Error(`Unknown relation type: ${relation}`);
  }
  return {
    fromConcept: normalizeSemanticKey(from),
    relation: relation as SemanticRelationRef['relation'],
    toConcept: normalizeSemanticKey(to),
    targetPart,
  };
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return undefined;
}

/** Resolves a semantic part alias for a concept to a known asset anchor.
 *  Returns the normalized part if no alias mapping exists. */
export function normalizeSemanticPart(raw: string): string {
  return normalizeSemanticKey(raw);
}

/** Runtime owns visual identity. This function takes a model-generated
 *  VisualSceneV2 (with arbitrary object/relation IDs) and returns a
 *  canonicalized VisualSceneV2 whose object/relation/action IDs are
 *  deterministic runtime IDs. Beat IDs are preserved so they continue to
 *  match the semantic plan.
 */
export function canonicalizeVisualScene(
  sceneKey: string,
  raw: VisualSceneV2,
  conceptRegistry: { id: SemanticKey; canonicalName: string; aliases: SemanticKey[]; semanticType: string }[],
): VisualSceneV2 {
  const registry = new SemanticIdentityRegistry();
  registry.advanceScene();
  registry.registerConcepts(
    conceptRegistry.map(c => ({ ...c, id: normalizeSemanticKey(c.id) })),
  );

  const semanticObjects = raw.objects.map(o => ({
    conceptKey: normalizeSemanticKey(o.conceptId ?? o.id),
    label: o.label,
    role: o.role,
    assetRef: o.assetRef,
    primitiveRef: o.primitiveRef,
    semanticPart: undefined,
    state: o.state,
    allowedStates: o.allowedStates,
    importance: o.importance,
    preferredZone: o.preferredZone,
    collisionPolicy: o.collisionPolicy,
  }));

  const objects = resolveObjects(
    { registry, sceneKey, allowedArchetypes: [raw.archetype] },
    semanticObjects,
  );

  // Canonicalization only rewrites identifiers. It must not change topology,
  // anchors, visual forms, labels, states, or parent/child relationships.
  const objectIds=new Map(raw.objects.map((o,i)=>[o.id,objects[i].id]));
  for(const [i,o] of raw.objects.entries())objects[i]={...o,id:objects[i].id,
    ...(o.parentId?{parentId:objectIds.get(o.parentId)!}:{}),children:o.children.map(id=>objectIds.get(id)!)};
  const relations=raw.relations.map((r,i)=>({...r,id:`rel_${sceneKey}_${i+1}`,
    from:{...r.from,objectId:objectIds.get(r.from.objectId)!},to:{...r.to,objectId:objectIds.get(r.to.objectId)!}}));

  const oldObjectIdToNew = new Map(raw.objects.map((o, i) => [o.id, objects[i].id]));
  const oldRelationIdToNew = new Map(raw.relations.map((r, i) => [r.id, relations[i].id]));

  const mapObjectId = (id: string): string => {
    const mapped = oldObjectIdToNew.get(id);
    if (!mapped) throw new SemanticReferenceError('OBJECT_NOT_IN_SCENE', { key: id });
    return mapped;
  };
  const mapRelationId = (id: string): string => {
    const mapped = oldRelationIdToNew.get(id);
    if (!mapped) throw new SemanticReferenceError('OBJECT_NOT_IN_SCENE', { relation: id });
    return mapped;
  };

  const beats: VisualBeat[] = raw.beats.map((b, beatIndex) => ({
    id: b.id,
    narration: b.narration,
    actions: b.actions.map((a, actionIndex) => ({
      id: `act_${sceneKey}_${beatIndex}_${actionIndex}`,
      type: a.type,
      objectIds: a.objectIds.map(mapObjectId),
      relationIds: a.relationIds.map(mapRelationId),
      ...(a.anchor ? {anchor: a.anchor} : {}),
      durationMs: a.durationMs,
      leadMs: a.leadMs,
      easing: a.easing,
      ...(a.fromState ? {fromState: a.fromState} : {}),
      ...(a.toState ? {toState: a.toState} : {}),
      ...(a.destination ? {destination: a.destination} : {}),
    })),
    ...(b.intentionalPause ? {intentionalPause: b.intentionalPause} : {}),
  }));

  const mapContinuityIds = (ids: string[]) =>
    ids.map(id => oldObjectIdToNew.get(id) ?? id).filter(Boolean);

  return {
    version: 2,
    id: sceneKey,
    title: raw.title,
    teachingGoal: raw.teachingGoal,
    mentalModel: raw.mentalModel,
    archetype: raw.archetype,
    objects,
    relations,
    beats,
    continuity: {
      keepFromPrevious: mapContinuityIds(raw.continuity.keepFromPrevious),
      prepareForNext: mapContinuityIds(raw.continuity.prepareForNext),
      ...(raw.continuity.transitions ? {transitions: raw.continuity.transitions.map(t => ({
        conceptId: t.conceptId, action: t.action, fromState: t.fromState, toState: t.toState,
        ...(t.fromRepresentation ? {fromRepresentation: t.fromRepresentation} : {}),
        ...(t.toRepresentation ? {toRepresentation: t.toRepresentation} : {})
      }))} : {})
    },
  };
}

/** Map old runtime IDs from a previous scene to new IDs in the current scene
 *  while preserving semantic continuity. Used for multi-scene jobs. */
export function remapContinuityIds(
  previousObjects: VisualObject[],
  currentObjects: VisualObject[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const prev of previousObjects) {
    if (!prev.conceptId) continue;
    const match = currentObjects.find(o => o.conceptId === prev.conceptId && o.role === prev.role);
    if (match) map.set(prev.id, match.id);
  }
  return map;
}
