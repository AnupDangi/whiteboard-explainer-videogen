/** Canonical semantic identity layer.
 *
 *  Rule: models emit semantic keys and semantic references.
 *        Runtime owns all internal IDs.
 *  Runtime authority is `harness/registry.ts` (LessonSemanticRegistry);
 *  `SemanticIdentityRegistry` here is the secondary/translation registry.
 */

/** A semantic key is the stable human-readable concept name the model uses.
 *  It is normalized to lower-case snake_case for matching, aliases and canonical
 *  registry entries are kept alongside for display.
 */
export type SemanticKey = string;

/** A runtime-scoped object identity generated deterministically from the
 *  scene index and concept key. Not exposed to model prompts. */
type ObjectId = string;

/** Kinds of typed reference failures emitted when a semantic reference cannot
 *  be resolved to a concrete scene entity. */
type ReferenceFailure =
  | 'UNKNOWN_CONCEPT'
  | 'AMBIGUOUS_CONCEPT'
  | 'CONCEPT_NOT_IN_SCENE'
  | 'OBJECT_NOT_IN_SCENE'
  | 'SEMANTIC_PART_UNAVAILABLE'
  | 'INVALID_RELATION_TYPE'
  | 'NO_HERO_OBJECT'
  | 'MULTIPLE_HERO_OBJECTS';

export class SemanticReferenceError extends Error {
  constructor(
    public readonly code: ReferenceFailure,
    public readonly context: {
      key?: SemanticKey;
      part?: string;
      scene?: string;
      relation?: string;
      candidates?: SemanticKey[];
    } = {},
  ) {
    super(`${code}: ${JSON.stringify(context)}`);
    this.name = 'SemanticReferenceError';
  }
}

/** Normalizes a raw semantic key to snake_case ASCII. */
export function normalizeSemanticKey(raw: string): SemanticKey {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Runtime identity of a resolved scene object. */
interface CanonicalObject {
  id: ObjectId;
  conceptKey: SemanticKey;
  role: 'hero' | 'support' | 'structure' | 'material' | 'equation' | 'annotation' | 'label' | 'decorative_support' | 'data';
  semanticPart?: string;
}

/** A semantic relation reference emitted by the model. */
export interface SemanticRelationRef {
  fromConcept: SemanticKey;
  relation: 'causes' | 'flows_to' | 'contains' | 'part_of' | 'transforms_to' | 'depends_on' | 'labels' | 'compares_with' | 'activates' | 'inhibits' | 'moves_toward';
  toConcept: SemanticKey;
  /** Semantically names a subpart/anchor on the target concept, e.g. "roots". */
  targetPart?: string;
}

/** Registry that owns all internal IDs per `generateV2` invocation.
 *  Concept identities from the plan are loaded first; scene objects and
 *  relations are resolved deterministically from semantic keys.
 */
export class SemanticIdentityRegistry {
  private conceptNames = new Map<SemanticKey, { canonicalName: string; aliases: SemanticKey[]; type: string }>();
  private objectsByKey = new Map<SemanticKey, CanonicalObject[]>();
  private hero: SemanticKey | undefined;
  private sceneCounter = 0;

  /** Provide the concept registry from the teaching plan once per scene.
   *  Concept keys are assumed already normalized. */
  registerConcepts(concepts: { id: SemanticKey; canonicalName: string; aliases: SemanticKey[]; semanticType: string }[]): void {
    this.conceptNames.clear();
    this.objectsByKey.clear();
    for (const c of concepts) {
      this.conceptNames.set(c.id, { canonicalName: c.canonicalName, aliases: c.aliases, type: c.semanticType });
    }
  }

  registerHeroConcept(key: SemanticKey): void {
    this.hero = key;
  }

  /** Called by the resolver after a visual intent is realized as concrete objects. */
  allocateObject(conceptKey: SemanticKey, role: CanonicalObject['role'], semanticPart?: string): ObjectId {
    const object: CanonicalObject = {
      id: `concept_${this.sceneCounter}_${conceptKey}_${this.nextSequence(conceptKey)}`,
      conceptKey,
      role,
      semanticPart,
    };
    const list = this.objectsByKey.get(conceptKey) ?? [];
    list.push(object);
    this.objectsByKey.set(conceptKey, list);
    return object.id;
  }

  private nextSequence(conceptKey: SemanticKey): number {
    return (this.objectsByKey.get(conceptKey)?.length ?? 0) + 1;
  }

  advanceScene(): void {
    this.sceneCounter += 1;
    this.objectsByKey.clear();
    this.hero = undefined;
  }

  /** Resolve a concept key to known plan metadata or throw. */
  lookupConcept(key: SemanticKey): { canonicalName: string; aliases: SemanticKey[]; type: string } {
    const found = this.conceptNames.get(key);
    if (!found) throw new SemanticReferenceError('UNKNOWN_CONCEPT', { key });
    return found;
  }

  /** Resolve which object(s) represent a semantic key. */
  resolveConceptObjects(key: SemanticKey): CanonicalObject[] {
    return this.objectsByKey.get(key) ?? [];
  }

  /** Resolve a concept key to a single object when exactly one is expected. */
  resolveUniqueObject(key: SemanticKey): CanonicalObject {
    const matches = this.resolveConceptObjects(key);
    if (matches.length === 0) throw new SemanticReferenceError('OBJECT_NOT_IN_SCENE', { key });
    if (matches.length > 1) throw new SemanticReferenceError('AMBIGUOUS_CONCEPT', { key, candidates: matches.map(m => m.conceptKey) });
    return matches[0];
  }

  /** Resolve the hero object. */
  resolveHero(): CanonicalObject {
    if (!this.hero) throw new SemanticReferenceError('NO_HERO_OBJECT', {});
    const matches = (this.objectsByKey.get(this.hero) ?? []).filter(o => o.role === 'hero');
    if (matches.length === 0) throw new SemanticReferenceError('OBJECT_NOT_IN_SCENE', { key: this.hero });
    if (matches.length > 1) throw new SemanticReferenceError('MULTIPLE_HERO_OBJECTS', { key: this.hero });
    return matches[0];
  }
}
