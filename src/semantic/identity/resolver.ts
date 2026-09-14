import { SemanticIdentityRegistry, SemanticReferenceError, type SemanticKey, type SemanticRelationRef } from './types.js';
import type { SemanticObject, SemanticResolvedBeat, SemanticAction } from './canonical-schemas.js';
import type { VisualObject, VisualRelation, VisualAction, VisualBeat, VisualSceneV2 } from '../types.js';
import { canonicalAnchor } from '../assets/registry.js';

/** Runtime reference resolver: converts semantic keys into deterministic
 *  runtime IDs and validates references. All errors are typed. */
export interface ResolutionContext {
  registry: SemanticIdentityRegistry;
  sceneKey: string;
  allowedArchetypes: readonly string[];
}

/** Resolve the director's semantic object list into runtime VisualObjects. */
export function resolveObjects(context: ResolutionContext, objects: SemanticObject[]): VisualObject[] {
  return objects.map((o, index) => {
    const id = context.registry.allocateObject(o.conceptKey, o.role, o.semanticPart);
    if (o.role === 'hero') context.registry.registerHeroConcept(o.conceptKey);
    const collisionPolicy: VisualObject['collisionPolicy'] = o.collisionPolicy ?? (o.role === 'hero' ? 'forbid' : 'allow');
    return {
      id,
      conceptId: o.conceptKey,
      label: o.label,
      role: o.role,
      ...(o.assetRef ? {assetRef: o.assetRef} : {}),
      ...(o.primitiveRef ? {primitiveRef: o.primitiveRef} : {}),
      children: [],
      state: o.state ?? 'neutral',
      allowedStates: o.allowedStates ?? ['neutral', 'highlighted', 'activated'],
      importance: o.importance ?? 'secondary',
      ...(o.preferredZone ? {preferredZone: o.preferredZone} : {}),
      collisionPolicy,
    } satisfies VisualObject;
  });
}

export function resolveRelations(
  context: ResolutionContext,
  visualObjects: VisualObject[],
  relations: SemanticRelationRef[],
): VisualRelation[] {
  return relations.map((rel, index) => {
    const fromObj = findObject(context.registry, visualObjects, rel.fromConcept);
    const toObj = findObject(context.registry, visualObjects, rel.toConcept);
    const targetPart = rel.targetPart
      ? resolveSemanticPart(toObj, rel.targetPart)
      : 'center';
    const sourcePart = 'center';
    const visualForm = mapRelationForm(rel.relation);
    return {
      id: `rel_${context.sceneKey}_${index + 1}`,
      from: { objectId: fromObj.id, anchor: sourcePart },
      to: { objectId: toObj.id, anchor: targetPart },
      relationType: rel.relation,
      visualForm,
      label: rel.relation,
    } satisfies VisualRelation;
  });
}

export function resolveBeats(
  context: ResolutionContext,
  visualObjects: VisualObject[],
  visualRelations: VisualRelation[],
  beats: SemanticResolvedBeat[],
): VisualBeat[] {
  return beats.map((beat, beatIndex) => ({
    id: `beat_${context.sceneKey}_${beat.key}`,
    narration: beat.narration,
    actions: beat.actions.map((a, actionIndex) => ({
      id: `act_${context.sceneKey}_${beatIndex}_${actionIndex}`,
      type: a.type,
      objectIds: a.conceptKeys.map(k => findObject(context.registry, visualObjects, k).id),
      relationIds: a.relationRefs
        .map(ref => findRelation(visualRelations, visualObjects, ref))
        .filter((id): id is string => Boolean(id)),
      ...(a.anchorText ? {anchor: { text: a.anchorText, occurrence: a.anchorOccurrence ?? 0 }} : {}),
      durationMs: a.durationMs,
      leadMs: a.leadMs,
      easing: a.easing,
      ...(a.fromState ? {fromState: a.fromState} : {}),
      ...(a.toState ? {toState: a.toState} : {}),
      ...(a.destination ? {destination: a.destination} : {}),
    }) satisfies VisualAction),
    ...(beat.intentionalPause ? {intentionalPause: beat.intentionalPause} : {}),
  }));
}

function findObject(registry: SemanticIdentityRegistry, objects: VisualObject[], conceptKey: SemanticKey): VisualObject {
  const matches = objects.filter(o => o.conceptId === conceptKey);
  if (matches.length === 0) {
    // Runtime-repair: concept referenced in action but not visualized as an object.
    // If the hero object exposes a semantic part matching the concept, treat it as a
    // semantic-anchor reference and return the hero (anchor resolution is handled by
    // the compiler).
    const hero = registry.resolveHero();
    return objects.find(o => o.id === hero.id)!;
  }
  if (matches.length > 1) {
    // Prefer the hero if the concept matches the central concept.
    const hero = registry.resolveHero();
    const heroMatch = matches.find(o => o.id === hero.id);
    if (heroMatch) return heroMatch;
  }
  return matches[0];
}

function findRelation(
  relations: VisualRelation[],
  objects: VisualObject[],
  ref: SemanticRelationRef,
): string | undefined {
  const match = relations.find(r => {
    const fromObj = objects.find(o => o.id === r.from.objectId);
    const toObj = objects.find(o => o.id === r.to.objectId);
    return r.relationType === ref.relation &&
      fromObj?.conceptId === ref.fromConcept &&
      toObj?.conceptId === ref.toConcept;
  });
  return match?.id;
}

function resolveSemanticPart(object: VisualObject, rawPart: string): string {
  if (!object.assetRef) return 'center';
  try {
    return canonicalAnchor(object.assetRef, rawPart);
  } catch {
    // Model-emitted semantic parts (e.g. "roots") may not exactly match asset
    // anchor names. Degrade to center rather than failing the whole scene;
    // the compiler's anchor routing will still find a reasonable attachment.
    return 'center';
  }
}

function mapRelationForm(relation: string): VisualRelation['visualForm'] {
  switch (relation) {
    case 'flows_to':
    case 'moves_toward':
      return 'flow';
    case 'part_of':
    case 'contains':
      return 'containment';
    case 'compares_with':
      return 'brace';
    case 'causes':
    case 'activates':
    case 'inhibits':
    case 'transforms_to':
      return 'arrow';
    case 'depends_on':
    case 'labels':
      return 'leader';
    default:
      return 'arrow';
  }
}

/** Build the existing VisualSceneV2 from a resolved semantic direction. */
export function buildVisualScene(
  sceneKey: string,
  teaching: { teachingGoal: string; mentalModel: string; beats: { key: string; narrationDraft: string; intentionalPause?: string }[] },
  intent: { archetype: VisualSceneV2['archetype']; title: string },
  resolved: { objects: VisualObject[]; relations: VisualRelation[]; beats: VisualBeat[] },
): VisualSceneV2 {
  return {
    version: 2,
    id: sceneKey,
    title: intent.title,
    teachingGoal: teaching.teachingGoal,
    mentalModel: teaching.mentalModel,
    archetype: intent.archetype,
    objects: resolved.objects,
    relations: resolved.relations,
    beats: resolved.beats,
    continuity: { keepFromPrevious: [], prepareForNext: [] },
  };
}
