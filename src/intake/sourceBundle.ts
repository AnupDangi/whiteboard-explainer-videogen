import { createHash } from 'node:crypto';
import type { NativeSourceLocation, SourceRole } from '../shared/contracts.js';
import { resolveSourceEvidence, sourceDocFromText, type EvidenceHit, type SourceBundle, type SourceDoc } from './sourceDoc.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const tokens = (value: string) => value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const stopWords = new Set('a an and are as at be by for from how in into is it of on or that the their this to was what when where which with'.split(' '));

/** More teaching time needs more evidence: 12 hits for a minute, up to 50 for half an hour. */
export function evidenceHitBudget(durationSec: number | undefined): number {
  return Math.max(12, Math.min(50, Math.round(12 + Math.max(0, (durationSec ?? 60) - 60) / 12)));
}

/** The instruction's own clauses ("list the components, explain the formula, state the layer count"); each one asks for its own evidence. */
export function instructionClauses(query: string): string[] {
  const clauses = query.split(/[;:,.\n]|\band\b|\bthen\b|\bso that\b/iu).map((clause) => clause.trim()).filter((clause) => tokens(clause).filter((token) => token.length > 2 && !stopWords.has(token)).length >= 2);
  return [...new Set(clauses)].slice(0, 8);
}

export interface BundledSources {
  sourceDoc: SourceDoc;
  sourceBundle: SourceBundle;
}

/** Resolve CLI source-role flags against the exact inputs that produced the loaded documents. */
export function sourceRolesForInputs(
  inputs: readonly { sourceId: string; input: string }[],
  backgroundInputs: readonly string[],
): Map<string, SourceRole> {
  const knownInputs = new Set(inputs.map(({ input }) => input));
  const unknown = [...new Set(backgroundInputs)].filter((input) => !knownInputs.has(input));
  if (unknown.length) throw new Error(`--background-source must exactly match a supplied --source or --url value: ${unknown.join(', ')}`);

  const background = new Set(backgroundInputs);
  const roles = new Map<string, SourceRole>();
  for (const { sourceId, input } of inputs) {
    const role: SourceRole = background.has(input) ? 'background' : 'primary';
    const previous = roles.get(sourceId);
    if (previous && previous !== role) throw new Error(`Conflicting source roles resolve to document ${sourceId}`);
    roles.set(sourceId, role);
  }
  return roles;
}

