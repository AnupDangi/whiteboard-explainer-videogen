import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEvidenceLedger,
  createEvidenceLedgerFromClaims,
  sourceRefFromResolvedEvidence,
  validateEvidenceLedgerClaims,
  validateEvidenceLedgerSources,
  validateEvidenceLedger,
  type EvidenceClaimInput,
  type EvidenceSourceRef,
} from '../evidence/ledger.js';
import { resolveSourceEvidence, sourceDocFromText } from '../intake/sourceDoc.js';
import { buildSourceBundle } from '../intake/sourceBundle.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function sourceRef(overrides: Partial<EvidenceSourceRef> = {}): EvidenceSourceRef {
  return {
    documentId: 'source-1',
    sourceHash: HASH_A,
    startOffset: 12,
    endOffset: 35,
    quoteHash: HASH_B,
    ...overrides,
  };
}

function claim(overrides: Partial<EvidenceClaimInput> = {}): EvidenceClaimInput {
  return {
    id: 'claim-1',
    canonicalText: 'The resistance does not increase above 5 V.',
    sourceRefs: [sourceRef()],
    epistemicType: 'direct_source',
    confidence: 0.73,
    ...overrides,
  };
}

test('ledger canonicalization is stable and freezes nested evidence data', () => {
  const first = createEvidenceLedger({ groundingMode: 'STRICT_SOURCE', claims: [
    claim({ id: 'claim-b', sourceRefs: [sourceRef({ documentId: 'z-doc' }), sourceRef({ documentId: 'a-doc' })] }),
    claim({ id: 'claim-a', canonicalText: 'No net movement occurs.' }),
  ] });
  const second = createEvidenceLedger({ groundingMode: 'STRICT_SOURCE', claims: [
    claim({ id: 'claim-a', canonicalText: 'No net movement occurs.' }),
    claim({ id: 'claim-b', sourceRefs: [sourceRef({ documentId: 'a-doc' }), sourceRef({ documentId: 'z-doc' })] }),
  ] });

  assert.equal(first.ledgerSha256, second.ledgerSha256);
  assert.deepEqual(first.claims.map(({ id }) => id), ['claim-a', 'claim-b']);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.claims));
  assert.ok(Object.isFrozen(first.claims[0]));
  assert.ok(Object.isFrozen(first.claims[0]!.semantics));
  assert.equal(first.claims[1]!.semantics.polarity, 'negative');
  assert.equal(first.claims[1]!.semantics.comparison?.operator, 'gt');
  assert.deepEqual(validateEvidenceLedger(first), { valid: true, errors: [] });
});

test('source-grounded modes reject unreferenced factual claims, while explicit illustrations remain typed', () => {
  assert.throws(() => createEvidenceLedger({
    groundingMode: 'STRICT_SOURCE',
    claims: [claim({ sourceRefs: [] })],
  }), /requires at least one hash-pinned primary source reference/u);

  const illustrative = createEvidenceLedger({
    groundingMode: 'STRICT_SOURCE',
    claims: [claim({ epistemicType: 'analogy', sourceRefs: [] })],
  });
  assert.equal(illustrative.claims[0]!.epistemicType, 'analogy');

  assert.throws(() => createEvidenceLedger({
    groundingMode: 'SOURCE_PLUS_BACKGROUND',
    claims: [claim({ epistemicType: 'derived_relation', sourceRefs: [] })],
  }), /requires at least one hash-pinned primary source reference/u);

  const open = createEvidenceLedger({
    groundingMode: 'OPEN_EXPLANATION',
    claims: [claim({ epistemicType: 'direct_source', sourceRefs: [] })],
  });
  assert.equal(validateEvidenceLedger(open).valid, true);
});

test('ledger validation detects edits and refuses caller-supplied semantics at construction', () => {
  const valid = createEvidenceLedger({ groundingMode: 'STRICT_SOURCE', claims: [claim()] });
  const changed = structuredClone(valid) as Record<string, unknown>;
  const changedClaims = changed.claims as Array<Record<string, unknown>>;
  changedClaims[0]!.canonicalText = 'The resistance increases above 5 V.';
  assert.match(validateEvidenceLedger(changed).errors.join(' '), /ledgerSha256 does not match/u);

  assert.throws(() => createEvidenceLedger({
    groundingMode: 'STRICT_SOURCE',
    claims: [{ ...claim(), semantics: { polarity: 'positive' } } as EvidenceClaimInput],
  }), /Unrecognized key/u);
});

test('source reference conversion refuses legacy refs without both digests', () => {
  assert.equal(sourceRefFromResolvedEvidence({
    sourceId: 'source-1', spanId: 'span-1', startChar: 12, endChar: 35, startLine: 1, endLine: 1,
    quote: 'quoted source text', quoteSha256: HASH_B,
  }), undefined);

  assert.deepEqual(sourceRefFromResolvedEvidence({
    sourceId: 'source-1', spanId: 'span-1', startChar: 12, endChar: 35, startLine: 1, endLine: 1,
    quote: 'quoted source text', quoteSha256: HASH_B, documentSha256: HASH_A,
    sourceLocation: { kind: 'pdf-page', page: 4 },
  }), {
    documentId: 'source-1', sourceHash: HASH_A, page: 4,
    startOffset: 12, endOffset: 35, quoteHash: HASH_B, sourceRole: 'primary',
  });
});

