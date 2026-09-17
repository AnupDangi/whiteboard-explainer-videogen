/** Composition fallbacks (Wave 3).
 *
 *  Deterministic, model-free repairs applied to a validated VisualSceneV2 just
 *  before placement. Every repair is returned as a `representation fallback:`
 *  warning so eval metrics and scene diagnostics show the degradation instead
 *  of failing the whole job. Teaching contracts (concept coverage, beat count,
 *  narration) are never altered — only composition, roles and tokens.
 */
import type { VisualObject, VisualSceneV2 } from '../types.js';
import type { AssetDefinition } from '../assets/types.js';
import { resolveAsset } from '../assets/registry.js';

export interface FallbackOutcome {
  scene: VisualSceneV2;
  warnings: string[];
}

const warn = (warnings: string[], message: string): void => {
  warnings.push(`representation fallback: ${message}`);
};

/** Primary representations: everything the archetype layouts place. */
function roots(scene: VisualSceneV2): VisualObject[] {
  return scene.objects.filter(o => !o.parentId && o.role !== 'annotation' && o.role !== 'decorative_support');
}

/** Demote an object to an annotation label so it leaves the primary count but
 *  stays on the board and keeps its ID (beat actions keep resolving). */
function demoteToAnnotation(o: VisualObject, warnings: string[] = []): void {
  /** The archetype is full and every remaining object is primary. There is no
   *  other way to keep the composition: the extra object loses its role but stays
   *  on the board with its id, so beat actions still resolve, and the demotion is
   *  recorded. The HERO is never demoted - that would remove the central system.
   *  Measured: `Critical representation overflow: object_mla` ended a run whose
   *  director had added one primary beyond the archetype's capacity. */
  if(o.role==='hero')throw new Error(`Cannot demote the hero: ${o.id}`);
  if(o.importance==='primary')warn(warnings, `${o.conceptId ?? o.id} is primary but ${'the archetype'} is full; demoted to annotation`);
  o.role = 'annotation';
  delete o.assetRef;
  o.primitiveRef = 'label';
  o.collisionPolicy = 'allow';
  o.importance = 'tertiary';
  delete o.preferredZone;
}

function ensureRevealed(scene: VisualSceneV2, objectId: string): void {
  const targeted = scene.beats.some(b => b.actions.some(a => a.objectIds.includes(objectId)));
  if (targeted || scene.beats.length === 0) return;
  scene.beats[0].actions.unshift({
    id: `reveal_${objectId}_fallback`,
    type: 'reveal',
    objectIds: [objectId],
    relationIds: [],
    durationMs: 800,
    leadMs: -180,
    easing: 'linear',
  });
}

/** Break flow cycles deterministically: demote the smallest-id feedback edge to a
 *  direct (`none`) return arc and exclude it from rank computation, keeping the
 *  flow composition and every relation. `flowHasCycle` mirrors this ranking. */
function breakFlowCycle(scene: VisualSceneV2, warnings: string[]): void {
  const ids = new Set(roots(scene).map(o => o.id));
  const rankable = (r: VisualSceneV2['relations'][number]): boolean =>
    ids.has(r.from.objectId) && ids.has(r.to.objectId) && !['labels', 'compares_with'].includes(r.relationType);
  const excluded = new Set<string>();
  for (;;) {
    const rank = new Map<string, number>();
    const pending = new Set(ids);
    let stalled = false;
    let guard = pending.size + 1;
    while (pending.size && guard-- > 0) {
      const ready = [...pending]
        .filter(
          id =>
            scene.relations
              .filter(r => rankable(r) && !excluded.has(r.id) && r.to.objectId === id)
              .every(e => rank.has(e.from.objectId)),
        )
        .sort();
      if (!ready.length) {
        stalled = true;
        break;
      }
      for (const id of ready) {
        rank.set(
          id,
          Math.max(
            0,
            ...scene.relations
              .filter(r => rankable(r) && !excluded.has(r.id) && r.to.objectId === id)
              .map(e => rank.get(e.from.objectId)! + 1),
          ),
        );
        pending.delete(id);
      }
    }
    if (!stalled) return;
    const feedback = scene.relations
      .filter(r => rankable(r) && !excluded.has(r.id) && pending.has(r.from.objectId) && pending.has(r.to.objectId))
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!feedback) return;
    excluded.add(feedback.id);
    feedback.layoutFeedback = true;
    warn(warnings, `flow contains a cycle; demoted ${feedback.id} to a direct return arc`);
  }
}