/** Combine exact extracted text while keeping each evidence span attached to its original document. */
export function buildSourceBundle(docs: SourceDoc[], query: string, options: { sourceUrls?: Map<string, string>; documentRoles?: ReadonlyMap<string, SourceRole>; topK?: number; retrievalMode?: SourceBundle['retrievalMode']; retrievalElapsedMs?: number } = {}): BundledSources {
  const retrievalStartedAtMs = Date.now();
  if (!docs.length) throw new Error('At least one readable source document is required');
  if (docs.length > 50) throw new Error('A source bundle can contain at most 50 documents');
  const distinctDocs = [...new Map(docs.map((doc) => [doc.sourceId, doc])).values()];
  const knownSourceIds = new Set(distinctDocs.map((doc) => doc.sourceId));
  for (const sourceId of options.documentRoles?.keys() ?? []) {
    if (!knownSourceIds.has(sourceId)) throw new Error(`Source role assigned to unknown document ${sourceId}`);
  }
  const roleFor = (docId: string): SourceRole => options.documentRoles?.get(docId) ?? 'primary';
  let text = '';
  const nativeLocations: Array<{ startChar: number; endChar: number; sourceLocation?: NativeSourceLocation; citationSourceId: string; citationDocumentSha256: string; sourceRole: SourceRole; sourceTitle: string; documentStartChar: number; documentStartLine: number }> = [];
  for (const [docIndex, doc] of distinctDocs.entries()) {
    if (docIndex > 0) text += '\n\n';
    const start = text.length;
    text += doc.text;
    if (text.length > 5_000_000) throw new Error('Combined source bundle exceeds 5,000,000 characters');
    const title = doc.title ?? `Source ${docIndex + 1}`;
    for (const span of doc.spans) {
      nativeLocations.push({
        startChar: start + span.startChar,
        endChar: start + span.endChar,
        ...(span.sourceLocation ? { sourceLocation: span.sourceLocation } : {}),
        citationSourceId: doc.sourceId,
        citationDocumentSha256: doc.contentSha256 ?? sha256(`${doc.format}\0${doc.text}`),
        sourceRole: roleFor(doc.sourceId),
        sourceTitle: title,
        documentStartChar: span.startChar,
        documentStartLine: span.startLine,
      });
    }
  }
  const merged = sourceDocFromText(text, distinctDocs.length === 1 ? distinctDocs[0]!.format : 'text', nativeLocations);
  const bundleId = `srcset_${sha256(distinctDocs.map((doc) => `${doc.sourceId}:${roleFor(doc.sourceId)}`).join('\0')).slice(0, 20)}`;
  merged.sourceId = bundleId;
  merged.figureAssets = distinctDocs.flatMap((doc) => doc.figureAssets ?? []);

  const spans = merged.spans.filter((span) => span.kind !== 'heading' || span.text.trim().length > 0);
  const spanStats = spans.map((span) => {
    const counts = new Map<string, number>();
    const spanTokens = tokens(span.text);
    for (const token of spanTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    return { counts, length: spanTokens.length };
  });
  const averageSpanLength = spanStats.length ? spanStats.reduce((sum, span) => sum + span.length, 0) / spanStats.length : 1;
  const termsOf = (value: string): string[] => [...new Set(tokens(value).filter((token) => token.length > 1 && !stopWords.has(token)))];
  const rankFor = (queryTerms: string[]) => {
    const documentFrequency = new Map<string, number>();
    for (const term of queryTerms) documentFrequency.set(term, spanStats.reduce((count, span) => count + Number(span.counts.has(term)), 0));
    const scored = spans.map((span, index) => {
      const { counts, length: rawLength } = spanStats[index]!;
      const length = Math.max(1, rawLength);
      const queryScore = queryTerms.reduce((sum, term) => {
        const tf = counts.get(term) ?? 0;
        if (!tf) return sum;
        const df = documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (spans.length - df + 0.5) / (df + 0.5));
        return sum + idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * length / Math.max(1, averageSpanLength)));
      }, 0);
      const score = queryTerms.length ? queryScore : (span.kind === 'paragraph' ? 1.2 : span.kind === 'table' || span.kind === 'equation' ? 1.1 : 1);
      const modality: EvidenceHit['modality'] = span.kind === 'table' ? 'table' : span.kind === 'equation' ? 'equation' : span.kind === 'figure' || span.kind === 'figure-reference' ? 'figure-metadata' : 'text';
      const citation = resolveSourceEvidence(merged, span.id, span.text.trim());
      return { span, score, modality, citation };
    }).filter((item) => item.citation).sort((a, b) => b.score - a.score || a.span.startChar - b.span.startChar);
    const matched = scored.filter((item) => item.score > 0);
    return matched.length ? matched : scored.map((item) => ({ ...item, score: 0 }));
  };
  const limit = Math.max(1, Math.min(50, options.topK ?? 12));
  const overall = rankFor(termsOf(query));
  // Every clause of the instruction gets its own best spans first (round robin), then the overall ranking fills the rest.
  const perClause = instructionClauses(query).map((clause) => rankFor(termsOf(clause)).filter((item) => item.score > 0));
  const chosen = new Map<string, (typeof overall)[number]>();
  for (let round = 0; round < 3 && chosen.size < limit; round++) {
    for (const ranking of perClause) {
      const next = ranking.filter((item) => !chosen.has(item.span.id))[0];
      if (next && chosen.size < limit && chosen.size < Math.ceil(limit * 0.75)) chosen.set(next.span.id, next);
    }
  }
  for (const item of overall) { if (chosen.size >= limit) break; if (!chosen.has(item.span.id)) chosen.set(item.span.id, item); }
  const ranked = [...chosen.values()].sort((a, b) => b.score - a.score || a.span.startChar - b.span.startChar);

  const docById = new Map(distinctDocs.map((doc) => [doc.sourceId, doc]));
  const evidenceHits: EvidenceHit[] = ranked.map((item, index) => {
    const originId = item.span.citationSourceId ?? merged.sourceId;
    const origin = docById.get(originId);
    return {
      rank: index + 1,
      score: Number(item.score.toFixed(6)),
      text: item.span.text.trim(),
      modality: item.modality,
      retrievalMode: options.retrievalMode ?? 'local-text',
      citation: item.citation!,
      documentSha256: origin ? origin.contentSha256 ?? sha256(`${origin.format}\0${origin.text}`) : '',
      documentTitle: origin?.title ?? item.span.sourceTitle ?? 'Source',
    };
  });
  const documents = distinctDocs.map((doc, index) => ({
    sourceId: doc.sourceId,
    title: doc.title ?? `Source ${index + 1}`,
    sha256: doc.contentSha256 ?? sha256(`${doc.format}\0${doc.text}`),
    format: doc.format,
    role: roleFor(doc.sourceId),
    ...(options.sourceUrls?.get(doc.sourceId) ?? doc.sourceUrl ? { sourceUrl: options.sourceUrls?.get(doc.sourceId) ?? doc.sourceUrl } : {}),
  }));
  const sourceBundle: SourceBundle = {
    schemaVersion: 'source-bundle/v2',
    bundleId,
    documents,
    figures: distinctDocs.flatMap((doc) => doc.figureAssets ?? []),
    retrievalMode: options.retrievalMode ?? 'local-text',
    evidenceHits,
    retrievalCost: { apiCostUsd: 0, estimated: false, elapsedMs: options.retrievalElapsedMs ?? Date.now() - retrievalStartedAtMs },
  };
  merged.retrievalEvidence = evidenceHits;
  return { sourceDoc: merged, sourceBundle };
}