test('strict grounding rejects background citations and source-plus-background reserves facts for primary sources', () => {
  const backgroundRef = sourceRef({ sourceRole: 'background' });
  assert.throws(() => createEvidenceLedger({
    groundingMode: 'STRICT_SOURCE', claims: [claim({ sourceRefs: [backgroundRef] })],
  }), /background provenance is not allowed/u);
  assert.throws(() => createEvidenceLedger({
    groundingMode: 'SOURCE_PLUS_BACKGROUND', claims: [claim({ sourceRefs: [backgroundRef] })],
  }), /background provenance cannot support direct_source/u);

  const bridge = createEvidenceLedger({
    groundingMode: 'SOURCE_PLUS_BACKGROUND',
    claims: [claim({ epistemicType: 'pedagogical_bridge', sourceRefs: [backgroundRef] })],
  });
  assert.equal(validateEvidenceLedger(bridge).valid, true);
});

test('ledger schema rejects duplicate identities and malformed source ranges', () => {
  assert.throws(() => createEvidenceLedger({
    groundingMode: 'STRICT_SOURCE',
    claims: [claim({ sourceRefs: [sourceRef(), sourceRef()] })],
  }), /duplicate source reference/u);

  assert.throws(() => createEvidenceLedger({
    groundingMode: 'STRICT_SOURCE',
    claims: [claim(), claim()],
  }), /duplicate claim id/u);

  assert.throws(() => createEvidenceLedger({
    groundingMode: 'STRICT_SOURCE',
    claims: [claim({ sourceRefs: [sourceRef({ startOffset: 35, endOffset: 35 })] })],
  }), /endOffset must be greater than startOffset/u);
});

test('source validation joins ledger refs back to exact graph evidence and source bytes', () => {
  const doc = sourceDocFromText('The cell moves water across the membrane.\n', 'text');
  const span = doc.spans.find((candidate) => candidate.text.includes('moves water'))!;
  const graphRef = resolveSourceEvidence(doc, span.id, 'moves water across the membrane')!;
  const pinnedRef = sourceRefFromResolvedEvidence(graphRef)!;
  const ledger = createEvidenceLedger({
    groundingMode: 'STRICT_SOURCE',
    claims: [claim({ canonicalText: 'Water moves across the membrane.', sourceRefs: [pinnedRef] })],
  });

  assert.deepEqual(validateEvidenceLedgerSources(ledger, [doc], [graphRef]), []);
  assert.match(validateEvidenceLedgerSources(ledger, [doc], [{ ...graphRef, quoteSha256: HASH_A }]).join(' '), /not backed by verified graph evidence/u);
  assert.match(validateEvidenceLedgerSources(ledger, [], [graphRef]).join(' '), /not backed by verified graph evidence/u);
});

test('multi-document bundle evidence keeps the originating document hash in the ledger', () => {
  const first = sourceDocFromText('Water contains two hydrogen atoms.');
  const second = sourceDocFromText('Cells use energy to build proteins.');
  const { sourceDoc } = buildSourceBundle([first, second], 'water proteins');
  const refs = sourceDoc.spans.flatMap((span) => {
    const quote = span.text.trim();
    const evidence = quote ? resolveSourceEvidence(sourceDoc, span.id, quote) : undefined;
    return evidence ? [evidence] : [];
  });
  const firstEvidence = refs.find((ref) => ref.sourceId === first.sourceId)!;
  const secondEvidence = refs.find((ref) => ref.sourceId === second.sourceId)!;
  const firstPinned = sourceRefFromResolvedEvidence(firstEvidence)!;
  const secondPinned = sourceRefFromResolvedEvidence(secondEvidence)!;
  assert.equal(firstPinned.sourceHash, first.contentSha256);
  assert.equal(secondPinned.sourceHash, second.contentSha256);
  assert.notEqual(firstPinned.sourceHash, sourceDoc.contentSha256, 'document citations cannot inherit the concatenated bundle digest');

  const ledger = createEvidenceLedger({ groundingMode: 'STRICT_SOURCE', claims: [
    { ...claim({ id: 'claim-water' }), sourceRefs: [firstPinned] },
    { ...claim({ id: 'claim-cells' }), sourceRefs: [secondPinned] },
  ] });
  assert.deepEqual(validateEvidenceLedgerSources(ledger, [sourceDoc], refs), []);
});

test('canonical plan claims project to one ledger and conflicts cannot overwrite a claim id', () => {
  const claims = [{ id: 'claim-1', statement: 'Water moves across the membrane.', relations: [{ from: 'water', to: 'membrane' }], sourceRefs: [sourceRef()] }];
  const ledger = createEvidenceLedgerFromClaims(claims, 'STRICT_SOURCE');
  assert.deepEqual(validateEvidenceLedgerClaims(ledger, claims), []);
  assert.match(validateEvidenceLedgerClaims(ledger, [{ ...claims[0]!, statement: 'Water does not move across the membrane.' }]).join(' '), /do not match canonical teaching claims/u);
  assert.throws(() => createEvidenceLedgerFromClaims([
    ...claims,
    { id: 'claim-1', statement: 'A different statement.', relations: [], sourceRefs: [sourceRef()] },
  ], 'STRICT_SOURCE'), /Conflicting canonical teaching claim id/u);
});