/** Flow edge-cycle check mirroring the placement ranking (acyclic => rankable).
 *  Direct (`none`) return arcs are excluded from ranking, as in placements. */
function flowHasCycle(scene: VisualSceneV2): boolean {
  const ids = new Set(roots(scene).map(o => o.id));
  const edges = scene.relations.filter(
    r => ids.has(r.from.objectId) && ids.has(r.to.objectId) && !['labels', 'compares_with'].includes(r.relationType) && r.visualForm !== 'none' && !r.layoutFeedback,
  );
  const rank = new Map<string, number>();
  const pending = new Set(ids);
  let guard = pending.size + 1;
  while (pending.size && guard-- > 0) {
    const ready = [...pending].filter(id =>
      edges.filter(e => e.to.objectId === id).every(e => rank.has(e.from.objectId)),
    );
    if (!ready.length) return true;
    for (const id of ready) {
      rank.set(id, Math.max(0, ...edges.filter(e => e.to.objectId === id).map(e => rank.get(e.from.objectId)! + 1)));
      pending.delete(id);
    }
  }
  return pending.size > 0;
}

/** Rank-column overflow check mirroring `archetypePlacements` flow ranking:
 *  returns true when any rank column would hold more than 3 roots. Cycles are
 *  left to `flowHasCycle` (this returns false when ranking stalls). */
function flowColumnOverflow(scene: VisualSceneV2): boolean {
  const ids = new Set(roots(scene).map(o => o.id));
  const edges = scene.relations.filter(
    r => ids.has(r.from.objectId) && ids.has(r.to.objectId) && !['labels', 'compares_with'].includes(r.relationType) && r.visualForm !== 'none' && !r.layoutFeedback,
  );
  const rank = new Map<string, number>();
  const pending = new Set(ids);
  while (pending.size) {
    const ready = [...pending].filter(id =>
      edges.filter(e => e.to.objectId === id).every(e => rank.has(e.from.objectId)),
    );
    if (!ready.length) return false;
    for (const id of ready) {
      rank.set(id, Math.max(0, ...edges.filter(e => e.to.objectId === id).map(e => rank.get(e.from.objectId)! + 1)));
      pending.delete(id);
    }
  }
  const columns = new Map<number, number>();
  for (const r of rank.values()) columns.set(r, (columns.get(r) ?? 0) + 1);
  return [...columns.values()].some(n => n > 3);
}

function fallbackArchetype(scene: VisualSceneV2, warnings: string[], reason: string): void {
  if (scene.archetype === 'structural_diagram') return;
  warn(warnings, `${scene.archetype} ${reason}; using structural_diagram composition`);
  scene.archetype = 'structural_diagram';
}

/** Cap primaries at `max` by demoting extras (deterministic by object id). */
function capPrimaries(scene: VisualSceneV2, warnings: string[], max: number): void {
  const primaries = roots(scene).sort((a, b) => a.id.localeCompare(b.id));
  for (const extra of primaries.slice(max)) {
    demoteToAnnotation(extra, warnings);
    ensureRevealed(scene, extra.id);
    warn(warnings, `${scene.archetype} exceeds ${max} primaries; demoted ${extra.conceptId ?? extra.id} to annotation`);
  }
}

function ensureSingleHero(scene: VisualSceneV2, warnings: string[]): void {
  const primaries = roots(scene);
  const heroes = primaries.filter(o => o.role === 'hero');
  if (heroes.length === 0 && primaries.length > 0) {
    const promoted = [...primaries].sort((a, b) => a.id.localeCompare(b.id))[0];
    promoted.role = 'hero';
    warn(warnings, `no hero for ${scene.archetype}; promoted ${promoted.conceptId ?? promoted.id}`);
  } else if (heroes.length > 1) {
    const [keep, ...extras] = heroes.sort((a, b) => a.id.localeCompare(b.id));
    void keep;
    for (const extra of extras) {
      extra.role = 'support';
      warn(warnings, `multiple heroes for ${scene.archetype}; demoted ${extra.conceptId ?? extra.id} to support`);
    }
  }
}

/** Assets that mark a scene as genuinely matrix-intended. The `=` injection only
 *  fires for such scenes; a non-matrix scene forced into matrix_operation keeps
 *  failing closed (wrong archetype, not a missing token). */
const MATRIX_ASSETS = new Set([
  'math.matrix.v2',
  'math.vector.v2',
  'data.query.v2',
  'data.key.v2',
  'data.value.v2',
  'data.qkv.v2',
  'data.kv.v2',
  'data.latent.v2',
  'data.token.v2',
]);

