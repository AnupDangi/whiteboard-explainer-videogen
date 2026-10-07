import type { ConceptGraph, SceneContract } from '../../plan/schemas.js';
import type { ValidatorProblem } from '../../llm/structuredCall.js';
import type { BeatPlanDraft, RelationSpec } from './types.js';
import type { ClaimSemantics } from '../../evidence/claims.js';
import type { ClaimVerificationStatus, EpistemicType } from '../../evidence/ledger.js';
import type { VisualVocabulary } from '../../planner/visualDiscovery.js';
import { representationSelectionProblems } from './representationRegistry.js';

export interface BeatContext {
  sceneId: string;
  conceptIds: string[];
  claims: Array<{ id: string; statement: string; conceptIds: string[]; relations: RelationSpec[]; evidenceSpanIds: string[]; semantics?: ClaimSemantics; epistemicType?: EpistemicType; verificationStatus?: ClaimVerificationStatus }>;
  /** Graph-backed relations among this scene's concepts. */
  relations: RelationSpec[];
  /** m1, m2 ... one per scene misconceptionRisk entry. */
  misconceptionIds: string[];
  durationSec: number;
  /** Validated depiction choices shared with narration and rendering. */
  visualVocabulary?: VisualVocabulary;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** One beat is about one thought, 4-10 s of speech: the range follows scene length and is the same for every topic. */
export function beatCountRange(durationSec: number): { min: number; max: number } {
  const max = clamp(Math.floor(durationSec / 4), 2, 8);
  return { min: clamp(Math.ceil(durationSec / 10), 1, max), max };
}

const relationKey = (r: { from: string; to: string; type: string }): string => `${r.from}|${r.type}|${r.to}`;

/** A beat is one spoken thought: beyond this many semantic-change events (any kind combined) a single beat cannot carry distinct non-overlapping narration anchors for all of them. Split the excess into another beat that cites the same claim(s); beatCountRange already allows several beats per claim. */
export const MAX_SEMANTIC_CHANGES_PER_BEAT = 4;

export function beatContextFor(section: { id: string; conceptIds: string[]; budgetSec: number; contract?: SceneContract }, graph: ConceptGraph, visualVocabulary?: VisualVocabulary): BeatContext {
  const contract = section.contract;
  if (!contract) throw new Error(`section ${section.id} has no scene contract; beats are planned from the S3 contract`);
  const conceptIds = [...new Set([...section.conceptIds, ...contract.requiredConceptIds])];
  const inScene = new Set(conceptIds);
  return {
    sceneId: section.id,
    conceptIds,
    ...(visualVocabulary ? { visualVocabulary: { ...visualVocabulary, sceneId: section.id, concepts: visualVocabulary.concepts.filter((concept) => inScene.has(concept.conceptId)) } } : {}),
    claims: contract.essentialClaims.map((claim) => ({ id: claim.id, statement: claim.statement, conceptIds: claim.conceptIds, relations: claim.relations, evidenceSpanIds: claim.evidenceSpanIds, ...(claim.semantics ? { semantics: claim.semantics } : {}), ...(claim.epistemicType ? { epistemicType: claim.epistemicType } : {}), ...(claim.verificationStatus ? { verificationStatus: claim.verificationStatus } : {}) })),
    relations: graph.relations.filter((r) => inScene.has(r.from) && inScene.has(r.to)).map(({ from, to, type }) => ({ from, to, type })),
    misconceptionIds: (contract.misconceptionRisk ?? []).map((_, index) => `m${index + 1}`),
    durationSec: contract.targetDurationSec || section.budgetSec,
  };
}

/** Deterministic checks of a beat plan. Every problem names its JSON pointer so the repair can patch just that location. */
export function validateBeatPlan(plan: BeatPlanDraft, ctx: BeatContext): ValidatorProblem[] {
  const problems: ValidatorProblem[] = [];
  const claimsById = new Map(ctx.claims.map((claim) => [claim.id, claim]));
  const claimIds = new Set(claimsById.keys());
  const concepts = new Set(ctx.conceptIds);
  const misconceptions = new Set(ctx.misconceptionIds);
  const covered = new Set<string>();
  const beatCountByClaim = new Map<string, number>();
  const conceptByIdentityKey = new Map<string, string>();
  const seenIdentityKeys = new Set<string>();
  const activeIdentityKeys = new Set<string>();
  const currentSemanticStates = new Map<string, string>();
  const statefulChanges = new Set(['flow', 'transform', 'move', 'separate', 'quantity_update', 'select', 'finalize', 'plot', 'feedback']);
  plan.beats.forEach((beat, i) => {
    const at = `/beats/${i}`;
    if (!/[?？]$/u.test(beat.learningQuestion.trim())) problems.push({ path: `${at}/learningQuestion`, message: 'learningQuestion must be phrased as a question' });
    for (const message of representationSelectionProblems(beat)) problems.push({ path: `${at}/representationFamily`, message });
    if (beat.learnerBefore.trim().toLowerCase() === beat.learnerAfter.trim().toLowerCase()) problems.push({ path: `${at}/learnerAfter`, message: 'learnerAfter must describe a state different from learnerBefore' });
    const seenDependencies = new Set<number>();
    beat.dependsOnOrders.forEach((order, dependencyIndex) => {
      if (seenDependencies.has(order)) problems.push({ path: `${at}/dependsOnOrders/${dependencyIndex}`, message: `beat order ${order} is listed more than once` });
      seenDependencies.add(order);
      if (order >= i + 1) problems.push({ path: `${at}/dependsOnOrders/${dependencyIndex}`, message: `dependency ${order} must reference an earlier beat order` });
    });
    beat.claimIds.forEach((claimId, j) => {
      if (!claimIds.has(claimId)) problems.push({ path: `${at}/claimIds/${j}`, message: `unknown claim ${claimId}; use one of: ${[...claimIds].join(', ')}` });
      else { covered.add(claimId); beatCountByClaim.set(claimId, (beatCountByClaim.get(claimId) ?? 0) + 1); }
    });
    const citedClaims = beat.claimIds.flatMap((claimId) => {
      const claim = claimsById.get(claimId);
      return claim ? [claim] : [];
    });
    const beatEntityKeys = new Set<string>();
    const newlySeenEntityKeys = new Set<string>();
    const separateChanges = beat.requiredSemanticChanges.filter((change) => change.kind === 'separate');
    const mergeChanges = beat.requiredSemanticChanges.filter((change) => change.kind === 'merge');
    if (beat.requiredSemanticChanges.length > MAX_SEMANTIC_CHANGES_PER_BEAT) problems.push({ path: `${at}/requiredSemanticChanges`, message: `a beat may require at most ${MAX_SEMANTIC_CHANGES_PER_BEAT} semantic changes (any kind combined), got ${beat.requiredSemanticChanges.length}; move the excess changes into an additional beat that cites the same claim(s) (${beat.claimIds.join(', ') || 'none'}) instead of packing them all into one spoken beat` });
    if (separateChanges.length > 1) problems.push({ path: `${at}/requiredSemanticChanges`, message: 'a state-transition beat may contain at most one separate change until multi-separation composition is implemented' });
    if (mergeChanges.length > 1) problems.push({ path: `${at}/requiredSemanticChanges`, message: 'a state-transition beat may contain at most one merge change until multi-merge composition is implemented' });
    if (separateChanges.length && mergeChanges.length) problems.push({ path: `${at}/requiredSemanticChanges`, message: 'a state-transition beat cannot combine separate and merge changes yet' });
    const unverifiedClaims = citedClaims.filter((claim) => claim.epistemicType === 'unverified_explanation' || claim.verificationStatus === 'unverified');
    if (unverifiedClaims.length) {
      if (beat.claimIds.length !== 1 || beat.claimIds[0] !== unverifiedClaims[0]!.id) problems.push({ path: `${at}/claimIds`, message: 'an unverified explanation must be isolated in a beat that cites only that one claim' });
      if (!beat.narrationOnly) problems.push({ path: `${at}/narrationOnly`, message: 'an unverified explanation must be narration-only and cannot be visualized' });
      if (beat.relationships.length) problems.push({ path: `${at}/relationships`, message: 'an unverified explanation cannot introduce a graph relation' });
      if (beat.entities.length) problems.push({ path: `${at}/entities`, message: 'an unverified explanation beat cannot depict entities' });
    }
    beat.entities.forEach((entity, j) => {
      const path = `${at}/entities/${j}`;
      if (beatEntityKeys.has(entity.identityKey)) problems.push({ path: `${path}/identityKey`, message: `identity key ${entity.identityKey} is repeated in one beat` });
      beatEntityKeys.add(entity.identityKey);
      const priorConceptId = conceptByIdentityKey.get(entity.identityKey);
      if (priorConceptId && priorConceptId !== entity.conceptId) problems.push({ path: `${path}/conceptId`, message: `persistent identity ${entity.identityKey} changes concept from ${priorConceptId} to ${entity.conceptId}` });
      else conceptByIdentityKey.set(entity.identityKey, entity.conceptId);
      if (!seenIdentityKeys.has(entity.identityKey)) newlySeenEntityKeys.add(entity.identityKey);
      if (!concepts.has(entity.conceptId)) {
        problems.push({ path: `${path}/conceptId`, message: `${entity.conceptId} is not a concept of this scene; use one of: ${ctx.conceptIds.join(', ')}` });
        return;
      }
      if (!citedClaims.some((claim) => claim.conceptIds.includes(entity.conceptId))) {
        problems.push({ path: `${path}/conceptId`, message: `${entity.conceptId} is not linked to any cited claim (${beat.claimIds.join(', ')}); cite a claim containing this concept or remove the entity` });
      }
    });
    const revealKeys = new Set<string>();
    beat.semanticRevealOrder.forEach((identityKey, revealIndex) => {
      if (revealKeys.has(identityKey)) problems.push({ path: `${at}/semanticRevealOrder/${revealIndex}`, message: `identity key ${identityKey} is repeated in semanticRevealOrder` });
      revealKeys.add(identityKey);
      if (!beatEntityKeys.has(identityKey)) problems.push({ path: `${at}/semanticRevealOrder/${revealIndex}`, message: `identity key ${identityKey} is not declared by this beat` });
      if (seenIdentityKeys.has(identityKey)) problems.push({ path: `${at}/semanticRevealOrder/${revealIndex}`, message: `identity key ${identityKey} was already revealed by an earlier beat` });
    });
    if (separateChanges.length === 1) {
      const sourceKey = separateChanges[0]!.identityKey;
      const resultKeys = [...newlySeenEntityKeys].filter((identityKey) => identityKey !== sourceKey);
      if (resultKeys.length < 2 || resultKeys.length > 6) {
        problems.push({ path: `${at}/semanticRevealOrder`, message: `a separate change needs 2 through 6 newly revealed result entities besides its source; got ${resultKeys.length}` });
      }
      if (newlySeenEntityKeys.has(sourceKey)) {
        const sourceIntroduceIndex = beat.requiredSemanticChanges.findIndex((change) => change.identityKey === sourceKey && change.kind === 'introduce');
        const separateIndex = beat.requiredSemanticChanges.findIndex((change) => change.kind === 'separate');
        if (sourceIntroduceIndex < 0 || sourceIntroduceIndex >= separateIndex) {
          problems.push({ path: `${at}/requiredSemanticChanges`, message: 'a source first revealed in the same beat must be introduced before it is separated' });
        }
      }
    }
    if (mergeChanges.length === 1) {
      const merge = mergeChanges[0]!;
      const mergeIndex = beat.requiredSemanticChanges.indexOf(merge);
      const inputKeys = merge.mergeInputIdentityKeys ?? [];
      if (inputKeys.length < 2 || inputKeys.length > 6) {
        problems.push({ path: `${at}/requiredSemanticChanges/${mergeIndex}/mergeInputIdentityKeys`, message: 'a merge must name two through six ordered source identities' });
      }
      if (inputKeys.includes(merge.identityKey)) {
        problems.push({ path: `${at}/requiredSemanticChanges/${mergeIndex}/mergeInputIdentityKeys`, message: 'a merge result must use a new identity distinct from every input' });
      }
      if (seenIdentityKeys.has(merge.identityKey)) {
        problems.push({ path: `${at}/requiredSemanticChanges/${mergeIndex}/identityKey`, message: 'a merge creates a new result entity and cannot reuse an earlier identity' });
      }
      if (beat.requiredSemanticChanges.some((change) => change.identityKey === merge.identityKey && change.kind === 'introduce')) {
        problems.push({ path: `${at}/requiredSemanticChanges/${mergeIndex}/identityKey`, message: 'a merge result cannot also have an introduce change' });
      }
      const resultEntity = beat.entities.find((entity) => entity.identityKey === merge.identityKey);
      if (resultEntity?.state && resultEntity.state !== merge.toState) {
        problems.push({ path: `${at}/entities/${beat.entities.indexOf(resultEntity)}/state`, message: 'merge result state must match the required change toState' });
      }
      const resultRevealIndex = beat.semanticRevealOrder.indexOf(merge.identityKey);
      for (const inputKey of inputKeys) {
        if (!beatEntityKeys.has(inputKey)) {
          problems.push({ path: `${at}/requiredSemanticChanges/${mergeIndex}/mergeInputIdentityKeys`, message: `merge input ${inputKey} must be declared in this beat's entities` });
          continue;
        }
        if (newlySeenEntityKeys.has(inputKey)) {
          const introduceIndex = beat.requiredSemanticChanges.findIndex((change) => change.identityKey === inputKey && change.kind === 'introduce');
          if (introduceIndex < 0 || introduceIndex >= mergeIndex) {
            problems.push({ path: `${at}/requiredSemanticChanges/${mergeIndex}/mergeInputIdentityKeys`, message: `new merge input ${inputKey} must be introduced before the merge` });
          }
          const inputRevealIndex = beat.semanticRevealOrder.indexOf(inputKey);
          if (resultRevealIndex >= 0 && inputRevealIndex > resultRevealIndex) {
            problems.push({ path: `${at}/semanticRevealOrder`, message: `new merge input ${inputKey} must be revealed before the merge result ${merge.identityKey}` });
          }
        }
        const inputEntity = beat.entities.find((entity) => entity.identityKey === inputKey);
        if (inputEntity && !inputEntity.state?.trim()) {
          problems.push({ path: `${at}/entities/${beat.entities.indexOf(inputEntity)}/state`, message: `merge input ${inputKey} must declare its exact active state` });
        }
      }
    }
    for (const identityKey of newlySeenEntityKeys) {
      if (!revealKeys.has(identityKey)) problems.push({ path: `${at}/semanticRevealOrder`, message: `new semantic entity ${identityKey} must appear in its first-reveal order` });
      const isSeparatedResult = separateChanges.length === 1 && separateChanges[0]!.identityKey !== identityKey;
      const isMergedResult = mergeChanges.length === 1 && mergeChanges[0]!.identityKey === identityKey;
      if (!beat.requiredSemanticChanges.some((change) => change.identityKey === identityKey && change.kind === 'introduce') && !isSeparatedResult && !isMergedResult) {
        problems.push({ path: `${at}/requiredSemanticChanges`, message: `new semantic entity ${identityKey} needs an introduce change` });
      }
    }
    beat.requiredSemanticChanges.forEach((change, changeIndex) => {
      const path = `${at}/requiredSemanticChanges/${changeIndex}`;
      if (!beatEntityKeys.has(change.identityKey)) problems.push({ path: `${path}/identityKey`, message: `semantic change references entity ${change.identityKey} which is not declared by this beat` });
      if (change.kind !== 'merge' && change.mergeInputIdentityKeys !== undefined) {
        problems.push({ path: `${path}/mergeInputIdentityKeys`, message: 'merge input identities are allowed only on a merge change' });
      }
      if (change.kind === 'merge' && change.fromState !== undefined) {
        problems.push({ path: `${path}/fromState`, message: 'merge source states are declared on each input entity; omit the shared fromState' });
      }
      if (statefulChanges.has(change.kind) && !change.fromState?.trim()) problems.push({ path: `${path}/fromState`, message: `${change.kind} requires a fromState so the expected state transition is explicit` });
      if (beat.claimIds.length > 1 && !change.claimIds) problems.push({ path: `${path}/claimIds`, message: 'a semantic change in a multi-claim beat must name the exact claim ids it supports' });
      const eventClaimIds = change.claimIds ?? (beat.claimIds.length === 1 ? beat.claimIds : []);
      if (!eventClaimIds.length) problems.push({ path: `${path}/claimIds`, message: 'a semantic change must be bound to at least one canonical claim' });
      if (new Set(eventClaimIds).size !== eventClaimIds.length) problems.push({ path: `${path}/claimIds`, message: 'semantic change claim ids must be unique' });
      const entity = beat.entities.find((candidate) => candidate.identityKey === change.identityKey);
      if (change.kind === 'cause') {
        const candidates = beat.relationships.filter((relation) => relation.type === 'causes' && relation.from === entity?.conceptId);
        if (candidates.length !== 1) problems.push({ path, message: 'a cause change must resolve to exactly one outgoing causes relation from its declared entity; repair only this semantic-change record so its kind and source identity agree with the pinned edge' });
        else {
          const relation = candidates[0]!;
          for (const conceptId of [relation.from, relation.to]) {
            if (beat.entities.filter((candidate) => candidate.conceptId === conceptId).length !== 1) problems.push({ path: `${at}/entities`, message: `cause endpoint ${conceptId} must resolve to exactly one declared entity` });
          }
          for (const [claimIndex, claimId] of eventClaimIds.entries()) {
            if (!claimsById.get(claimId)?.relations.some((candidate) => relationKey(candidate) === relationKey(relation))) {
              problems.push({ path: `${path}/claimIds/${claimIndex}`, message: `claim ${claimId} does not assert the cause event's exact directed relation` });
            }
          }
        }
      }
      if (change.kind === 'introduce') {
        activeIdentityKeys.add(change.identityKey);
        currentSemanticStates.set(change.identityKey, change.toState);
      }
      if (change.kind === 'transform') currentSemanticStates.set(change.identityKey, change.toState);
      if (change.kind === 'separate') {
        activeIdentityKeys.delete(change.identityKey);
        currentSemanticStates.delete(change.identityKey);
        for (const resultKey of newlySeenEntityKeys) if (resultKey !== change.identityKey) {
          activeIdentityKeys.add(resultKey);
          const resultEntity = beat.entities.find((candidate) => candidate.identityKey === resultKey);
          if (resultEntity?.state) currentSemanticStates.set(resultKey, resultEntity.state);
        }
      }
      if (change.kind === 'finalize') {
        activeIdentityKeys.delete(change.identityKey);
        currentSemanticStates.delete(change.identityKey);
      }
      if (change.kind === 'merge') {
        for (const [inputIndex, inputKey] of (change.mergeInputIdentityKeys ?? []).entries()) {
          if (inputKey === change.identityKey) continue;
          if (!beatEntityKeys.has(inputKey)) continue;
          if (!activeIdentityKeys.has(inputKey)) {
            problems.push({ path: `${path}/mergeInputIdentityKeys/${inputIndex}`, message: `merge input ${inputKey} must be active before this event` });
          }
          const inputEntity = beat.entities.find((candidate) => candidate.identityKey === inputKey);
          if (inputEntity?.state && currentSemanticStates.get(inputKey) !== inputEntity.state) {
            problems.push({ path: `${at}/entities/${beat.entities.indexOf(inputEntity)}/state`, message: `merge input ${inputKey} state must match its current semantic state` });
          }
          activeIdentityKeys.delete(inputKey);
          currentSemanticStates.delete(inputKey);
        }
        if (!seenIdentityKeys.has(change.identityKey)) {
          activeIdentityKeys.add(change.identityKey);
          currentSemanticStates.set(change.identityKey, change.toState);
        }
      }
      for (const [claimIndex, claimId] of eventClaimIds.entries()) {
        if (!beat.claimIds.includes(claimId)) {
          problems.push({ path: `${path}/claimIds/${claimIndex}`, message: `semantic change claim ${claimId} is not listed by this beat` });
          continue;
        }
        const claim = claimsById.get(claimId);
        if (!claim) continue;
        if (entity && !claim.conceptIds.includes(entity.conceptId)) {
          problems.push({ path: `${path}/claimIds/${claimIndex}`, message: `claim ${claimId} does not include the changed entity concept ${entity.conceptId}` });
        }
        if (change.kind === 'merge') {
          for (const inputKey of change.mergeInputIdentityKeys ?? []) {
            const inputEntity = beat.entities.find((candidate) => candidate.identityKey === inputKey);
            if (inputEntity && !claim.conceptIds.includes(inputEntity.conceptId)) {
              problems.push({ path: `${path}/claimIds/${claimIndex}`, message: `claim ${claimId} does not include merge input concept ${inputEntity.conceptId}` });
            }
          }
        }
      }
    });
    if (beat.narrationOnly && beat.requiredSemanticChanges.length) problems.push({ path: `${at}/requiredSemanticChanges`, message: 'a narration-only beat cannot require visual semantic changes' });
    if (beat.narrationOnly && beat.semanticRevealOrder.length) problems.push({ path: `${at}/semanticRevealOrder`, message: 'a narration-only beat cannot reveal visual entities' });
    beat.relationships.forEach((relation, j) => {
      if (!citedClaims.some((claim) => claim.relations.some((claimedRelation) => relationKey(claimedRelation) === relationKey(relation)))) {
        problems.push({ path: `${at}/relationships/${j}`, message: `${relation.from} -[${relation.type}]-> ${relation.to} is not asserted by any cited claim (${beat.claimIds.join(', ')}); cite a claim that lists this directed relation or remove/revise it` });
      }
    });
    beat.misconceptionIds.forEach((misconceptionId, j) => { if (!misconceptions.has(misconceptionId)) problems.push({ path: `${at}/misconceptionIds/${j}`, message: `unknown misconception ${misconceptionId}; use one of: ${ctx.misconceptionIds.join(', ') || '(none: leave the list empty)'}` }); });
    if (!beat.visualInvariant.trim()) problems.push({ path: `${at}/visualInvariant`, message: 'visualInvariant must say what is visible when the beat ends' });
    if (!beat.narrationOnly && !beat.mutedMeaning.trim()) problems.push({ path: `${at}/mutedMeaning`, message: 'a visual beat needs a muted meaning: what a viewer with the sound off should conclude from the board' });
    if (!beat.narrationOnly && !beat.entities.length) problems.push({ path: `${at}/entities`, message: 'a visual beat needs at least one entity to show' });
    if (!beat.narrationOnly && !beat.requiredSemanticChanges.length) problems.push({ path: `${at}/requiredSemanticChanges`, message: 'a visual beat must name at least one required semantic change' });
    for (const identityKey of beatEntityKeys) seenIdentityKeys.add(identityKey);
  });
  const range = beatCountRange(ctx.durationSec);
  if (plan.beats.length < range.min) problems.push({ path: '/beats', message: `a ${ctx.durationSec}s scene needs at least ${range.min} beats, got ${plan.beats.length}` });
  if (plan.beats.length > range.max) problems.push({ path: '/beats', message: `a ${ctx.durationSec}s scene allows at most ${range.max} beats, got ${plan.beats.length}` });
  for (const claim of ctx.claims) {
    if (!covered.has(claim.id)) problems.push({ path: '/beats', message: `claim ${claim.id} is not covered by any beat; add a beat whose claimIds include it` });
    if ((claim.epistemicType === 'unverified_explanation' || claim.verificationStatus === 'unverified') && beatCountByClaim.get(claim.id) !== 1) {
      problems.push({ path: '/beats', message: `unverified explanation claim ${claim.id} must appear in exactly one isolated narration-only beat` });
    }
  }
  return problems;
}
