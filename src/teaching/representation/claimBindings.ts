import type { TeachingBeat } from '../beat-plan/types.js';
import type { SemanticOp } from '../semantic-ir/types.js';
import type { RepresentationProblem } from './providerRegistry.js';

interface CanonicalClaim {
  id: string;
  conceptIds?: readonly string[];
  relations?: ReadonlyArray<{ from: string; to: string; type: string }>;
}

/** Attribute a typed relation to every exact event claim, rather than another claim on the same beat. */
export function semanticRelationClaimProblems(
  operations: readonly SemanticOp[],
  beat: TeachingBeat,
  claims: readonly CanonicalClaim[],
): RepresentationProblem[] {
  const problems: RepresentationProblem[] = [];
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  for (const [index, operation] of operations.entries()) {
    if (operation.type !== 'cause') continue;
    const from = beat.entities.find((entity) => entity.entityId === operation.relation.fromEntityId)?.conceptId;
    const to = beat.entities.find((entity) => entity.entityId === operation.relation.toEntityId)?.conceptId;
    for (const [claimIndex, claimId] of operation.claimIds.entries()) {
      const claim = claimsById.get(claimId);
      if (!from || !to || !claim?.conceptIds?.includes(from) || !claim.conceptIds.includes(to)
        || !claim.relations?.some((relation) => relation.from === from && relation.to === to && relation.type === operation.relation.type)) {
        problems.push({ path: `/operations/${index}/claimIds/${claimIndex}`, message: `claim ${claimId} does not assert the exact typed relation ${from ?? '?'} -[${operation.relation.type}]-> ${to ?? '?'}` });
      }
    }
  }
  return problems;
}
