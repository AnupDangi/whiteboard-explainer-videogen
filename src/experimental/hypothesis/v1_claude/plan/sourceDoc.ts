import { createHash } from 'node:crypto';
import type { EvidenceReference, NativeSourceLocation } from '../../shared/contracts.js';

export type SourceSpanKind = 'heading' | 'paragraph' | 'list' | 'table' | 'equation' | 'figure-reference' | 'figure';

export interface SourceSpan {
  id: string;
  kind: SourceSpanKind;
  startChar: number;
  endChar: number;
  startLine: number;
  endLine: number;
  sourceLocation?: NativeSourceLocation;
  citationSourceId?: string;
  sourceTitle?: string;
  documentStartChar?: number;
  documentStartLine?: number;
  text: string;
}

export interface SourceDoc {
  schemaVersion: 'source-doc/v2';
  sourceId: string;
  format: 'text' | 'markdown' | 'pdf' | 'docx' | 'pptx';
  title?: string;
  sourceUrl?: string;
  contentSha256?: string;
  text: string;
  spans: SourceSpan[];
  retrievalEvidence?: EvidenceHit[];
  figureAssets?: SourceFigureAsset[];
}

export interface SourceFigureAsset {
  sourceId: string;
  sha256: string;
  page?: number;
  sourceLocation?: NativeSourceLocation;
  mediaType: string;
  assetPath: string;
  caption?: string;
  derivationStatus: 'embedded-image-crop';
  indexStatus: 'indexed' | 'not-indexed';
}

export interface EvidenceHit {
  rank: number;
  score: number;
  text: string;
  modality: 'text' | 'table' | 'equation' | 'figure-metadata';
  retrievalMode: 'local-text' | 'deep-indexed+local-text';
  citation: EvidenceReference;
  documentSha256: string;
  documentTitle: string;
}

export interface SourceBundle {
  schemaVersion: 'source-bundle/v1';
  bundleId: string;
  documents: Array<{ sourceId: string; title: string; sha256: string; format: SourceDoc['format']; sourceUrl?: string }>;
  figures: SourceFigureAsset[];
  retrievalMode: 'local-text' | 'deep-indexed+local-text';
  ragStatus?: { index: 'complete' | 'partial' | 'failed' | 'not-run'; retrieval: 'matched' | 'miss' | 'failed' | 'not-run'; exactSpanHits: number; expectedMultimodalItems?: number; completedMultimodalItems?: number; failedProviderCalls?: number };
  evidenceHits: EvidenceHit[];
  retrievalCost: { apiCostUsd: number; estimated: boolean; elapsedMs: number };
}

export interface NativeSourceLocationRange {
  startChar: number;
  endChar: number;
  sourceLocation?: NativeSourceLocation;
  citationSourceId?: string;
  sourceTitle?: string;
  documentStartChar?: number;
  documentStartLine?: number;
}

/**
 * The source as exact span texts, each printed under its span ID, with no
 * character offsets. A model cites evidence by copying words from the text
 * shown under the ID it cites, so quote-to-span mistakes cannot come from
 * mismatched offsets (a joined module excerpt keeps full-document offsets).
 * Spans are rendered in the given order until `maxChars`; a span cut by
 * `perSpanChars` or the total is marked `excerpted`, and `omittedSpans`
 * counts spans that did not fit.
 */
export function spanExcerptPrompt(doc: SourceDoc, options: { spans?: readonly SourceSpan[]; maxChars?: number; perSpanChars?: number; minChars?: number } = {}): string {
  const spans = options.spans ?? doc.spans;
  const minChars = options.minChars ?? 1;
  let remaining = options.maxChars ?? Number.POSITIVE_INFINITY;
  const excerpts: Array<Record<string, unknown>> = [];
  let omittedSpans = 0;
  for (const span of spans) {
    if (remaining < minChars) { omittedSpans++; continue; }
    const text = span.text.slice(0, Math.min(options.perSpanChars ?? Number.POSITIVE_INFINITY, remaining));
    if (text.trim().length < minChars) { omittedSpans++; continue; }
    excerpts.push({ id: span.id, kind: span.kind, ...(span.sourceLocation ? { sourceLocation: span.sourceLocation } : {}), ...(span.sourceTitle ? { sourceTitle: span.sourceTitle } : {}), text, ...(text.length < span.text.length ? { excerpted: true } : {}) });
    remaining -= text.length;
  }
  return JSON.stringify({ schemaVersion: doc.schemaVersion, sourceId: doc.sourceId, format: doc.format, ...(doc.title ? { title: doc.title } : {}), ...(doc.sourceUrl ? { sourceUrl: doc.sourceUrl } : {}), excerpts, ...(omittedSpans ? { omittedSpans } : {}) });
}

