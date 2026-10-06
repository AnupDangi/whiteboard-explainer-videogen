import type { SceneContract } from '../plan/schemas.js';

type ContractClaim = SceneContract['essentialClaims'][number];
type RelationType = ContractClaim['relations'][number]['type'];

export interface ClaimIdentityConcept {
  conceptId: string;
  /** Canonical display label loaded from the code-owned concept graph. */
  label: string;
}

export interface ClaimIdentityRelation {
  fromConceptId: string;
  toConceptId: string;
  type: RelationType;
  fromLabel: string;
  toLabel: string;
  /** True only when the canonical claim explicitly expresses a recognized predicate between these labels. */
  lexicallyExpressed: boolean;
  /** Parser result for the canonical claim; a mismatch with the contract is itself rejected. */
  canonicalPredicateType?: RelationType;
  canonicalDirection?: 'forward' | 'reverse';
}

/** Deterministic identity constraints derived from a SceneContract and graph labels, never from model narration. */
export interface ClaimIdentity {
  concepts: ClaimIdentityConcept[];
  relations: ClaimIdentityRelation[];
}

export type ClaimIdentityMismatch =
  | { kind: 'missing_concept'; conceptId: string; label: string }
  | { kind: 'canonical_contract_conflict'; fromConceptId: string; toConceptId: string; expectedType: RelationType; canonicalType: RelationType; canonicalDirection: 'forward' | 'reverse' }
  | { kind: 'relation_not_preserved'; fromConceptId: string; toConceptId: string; expectedType: RelationType; fromLabel: string; toLabel: string }
  | { kind: 'relation_direction_reversed'; fromConceptId: string; toConceptId: string; expectedType: RelationType; fromLabel: string; toLabel: string }
  | { kind: 'relation_predicate_changed'; fromConceptId: string; toConceptId: string; expectedType: RelationType; actualType: RelationType; fromLabel: string; toLabel: string };

interface PredicateForms {
  active: readonly RegExp[];
  passive: readonly RegExp[];
}

/*
 * Deliberately finite aliases. Active forms link the preceding concept to the
 * following one; passive forms link the following concept to the preceding
 * one. This is an identity check, not a general entailment parser.
 */
