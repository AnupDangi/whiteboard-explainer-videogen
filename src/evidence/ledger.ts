import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ClaimSemanticsSchema, claimSemanticsFromText } from './claims.js';
import type { EvidenceReference } from '../shared/contracts.js';
import { sourceEvidenceRefMatches, type SourceDoc } from '../intake/sourceDoc.js';

const SHA256 = /^[a-f0-9]{64}$/u;

export const GroundingModeSchema = z.enum([
  'STRICT_SOURCE',
  'SOURCE_PLUS_BACKGROUND',
  'OPEN_EXPLANATION',
]);
export type GroundingMode = z.infer<typeof GroundingModeSchema>;

export const EpistemicTypeSchema = z.enum([
  'direct_source',
  'derived_relation',
  'pedagogical_bridge',
  'illustrative_example',
  'analogy',
]);
export type EpistemicType = z.infer<typeof EpistemicTypeSchema>;

/** Hash-pinned provenance for a source passage. Offsets are present as a pair. */
export const EvidenceSourceRefSchema = z.object({
  documentId: z.string().min(1).refine((value) => value === value.trim(), 'documentId must be canonical'),
  sourceHash: z.string().regex(SHA256, 'sourceHash must be a lowercase SHA-256 digest'),
  page: z.number().int().positive().optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().positive().optional(),
  quoteHash: z.string().regex(SHA256, 'quoteHash must be a lowercase SHA-256 digest'),
  sourceRole: z.enum(['primary', 'background']).optional(),
}).strict().superRefine((ref, context) => {
  const hasStart = ref.startOffset !== undefined;
  const hasEnd = ref.endOffset !== undefined;
  if (hasStart !== hasEnd) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'startOffset and endOffset must be supplied together' });
  } else if (hasStart && hasEnd && ref.endOffset! <= ref.startOffset!) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'endOffset must be greater than startOffset' });
  }
});
export type EvidenceSourceRef = z.infer<typeof EvidenceSourceRefSchema>;

/** Canonical plan references retain their source-span ID until projected into the compact evidence ledger. */
export const CanonicalClaimSourceRefSchema = EvidenceSourceRefSchema.safeExtend({
  spanId: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
}).strict().refine((ref) => ref.endOffset > ref.startOffset, 'endOffset must be greater than startOffset');
export type CanonicalClaimSourceRef = z.infer<typeof CanonicalClaimSourceRefSchema>;

/** A canonical teaching claim plus its epistemic class and provenance. */
const EvidenceClaimInputSchema = z.object({
  id: z.string().min(1).refine((value) => value === value.trim(), 'claim id must be canonical'),
  canonicalText: z.string().min(1).refine((value) => value.trim().length > 0, 'canonicalText cannot be blank'),
  sourceRefs: z.array(EvidenceSourceRefSchema).max(96),
  epistemicType: EpistemicTypeSchema,
  /** Informational estimate only. It is not calibrated evidence and never promotes certification. */
  confidence: z.number().min(0).max(1).optional(),
}).strict();
export type EvidenceClaimInput = z.infer<typeof EvidenceClaimInputSchema>;