function ensureMatrixTokens(scene: VisualSceneV2, warnings: string[]): void {
  // Asset-less matrix scenes get the curated grid before the token check, so a
  // genuinely matrix-intended scene is rescued as a whole. Scenes whose objects
  // already carry non-matrix assets are a wrong archetype and keep failing closed.
  if (!roots(scene).some(o => o.assetRef)) {
    const candidate = [...roots(scene)]
      .sort((a, b) => a.id.localeCompare(b.id))
      .find(o => !o.assetRef && (!o.primitiveRef || o.primitiveRef === 'label'));
    if (candidate) {
      candidate.assetRef = 'math.matrix.v2';
      delete candidate.primitiveRef;
      warn(
        warnings,
        `matrix_operation lacks a matrix/vector asset; assigned math.matrix.v2 to ${candidate.conceptId ?? candidate.id}`,
      );
    }
  }
  const primaries = roots(scene);
  const matrixIntended = primaries.some(o => o.assetRef && MATRIX_ASSETS.has(o.assetRef));
  if (!matrixIntended) return;
  if (!primaries.some(o => o.primitiveRef === 'equation')) {
    const injected: VisualObject = {
      id: `eq_fallback_${scene.id}`,
      label: '=',
      role: 'data',
      primitiveRef: 'equation',
      children: [],
      state: 'neutral',
      allowedStates: ['neutral', 'highlighted', 'activated'],
      importance: 'tertiary',
      collisionPolicy: 'allow',
    };
    scene.objects.push(injected);
    ensureRevealed(scene, injected.id);
    warn(warnings, 'matrix_operation lacks an operator/equals token; injected "=" equation token');
  }
}

/** Strip assets that do not support the final archetype (e.g. the resolver
 *  offered a transformation-only asset but the director chose spatial_process).
 *  The concept stays on the board as a labeled primitive; the pick is warned.
 *  Relation anchors that named removed asset subparts degrade to center. */
/** These archetypes are flat text sequences: every object is a label and none
 *  is nested. The old heal only stripped assets, so a composed object
 *  (`representation` + `rectangle`) still failed the compiler's
 *  `primitiveRef !== 'label'` check — which is exactly what happened once the
 *  resolver began producing compositions for most concepts. */
function flattenToLabels(scene: VisualSceneV2, warnings: string[]): void {
  for (const o of scene.objects) {
    if (o.primitiveRef !== 'label') {
      delete o.assetRef;
      delete o.representation;
      o.primitiveRef = 'label';
      warn(warnings, `${scene.archetype} is text-only; converted ${o.conceptId ?? o.id} to label primitive`);
    }
    if (o.parentId !== undefined || o.children.length) {
      delete o.parentId;
      o.children = [];
      if (['contain', 'overlay', 'touch'].includes(o.collisionPolicy)) o.collisionPolicy = 'forbid';
    }
  }
}

const PRIMITIVE_ANCHORS = new Set(['input', 'output', 'center', 'top', 'bottom']);
function ensureAssetCompatibility(scene: VisualSceneV2, warnings: string[], catalog?: Record<string, AssetDefinition>): void {
  const stripped = new Set<string>();
  for (const o of scene.objects) {
    if (!o.assetRef) continue;
    // Unknown asset IDs stay loud - a model inventing an asset is a real
    // failure. A KNOWN asset is always drawable: it is geometry with anchors, and
    // the compiler lays it out in any archetype. This used to demote a known
    // asset to a bare label whenever it did not NAME the archetype, which is why
    // boxes rendered empty and why the post-compile integrity check then reported
    // `Critical representation degraded` for a representation the director had
    // declared correctly.
    let compatible: boolean;
    try {
      resolveAsset(o.assetRef, catalog);
      compatible = true;
    } catch {
      throw new Error(`Unknown asset: ${o.assetRef}`);
    }
    if (!compatible) {
      warn(
        warnings,
        `${o.assetRef} does not support ${scene.archetype}; converted ${o.conceptId ?? o.id} to label primitive`,
      );
      delete o.assetRef;
      o.primitiveRef = 'label';
      stripped.add(o.id);
    }
  }
  for (const r of scene.relations) {
    for (const ref of [r.from, r.to]) {
      if (stripped.has(ref.objectId) && !PRIMITIVE_ANCHORS.has(ref.anchor)) {
        warn(warnings, `anchor ${ref.anchor} removed with its asset; degraded to center (${r.id})`);
        ref.anchor = 'center';
      }
    }
  }
}