const PREDICATES: Record<RelationType, PredicateForms> = {
  causes: {
    active: [/\bcaus(?:e|es)\b/iu, /\bcaused\b(?!\s+by)/iu, /\bleads?\s+to\b/iu, /\bresults?\s+in\b/iu, /\btriggers?\b/iu, /\bdrives?\b/iu, /\binduces?\b/iu, /\braises?\b/iu],
    passive: [/\b(?:is|are|was|were|be|been|being)\s+caused\s+by\b/iu, /\bcaused\s+by\b/iu, /\bresults?\s+from\b/iu, /\btriggered\s+by\b/iu, /\b(?:is|are|was|were|be|been|being)\s+(?:driven|induced)\s+by\b/iu, /\b(?:driven|induced)\s+by\b/iu],
  },
  feeds: {
    active: [/\bfeeds?\s+into\b/iu, /\bfeeds?\b/iu, /\bsupplies?\b/iu],
    passive: [/\b(?:is|are|was|were|be|been|being)\s+fed\s+by\b/iu, /\bfed\s+by\b/iu],
  },
  contains: {
    active: [/\bcontains?\b/iu, /\bincludes?\b/iu, /\bholds?\b/iu],
    passive: [/\b(?:is|are|was|were|be|been|being)\s+contained\s+in\b/iu, /\bcontained\s+in\b/iu, /\bbelongs?\s+to\b/iu],
  },
  compares: {
    active: [/\bcompares?\s+(?:with|to|against)\b/iu, /\bcompared\s+(?:with|to|against)\b/iu],
    passive: [/\bcompared\s+(?:with|to|against)\b/iu],
  },
  transforms: {
    active: [/\btransforms?\s+into\b/iu, /\bconverts?\s+into\b/iu, /\bchanges?\s+into\b/iu, /\bturns?\s+into\b/iu, /\bbecomes?\b/iu],
    passive: [/\b(?:is|are|was|were|be|been|being)\s+(?:transformed|converted|changed|turned)\s+into\b/iu, /\b(?:transformed|converted|changed|turned)\s+into\b/iu],
  },
  requires: {
    active: [/\brequires?\b/iu, /\bneeds?\b/iu, /\bdepends?\s+on\b/iu],
    passive: [/\b(?:is|are|was|were|be|been|being)\s+required\s+by\b/iu, /\brequired\s+by\b/iu, /\bneeded\s+by\b/iu],
  },
  produces: {
    active: [/\bproduces?\b/iu, /\bgenerates?\b/iu, /\byields?\b/iu],
    passive: [/\b(?:is|are|was|were|be|been|being)\s+(?:produced|generated|yielded)\s+by\b/iu, /\b(?:produced|generated|yielded)\s+by\b/iu],
  },
  opposes: {
    active: [/\bopposes?\b/iu, /\binhibits?\b/iu, /\bblocks?\b/iu, /\bcounteracts?\b/iu],
    passive: [/\b(?:is|are|was|were|be|been|being)\s+(?:opposed|inhibited|blocked)\s+by\b/iu, /\b(?:opposed|inhibited|blocked)\s+by\b/iu],
  },
  supports: {
    active: [/\bsupports?\b/iu, /\benables?\b/iu, /\breinforces?\b/iu, /\bsustains?\b/iu],
    passive: [/\b(?:is|are|was|were|be|been|being)\s+(?:supported|enabled|reinforced|sustained)\s+by\b/iu, /\b(?:supported|enabled|reinforced|sustained)\s+by\b/iu],
  },
  excepts: {
    active: [/\bexcepts?\b/iu, /\bexcludes?\b/iu],
    passive: [/\b(?:is|are|was|were|be|been|being)\s+excluded\s+by\b/iu, /\bexcluded\s+by\b/iu],
  },
  branches: {
    active: [/\bbranches?\s+into\b/iu, /\bbranches?\s+to\b/iu],
    passive: [/\bbranches?\s+from\b/iu],
  },
  precedes: {
    active: [/\bprecedes?\b/iu, /\bcomes?\s+before\b/iu, /\boccurs?\s+before\b/iu],
    passive: [/\bfollows?\b/iu, /\bcomes?\s+after\b/iu, /\boccurs?\s+after\b/iu],
  },
};

const labelTokens = (label: string): string[] => label.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const crossesClauseBoundary = (text: string): boolean => /[.!?;]/u.test(text)
  || /,\s*(?:and|but|while|whereas|however|although|yet|so)\b/iu.test(text);