/** Keep the exact source once in model prompts, with a compact structural/location index. */
export function sourcePrompt(doc: SourceDoc): string {
  const index = doc.spans.map(({ id, kind, startChar, endChar, startLine, endLine, sourceLocation, citationSourceId, sourceTitle }) => ({ id, kind, startChar, endChar, startLine, endLine, ...(sourceLocation ? { sourceLocation } : {}), ...(citationSourceId ? { citationSourceId } : {}), ...(sourceTitle ? { sourceTitle } : {}) }));
  const figureIndex = doc.figureAssets?.map(({ sourceId, sha256, page, sourceLocation, mediaType, caption, derivationStatus, indexStatus }) => ({ sourceId, sha256, ...(page ? { page } : {}), ...(sourceLocation ? { sourceLocation } : {}), mediaType, ...(caption ? { caption } : {}), derivationStatus, indexStatus }));
  return JSON.stringify({ schemaVersion: doc.schemaVersion, sourceId: doc.sourceId, format: doc.format, title: doc.title, text: doc.text, spanIndex: index, ...(doc.retrievalEvidence ? { rankedEvidence: doc.retrievalEvidence } : {}), ...(figureIndex?.length ? { embeddedFigures: figureIndex } : {}) }, null, 1);
}

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function kindFor(line: string): SourceSpanKind {
  if (/^\s{0,3}#{1,6}\s/.test(line)) return 'heading';
  if (/^\s*\|.*\|\s*$/.test(line)) return 'table';
  if (/^\s*(\$\$|\\\[|\\\()/.test(line)) return 'equation';
  if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) return 'list';
  if (/^\s*\[Figure metadata:/i.test(line)) return 'figure';
  if (/\[Figure reference:/i.test(line) || /\b(?:fig(?:ure)?|diagram|table)\s*(?:\d+|[A-Z])\b/i.test(line)) return 'figure-reference';
  return 'paragraph';
}

/** Preserve original text and line/character locations; spans never normalize or rewrite source bytes. */
export function sourceDocFromText(text: string, format: SourceDoc['format'] = 'text', nativeLocations: NativeSourceLocationRange[] = []): SourceDoc {
  if (!text.trim()) throw new Error('source document is empty');
  const sourceId = 'src_' + hash(`${format}\0${text}`).slice(0, 20);
  const lines = text.split(/(?<=\n)/);
  const spans: SourceSpan[] = [];
  let offset = 0;
  let lineNumber = 1;
  let insideDisplayEquation = false;
  let nativeLocationIndex = 0;
  let currentSourceLocation: NativeSourceLocation | undefined;
  let currentCitationSourceId: string | undefined;
  let currentSourceTitle: string | undefined;
  let active: { kind: SourceSpanKind; startChar: number; startLine: number; sourceLocation?: NativeSourceLocation; citationSourceId?: string; sourceTitle?: string; documentStartChar?: number; documentStartLine?: number; text: string } | undefined;
  const flush = (endChar: number, endLine: number) => {
    if (!active) return;
    const body = active.text;
    const id = 'span_' + hash(sourceId + '\0' + active.startChar + '\0' + endChar + '\0' + body).slice(0, 20);
    spans.push({ id, kind: active.kind, startChar: active.startChar, endChar, startLine: active.startLine, endLine, ...(active.sourceLocation ? { sourceLocation: active.sourceLocation } : {}), ...(active.citationSourceId ? { citationSourceId: active.citationSourceId } : {}), ...(active.sourceTitle ? { sourceTitle: active.sourceTitle } : {}), ...(active.documentStartChar !== undefined ? { documentStartChar: active.documentStartChar } : {}), ...(active.documentStartLine !== undefined ? { documentStartLine: active.documentStartLine } : {}), text: body });
    active = undefined;
  };

  for (const line of lines) {
    const blank = line.trim().length === 0;
    const trimmed = line.trim();
    while (nativeLocationIndex < nativeLocations.length && offset >= nativeLocations[nativeLocationIndex].endChar) nativeLocationIndex += 1;
    const range = nativeLocations[nativeLocationIndex];
    const rangeMatches = Boolean(range && offset >= range.startChar && offset < range.endChar);
    const rangeLocation = rangeMatches ? range!.sourceLocation : undefined;
    // Only extractor-authored ranges establish native provenance. Visible
    // document text can imitate generated Page/Slide headings and is untrusted.
    currentSourceLocation = rangeLocation;
    currentCitationSourceId = rangeMatches ? range!.citationSourceId : undefined;
    currentSourceTitle = rangeMatches ? range!.sourceTitle : undefined;
    const startsDisplayEquation = !insideDisplayEquation && /^(?:\$\$|\\\[)/.test(trimmed);
    const closesOnSameLine = startsDisplayEquation && trimmed.length > 2 && /(?:\$\$|\\\])$/.test(trimmed);
    const endsDisplayEquation = insideDisplayEquation && /^(?:\$\$|\\\])$/.test(trimmed);
    const kind = blank ? undefined : (insideDisplayEquation || startsDisplayEquation ? 'equation' : kindFor(line));
    const contiguous = active && kind === active.kind && kind !== 'heading' && kind !== 'figure-reference' && JSON.stringify(active.sourceLocation ?? null) === JSON.stringify(currentSourceLocation ?? null) && active.citationSourceId === currentCitationSourceId;
    if (!contiguous) flush(offset, lineNumber - 1);
    if (kind) {
      const rangeLineOffset = rangeMatches ? text.slice(range!.startChar, offset).split('\n').length - 1 : 0;
      if (!active) active = { kind, startChar: offset, startLine: lineNumber, ...(currentSourceLocation ? { sourceLocation: currentSourceLocation } : {}), ...(currentCitationSourceId ? { citationSourceId: currentCitationSourceId } : {}), ...(currentSourceTitle ? { sourceTitle: currentSourceTitle } : {}), ...(rangeMatches && range!.documentStartChar !== undefined ? { documentStartChar: range!.documentStartChar + offset - range!.startChar } : {}), ...(rangeMatches && range!.documentStartLine !== undefined ? { documentStartLine: range!.documentStartLine + rangeLineOffset } : {}), text: '' };
      active.text += line;
    }
    if (startsDisplayEquation && !closesOnSameLine) insideDisplayEquation = true;
    else if (endsDisplayEquation) insideDisplayEquation = false;
    offset += line.length;
    if (line.endsWith('\n')) lineNumber += 1;
  }
  flush(text.length, lineNumber - (text.endsWith('\n') ? 1 : 0));

  const title = spans.find((span) => span.kind === 'heading')?.text.replace(/^\s{0,3}#{1,6}\s*/, '').trim();
  return { schemaVersion: 'source-doc/v2', sourceId, format, contentSha256: hash(text), ...(title ? { title } : {}), text, spans };
}

export type SourceEvidenceRef = EvidenceReference;

export function resolveSourceEvidence(doc: SourceDoc, spanId: string, quote: string): SourceEvidenceRef | undefined {
  const span = doc.spans.find((candidate) => candidate.id === spanId);
  if (!span || !quote || !span.text.includes(quote)) return undefined;
  const relative = span.text.indexOf(quote);
  const startChar = (span.documentStartChar ?? span.startChar) + relative;
  const lineOffset = span.text.slice(0, relative).split('\n').length - 1;
  const startLine = (span.documentStartLine ?? span.startLine) + lineOffset;
  const endLine = startLine + quote.split('\n').length - 1;
  return { sourceId: span.citationSourceId ?? doc.sourceId, spanId, startChar, endChar: startChar + quote.length, startLine, endLine, quote, ...(span.sourceLocation ? { sourceLocation: span.sourceLocation } : {}) };
}