export const EvidenceClaimSchema = EvidenceClaimInputSchema.extend({
  /** Derived from canonicalText by code; callers cannot supply semantics to the builder. */
  semantics: ClaimSemanticsSchema,
}).strict().superRefine((claim, context) => {
  const seen = new Set<string>();
  claim.sourceRefs.forEach((ref, index) => {
    const key = sourceRefKey(ref);
    if (seen.has(key)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceRefs', index], message: 'duplicate source reference' });
    seen.add(key);
  });
});
export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>;

const EvidenceLedgerBodySchema = z.object({
  schemaVersion: z.literal('evidence-ledger/v1'),
  groundingMode: GroundingModeSchema,
  claims: z.array(EvidenceClaimSchema).min(1).max(512),
}).strict().superRefine((ledger, context) => {
  const seen = new Set<string>();
  ledger.claims.forEach((claim, index) => {
    if (seen.has(claim.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['claims', index, 'id'], message: `duplicate claim id: ${claim.id}` });
    seen.add(claim.id);
  });
});

export const EvidenceLedgerSchema = EvidenceLedgerBodySchema.extend({
  ledgerSha256: z.string().regex(SHA256),
}).strict();
export type EvidenceLedger = z.infer<typeof EvidenceLedgerSchema>;

export interface EvidenceLedgerInput {
  groundingMode: GroundingMode;
  claims: EvidenceClaimInput[];
}

export interface CanonicalTeachingClaimEvidence {
  id: string;
  statement: string;
  relations: readonly unknown[];
  /** Absent only in pre-v3 lesson contexts; new V2 runs reject missing classifications. */
  epistemicType?: EpistemicType;
  sourceRefs?: readonly (EvidenceSourceRef | CanonicalClaimSourceRef)[];
  confidence?: number;
}

export interface EvidenceLedgerValidation {
  valid: boolean;
  errors: string[];
}

/** Conservative structural checks for explicit claim classes; this is not an entailment classifier. */
export function epistemicTextFramingProblem(type: EpistemicType, text: string): string | undefined {
  if (type === 'illustrative_example' && !/\b(?:for example|as an example|for instance|suppose|imagine|hypothetical(?:ly)?)\b/iu.test(text)) return 'needs explicit example framing';
  if (type === 'analogy' && !/\b(?:analogy|analogous|as if|similar to|think of .{1,48} as|(?:is|are|works|functions|acts) like|imagine)\b/iu.test(text)) return 'needs explicit analogy framing';
  return undefined;
}

export function epistemicClaimProblems(claim: Pick<CanonicalTeachingClaimEvidence, 'id' | 'statement' | 'relations' | 'epistemicType'>): string[] {
  if (!claim.epistemicType) return [`claim ${claim.id} needs an explicit epistemicType`];
  if (claim.epistemicType === 'direct_source' && claim.relations.length) return [`claim ${claim.id} is direct_source but lists a graph relation; classify relation claims as derived_relation`];
  if (claim.epistemicType === 'derived_relation' && !claim.relations.length) return [`claim ${claim.id} is derived_relation but lists no graph relation`];
  const framingProblem = epistemicTextFramingProblem(claim.epistemicType, claim.statement);
  if (framingProblem) return [`claim ${claim.id} ${framingProblem}`];
  return [];
}

/** Convert only a source reference that already carries both immutable digests. */
export function sourceRefFromResolvedEvidence(ref: EvidenceReference): EvidenceSourceRef | undefined {
  if (!ref.documentSha256 || !ref.quoteSha256) return undefined;
  return EvidenceSourceRefSchema.parse({
    documentId: ref.sourceId,
    sourceHash: ref.documentSha256,
    startOffset: ref.startChar,
    endOffset: ref.endChar,
    quoteHash: ref.quoteSha256,
    sourceRole: ref.sourceRole ?? 'primary',
    ...(ref.sourceLocation?.kind === 'pdf-page' ? { page: ref.sourceLocation.page } : {}),
  });
}

/** Ensure every ledger citation is the exact hash-backed reference already resolved from its source document. */
export function validateEvidenceLedgerSources(
  ledger: EvidenceLedger,
  sources: readonly SourceDoc[],
  graphEvidence: readonly EvidenceReference[],
): string[] {
  const verifiedRefs = new Set<string>();
  for (const ref of graphEvidence) {
    const resolvedBySource = sources.some((source) => sourceEvidenceRefMatches(source, ref));
    const projected = resolvedBySource ? sourceRefFromResolvedEvidence(ref) : undefined;
    if (projected) verifiedRefs.add(sourceRefKey(projected));
  }
  return ledger.claims.flatMap((claim) => claim.sourceRefs.flatMap((ref) => (
    verifiedRefs.has(sourceRefKey(ref)) ? [] : [`${claim.id}: source reference ${ref.documentId}/${ref.startOffset ?? 'page'}/${ref.quoteHash} is not backed by verified graph evidence`]
  )));
}

/** Project graph-derived teaching claims into one lesson ledger; duplicate IDs must describe the same claim. */
export function createEvidenceLedgerFromClaims(
  claims: readonly CanonicalTeachingClaimEvidence[],
  groundingMode: GroundingMode,
): EvidenceLedger {
  const byId = new Map<string, EvidenceClaimInput>();
  for (const claim of claims) {
    const sourceRefs = (claim.sourceRefs ?? []).map((ref) => {
      if ('spanId' in ref) {
        const canonicalRef = CanonicalClaimSourceRefSchema.parse(ref);
        const { spanId: _spanId, ...ledgerRef } = canonicalRef;
        return EvidenceSourceRefSchema.parse(ledgerRef);
      }
      return EvidenceSourceRefSchema.parse(ref);
    });
    const candidate: EvidenceClaimInput = {
      id: claim.id,
      canonicalText: claim.statement,
      sourceRefs,
      epistemicType: claim.epistemicType ?? (claim.relations.length ? 'derived_relation' : 'direct_source'),
      ...(claim.confidence !== undefined ? { confidence: claim.confidence } : {}),
    };
    const existing = byId.get(candidate.id);
    if (existing && stableJson(existing) !== stableJson(candidate)) {
      throw new Error(`Conflicting canonical teaching claim id in evidence ledger: ${candidate.id}`);
    }
    byId.set(candidate.id, candidate);
  }
  return createEvidenceLedger({ groundingMode, claims: [...byId.values()] });
}

/** Compare a pinned ledger to the canonical plan's claim set and derived identity. */
export function validateEvidenceLedgerClaims(
  ledger: EvidenceLedger,
  claims: readonly CanonicalTeachingClaimEvidence[],
): string[] {
  try {
    const expected = createEvidenceLedgerFromClaims(claims, ledger.groundingMode);
    return expected.ledgerSha256 === ledger.ledgerSha256 ? [] : ['evidence ledger claims do not match canonical teaching claims'];
  } catch (error) {
    return [`canonical teaching claims cannot form a valid evidence ledger: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function sourceRefKey(ref: EvidenceSourceRef): string {
  return [ref.documentId, ref.sourceHash, ref.page ?? '', ref.startOffset ?? '', ref.endOffset ?? '', ref.quoteHash, ref.sourceRole ?? 'primary'].join('\0');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Evidence ledger contains a non-JSON value');
  return encoded;
}

function ledgerDigest(body: z.infer<typeof EvidenceLedgerBodySchema>): string {
  return createHash('sha256').update(stableJson(body), 'utf8').digest('hex');
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

function policyErrors(groundingMode: GroundingMode, claims: readonly EvidenceClaim[]): string[] {
  if (groundingMode === 'OPEN_EXPLANATION') return [];
  return claims.flatMap((claim) => {
    const isFactual = claim.epistemicType === 'direct_source' || claim.epistemicType === 'derived_relation';
    const needsPrimary = isFactual || (groundingMode === 'STRICT_SOURCE' && claim.epistemicType === 'pedagogical_bridge');
    const hasPrimary = claim.sourceRefs.some((ref) => (ref.sourceRole ?? 'primary') === 'primary');
    const hasBackground = claim.sourceRefs.some((ref) => ref.sourceRole === 'background');
    const errors: string[] = [];
    if (groundingMode === 'STRICT_SOURCE' && hasBackground) {
      errors.push(`${claim.id}: background provenance is not allowed in STRICT_SOURCE`);
    }
    if (groundingMode === 'SOURCE_PLUS_BACKGROUND' && isFactual && hasBackground) {
      errors.push(`${claim.id}: background provenance cannot support ${claim.epistemicType} in SOURCE_PLUS_BACKGROUND`);
    }
    if (needsPrimary && !hasPrimary) {
      errors.push(`${claim.id}: ${claim.epistemicType} requires at least one hash-pinned primary source reference in ${groundingMode}`);
    }
    if (groundingMode === 'SOURCE_PLUS_BACKGROUND' && claim.epistemicType === 'pedagogical_bridge' && claim.sourceRefs.length === 0) {
      errors.push(`${claim.id}: pedagogical_bridge requires primary or background provenance in SOURCE_PLUS_BACKGROUND`);
    }
    return errors;
  });
}

/** Build a deterministic ledger, deriving protected claim cues instead of trusting submitted semantics. */
export function createEvidenceLedger(input: EvidenceLedgerInput): EvidenceLedger {
  const claims = input.claims.map((untrustedClaim) => {
    const claim = EvidenceClaimInputSchema.parse(untrustedClaim);
    const refs = [...claim.sourceRefs].sort((left, right) => sourceRefKey(left).localeCompare(sourceRefKey(right)));
    return {
      ...claim,
      sourceRefs: refs,
      semantics: claimSemanticsFromText(claim.canonicalText),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const parsedBody = EvidenceLedgerBodySchema.parse({ schemaVersion: 'evidence-ledger/v1', groundingMode: input.groundingMode, claims });
  const policyProblems = policyErrors(parsedBody.groundingMode, parsedBody.claims);
  if (policyProblems.length) throw new Error(`Invalid evidence ledger: ${policyProblems.join('; ')}`);
  return freezeDeep({ ...parsedBody, ledgerSha256: ledgerDigest(parsedBody) });
}

/** Validate shape, policy, derived semantics and digest. This detects accidental/tampered bytes, not authorship. */
export function validateEvidenceLedger(value: unknown): EvidenceLedgerValidation {
  const parsed = EvidenceLedgerSchema.safeParse(value);
  if (!parsed.success) return { valid: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`) };
  const ledger = parsed.data;
  const errors = policyErrors(ledger.groundingMode, ledger.claims);
  for (const claim of ledger.claims) {
    if (stableJson(claim.semantics) !== stableJson(claimSemanticsFromText(claim.canonicalText))) {
      errors.push(`${claim.id}: semantics do not match canonicalText`);
    }
  }
  const { ledgerSha256, ...body } = ledger;
  if (ledgerDigest(body) !== ledgerSha256) errors.push('ledgerSha256 does not match ledger contents');
  return { valid: errors.length === 0, errors };
}

/** Validate and return an immutable copy suitable for lock serialization. */
export function parseEvidenceLedger(value: unknown): EvidenceLedger {
  const validation = validateEvidenceLedger(value);
  if (!validation.valid) throw new Error(`Invalid evidence ledger: ${validation.errors.join('; ')}`);
  return freezeDeep(EvidenceLedgerSchema.parse(value));
}