export function applyCompositionFallbacks(input: VisualSceneV2, catalog?: Record<string, AssetDefinition>): FallbackOutcome {
  const scene: VisualSceneV2 = structuredClone(input);
  const warnings: string[] = [];
  const count = roots(scene).length;

  switch (scene.archetype) {
    case 'flow':
      if (count < 2 || count > 8) {
        fallbackArchetype(scene, warnings, `needs 2–8 primaries (has ${count})`);
      } else if (flowHasCycle(scene)) {
        breakFlowCycle(scene, warnings);
        if (flowHasCycle(scene)) {
          fallbackArchetype(scene, warnings, 'relations still form a cycle after edge repair');
          ensureSingleHero(scene, warnings);
        }
      } else if (flowColumnOverflow(scene)) {
        fallbackArchetype(scene, warnings, 'would exceed three readable branches per column');
        ensureSingleHero(scene, warnings);
      }
      break;
    case 'cycle':
      // Cycle placement validates its own loop; leave failures loud.
      break;
    case 'comparison':
    case 'transformation':
      if (count > 4) capPrimaries(scene, warnings, 4);
      else if (count < 2) fallbackArchetype(scene, warnings, `needs 2–4 primaries (has ${count})`);
      break;
    case 'cross_section':
    case 'spatial_process':
    case 'structural_diagram':
    case 'convergence':
      ensureSingleHero(scene, warnings);
      if (scene.archetype === 'spatial_process' && roots(scene).filter(o => o.role !== 'hero').length > 4) {
        capPrimaries(scene, warnings, 5);
        ensureSingleHero(scene, warnings);
      }
      break;
    case 'matrix_operation':
      if (count > 6) capPrimaries(scene, warnings, 6);
      ensureMatrixTokens(scene, warnings);
      if (roots(scene).length < 3) {
        fallbackArchetype(scene, warnings, `needs 3–6 equation terms (has ${roots(scene).length})`);
      }
      break;
    case 'equation_walkthrough':
      if (count > 6) capPrimaries(scene, warnings, 6);
      else if (count < 2) fallbackArchetype(scene, warnings, `needs 2–6 derivation lines (has ${count})`);
      break;
    case 'numbered_steps':
    case 'timeline':
    case 'trajectory': {
      flattenToLabels(scene, warnings);
      const primaries = roots(scene).length;
      if (primaries > 7 || (scene.archetype !== 'numbered_steps' && primaries > 6)) {
        capPrimaries(scene, warnings, scene.archetype === 'numbered_steps' ? 7 : 6);
      } else if (primaries < 2 || (scene.archetype === 'trajectory' && primaries < 3)) {
        fallbackArchetype(scene, warnings, `too few primaries (has ${primaries})`);
      }
      break;
    }
    case 'branch':
    case 'cause_effect':
    case 'state_machine':
      if (count > 10) capPrimaries(scene, warnings, 10);
      else if (count < 2) fallbackArchetype(scene, warnings, `needs 2–10 primaries (has ${count})`);
      /** The layered ranking cannot rank a graph with a cycle and the layout then
       *  refuses the scene outright (`Branch graph contains a cycle; choose the
       *  cycle archetype`). Measured: a source-grounded run ended there having
       *  produced nothing. The same deterministic demotion flow uses breaks it -
       *  the smallest-id feedback edge becomes a direct return arc and drops out
       *  of ranking, keeping the composition and every relation. */
      else if (flowHasCycle(scene)) {
        breakFlowCycle(scene, warnings);
        if (flowHasCycle(scene)) fallbackArchetype(scene, warnings, 'relations still form a cycle after edge repair');
      }
      break;
    case 'hierarchy':
      if (count > 12) capPrimaries(scene, warnings, 12);
      else if (count < 2) fallbackArchetype(scene, warnings, `needs 2–12 nodes (has ${count})`);
      break;
    default:
      break;
  }
  // Archetype switches can land on a hero-guarded composition; a flow scene has
  // no hero, so promote one rather than trading one hard failure for another.
  if (['structural_diagram', 'convergence', 'cross_section', 'spatial_process'].includes(scene.archetype)) {
    ensureSingleHero(scene, warnings);
  }
  // Last: an asset that cannot render under the final archetype becomes a label.
  ensureAssetCompatibility(scene, warnings, catalog);
  return { scene, warnings };
}