function labelPattern(label: string): RegExp | undefined {
  const tokens = labelTokens(label);
  if (!tokens.length) return undefined;
  const core = tokens.map(escapeRegex).join('[\\s\\p{P}]+');
  // Concept labels are nouns in this graph. Accept their simple English plural
  // when the label ends in a non-sibilant noun token; keep aliases controlled.
  const final = tokens.at(-1)!;
  const plural = final.endsWith('y') && !/[aeiou]y$/iu.test(final)
    ? `${tokens.slice(0, -1).map(escapeRegex).join('[\\s\\p{P}]+')}${tokens.length > 1 ? '[\\s\\p{P}]+' : ''}${escapeRegex(final.slice(0, -1))}ies`
    : /(?:s|x|z|ch|sh)$/iu.test(final) ? core : `${core}s`;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${core}|${plural})(?![\\p{L}\\p{N}])`, 'giu');
}

interface Mention { conceptId: string; label: string; start: number; end: number }

function mentionsIn(text: string, concepts: readonly ClaimIdentityConcept[]): Mention[] {
  const mentions = concepts.flatMap((concept) => {
    const pattern = labelPattern(concept.label);
    return pattern ? [...text.matchAll(pattern)].map((match) => ({ conceptId: concept.conceptId, label: concept.label, start: match.index!, end: match.index! + match[0].length })) : [];
  });
  return mentions.sort((a, b) => a.start - b.start || a.end - b.end || a.conceptId.localeCompare(b.conceptId));
}

interface PredicateMatch { type: RelationType; direction: 'forward' | 'reverse' }
interface PredicateOrientation { type: RelationType; orientation: 'left_to_right' | 'right_to_left' }

function predicateMatchesBetween(text: string, left: Mention, right: Mention): PredicateOrientation[] {
  if (left.end > right.start || crossesClauseBoundary(text.slice(left.end, right.start))) return [];
  const middle = text.slice(left.end, right.start);
  const matches: PredicateOrientation[] = [];
  for (const [type, forms] of Object.entries(PREDICATES) as Array<[RelationType, PredicateForms]>) {
    if (forms.active.some((pattern) => pattern.test(middle))) matches.push({ type, orientation: 'left_to_right' });
    if (forms.passive.some((pattern) => pattern.test(middle))) matches.push({ type, orientation: 'right_to_left' });
  }
  return matches;
}

function relationMatches(text: string, fromId: string, toId: string, concepts: readonly ClaimIdentityConcept[]): PredicateMatch[] {
  const endpoints = mentionsIn(text, concepts).filter((mention) => mention.conceptId === fromId || mention.conceptId === toId);
  const matches: PredicateMatch[] = [];
  for (let i = 0; i < endpoints.length; i += 1) for (let j = i + 1; j < endpoints.length; j += 1) {
    const left = endpoints[i]!; const right = endpoints[j]!;
    if (left.conceptId === right.conceptId || left.start === right.start) continue;
    const between = text.slice(left.end, right.start);
    if (crossesClauseBoundary(between)) continue;
    // Any other graph-linked concept in the same span makes the endpoint pair
    // ambiguous. This avoids joining predicates across independent clauses.
    if (mentionsIn(text, concepts).some((mention) => mention.conceptId !== left.conceptId && mention.conceptId !== right.conceptId && mention.start >= left.end && mention.end <= right.start)) continue;
    const local = predicateMatchesBetween(text, left, right);
    const leftIsFrom = left.conceptId === fromId;
    for (const match of local) {
      const semanticDirection = match.orientation === 'left_to_right' ? leftIsFrom : !leftIsFrom;
      matches.push({ type: match.type, direction: semanticDirection ? 'forward' : 'reverse' });
    }
  }
  // Deduplicate aliases which recognize the same phrase more than once.
  return [...new Map(matches.map((match) => [`${match.type}:${match.direction}`, match])).values()];
}

/** Build claim identity from the canonical contract and graph labels. */
export function deriveClaimIdentity(
  claim: Pick<ContractClaim, 'statement' | 'conceptIds' | 'relations'>,
  graphConcepts: readonly { id: string; label: string }[],
): ClaimIdentity {
  const byId = new Map(graphConcepts.map((concept) => [concept.id, concept.label]));
  const linked = claim.conceptIds.flatMap((conceptId) => {
    const label = byId.get(conceptId);
    return label ? [{ conceptId, label }] : [];
  });
  const canonicalMentions = mentionsIn(claim.statement, linked);
  const explicitIds = new Set(canonicalMentions.map((mention) => mention.conceptId));
  const concepts = linked.filter((concept) => explicitIds.has(concept.conceptId));
  const relations = claim.relations.flatMap((relation) => {
    const fromLabel = byId.get(relation.from); const toLabel = byId.get(relation.to);
    if (!fromLabel || !toLabel) return [];
    const matches = relationMatches(claim.statement, relation.from, relation.to, concepts);
    const matching = matches.find((match) => match.type === relation.type);
    const first = matching ?? matches[0];
    return [{
      fromConceptId: relation.from,
      toConceptId: relation.to,
      type: relation.type,
      fromLabel,
      toLabel,
      lexicallyExpressed: matches.length > 0,
      ...(first ? { canonicalPredicateType: first.type, canonicalDirection: first.direction } : {}),
    }];
  });
  return { concepts, relations };
}

/** Compare candidate narration to the code-derived identity; returns only deterministic lexical mismatches. */
export function claimIdentityMismatch(identity: ClaimIdentity, candidateText: string): ClaimIdentityMismatch[] {
  const problems: ClaimIdentityMismatch[] = [];
  const candidateMentions = new Set(mentionsIn(candidateText, identity.concepts).map((mention) => mention.conceptId));
  for (const concept of identity.concepts) if (!candidateMentions.has(concept.conceptId)) {
    problems.push({ kind: 'missing_concept', conceptId: concept.conceptId, label: concept.label });
  }

  for (const relation of identity.relations) {
    if (!relation.lexicallyExpressed) continue;
    const canonicalType = relation.canonicalPredicateType;
    const canonicalDirection = relation.canonicalDirection;
    if (canonicalType && canonicalDirection && (canonicalType !== relation.type || canonicalDirection !== 'forward')) {
      problems.push({ kind: 'canonical_contract_conflict', fromConceptId: relation.fromConceptId, toConceptId: relation.toConceptId, expectedType: relation.type, canonicalType, canonicalDirection });
      continue;
    }
    if (!candidateMentions.has(relation.fromConceptId) || !candidateMentions.has(relation.toConceptId)) continue;
    const matches = relationMatches(candidateText, relation.fromConceptId, relation.toConceptId, identity.concepts);
    const expected = matches.find((match) => match.type === relation.type && match.direction === 'forward');
    const wrongDirection = matches.find((match) => match.type === relation.type && match.direction === 'reverse');
    const wrongPredicate = matches.find((match) => match.type !== relation.type);
    if (expected && !wrongDirection && !wrongPredicate) continue;
    if (wrongDirection) problems.push({ kind: 'relation_direction_reversed', fromConceptId: relation.fromConceptId, toConceptId: relation.toConceptId, expectedType: relation.type, fromLabel: relation.fromLabel, toLabel: relation.toLabel });
    else if (wrongPredicate) problems.push({ kind: 'relation_predicate_changed', fromConceptId: relation.fromConceptId, toConceptId: relation.toConceptId, expectedType: relation.type, actualType: wrongPredicate.type, fromLabel: relation.fromLabel, toLabel: relation.toLabel });
    else problems.push({ kind: 'relation_not_preserved', fromConceptId: relation.fromConceptId, toConceptId: relation.toConceptId, expectedType: relation.type, fromLabel: relation.fromLabel, toLabel: relation.toLabel });
  }
  return problems;
}

export function formatClaimIdentityMismatch(mismatch: ClaimIdentityMismatch): string {
  switch (mismatch.kind) {
    case 'missing_concept': return `explicit concept ${mismatch.label} (${mismatch.conceptId}) is missing`;
    case 'canonical_contract_conflict': return `canonical claim expresses ${mismatch.canonicalDirection} ${mismatch.canonicalType} for ${mismatch.fromConceptId} → ${mismatch.toConceptId}, but the contract requires ${mismatch.expectedType}`;
    case 'relation_not_preserved': return `${mismatch.fromLabel} ${mismatch.expectedType} ${mismatch.toLabel} is not preserved`;
    case 'relation_direction_reversed': return `${mismatch.fromLabel} ${mismatch.expectedType} ${mismatch.toLabel} has reversed direction`;
    case 'relation_predicate_changed': return `${mismatch.fromLabel}–${mismatch.toLabel} predicate changed from ${mismatch.expectedType} to ${mismatch.actualType}`;
  }
}
