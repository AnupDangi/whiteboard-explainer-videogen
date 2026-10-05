import { createHash } from 'node:crypto';
import type { EvidenceReference, NativeSourceLocation, SourceRole } from '../shared/contracts.js';
import type { IntakeRecord } from './types.js';

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
  /** Digest of the originating document when this span belongs to a bundle. */
  citationDocumentSha256?: string;
  sourceRole?: SourceRole;
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
  /** Which reader produced the text, and what it could not read cleanly. */
  intake?: IntakeRecord;
}

/** Auto-spans longer than this are split at sentence/paragraph boundaries (see splitLongSourceSpans). */
export const MAX_AUTO_SPAN_CHARS = 500;
/** Kinds eligible for auto-splitting; structural spans keep their exact shape. */
const SPLITTABLE_SPAN_KINDS: ReadonlySet<SourceSpanKind> = new Set(['paragraph', 'list']);

/**
 * Deterministic, domain-general split of long auto-spans into excerpt-bounded
 * chunks (~500 chars) at sentence/paragraph boundaries. Unsplit spans keep
 * their id by reference; each chunk of a split span gets a stable derived id
 * `{parentId}__p{index}` so the parent maps to its children by prefix.
 * Offsets stay exact: chunk texts concatenate to the original text with
 * contiguous, gap-free char/line ranges.
 */
export function splitSourceSpan(span: SourceSpan): SourceSpan[] {
  if (!SPLITTABLE_SPAN_KINDS.has(span.kind) || span.text.length <= MAX_AUTO_SPAN_CHARS) return [span];
  const parts = span.text.split(/(\n\s*\n+|\n+|(?<=[.!?]["'”’)\]]?)\s+(?=[A-Z0-9"“‘(\[]))/g);
  const units: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const unit = (parts[i] ?? '') + (parts[i + 1] ?? '');
    if (unit) units.push(unit);
  }
  const chunks: string[] = [];
  let current = '';
  const pushHardSplit = (unit: string) => {
    let rest = unit;
    while (rest.length > MAX_AUTO_SPAN_CHARS + 100) {
      let cut = rest.lastIndexOf(' ', MAX_AUTO_SPAN_CHARS);
      if (cut < 200) cut = MAX_AUTO_SPAN_CHARS;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    return rest;
  };
  for (const unit of units) {
    const piece = unit.length > MAX_AUTO_SPAN_CHARS + 100 ? pushHardSplit(unit) : unit;
    if (!current) current = piece;
    else if (current.length + piece.length <= MAX_AUTO_SPAN_CHARS || current.length < 200) current += piece;
    else { chunks.push(current); current = piece; }
  }
  if (current) chunks.push(current);
  if (chunks.length < 2) return [span];
  const countNewlines = (value: string): number => value.split('\n').length - 1;
  return chunks.map((text, index) => {
    const start = chunks.slice(0, index).reduce((sum, chunk) => sum + chunk.length, 0);
    const startChar = span.startChar + start;
    const endChar = startChar + text.length;
    const startLine = span.startLine + countNewlines(span.text.slice(0, start));
    const endLine = startLine + countNewlines(text);
    return {
      ...span,
      id: `${span.id}__p${index}`,
      startChar, endChar, startLine, endLine,
      ...(span.documentStartChar !== undefined ? { documentStartChar: span.documentStartChar + start } : {}),
      ...(span.documentStartLine !== undefined ? { documentStartLine: span.documentStartLine + countNewlines(span.text.slice(0, start)) } : {}),
      text,
    };
  });
}

/** Split every long auto-span; returns the new list plus a parent-to-children id map. */
export function splitLongSourceSpans(spans: SourceSpan[]): { spans: SourceSpan[]; map: Map<string, string[]> } {
  const out: SourceSpan[] = [];
  const map = new Map<string, string[]>();
  for (const span of spans) {
    const split = splitSourceSpan(span);
    if (split.length === 1 && split[0] === span) out.push(span);
    else {
      out.push(...split);
      map.set(span.id, split.map((chunk) => chunk.id));
    }
  }
  return { spans: out, map };
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
  schemaVersion: 'source-bundle/v1' | 'source-bundle/v2';
  bundleId: string;
  documents: Array<{ sourceId: string; title: string; sha256: string; format: SourceDoc['format']; role?: SourceRole; sourceUrl?: string }>;
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
  citationDocumentSha256?: string;
  sourceRole?: SourceRole;
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
    excerpts.push({ id: span.id, kind: span.kind, ...(span.sourceRole ? { sourceRole: span.sourceRole } : {}), ...(span.sourceLocation ? { sourceLocation: span.sourceLocation } : {}), ...(span.sourceTitle ? { sourceTitle: span.sourceTitle } : {}), text, ...(text.length < span.text.length ? { excerpted: true } : {}) });
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

/**
 * A paragraph or list span is closed at the first sentence-ending line after
 * this many characters, so a PDF page without blank lines never becomes one
 * page-sized span. A single longer line is kept whole.
 */
export const MAX_SPAN_CHARS = 1500;

/** A caption line (`Figure 2. ...`, `Table 1: ...`) or an extractor-written figure reference. */
const CAPTION_LINE = /^\s*(?:\[Figure reference:|(?:Fig\.|Figure|Table|Diagram)\s+(?:\d+|[A-Z])\s*(?:[.:|\u2013\u2014-]|$))/;
/** A specific, singular figure mention; case-sensitive so prose like "the tables below" is not one. */
const FIGURE_MENTION = /\b(?:Fig\.|Figure|Table|Diagram)\s*(?:\d+|[A-Z])\b/;

function kindFor(line: string): SourceSpanKind {
  if (/^\s{0,3}#{1,6}\s/.test(line)) return 'heading';
  if (/^\s*\|.*\|\s*$/.test(line)) return 'table';
  if (/^\s*(\$\$|\\\[|\\\()/.test(line)) return 'equation';
  if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) return 'list';
  if (/^\s*\[Figure metadata:/.test(line)) return 'figure';
  if (CAPTION_LINE.test(line) || FIGURE_MENTION.test(line)) return 'figure-reference';
  return 'paragraph';
}

/** Preserve original text and line/character locations; spans never normalize or rewrite source bytes. */
export function sourceDocFromText(text: string, format: SourceDoc['format'] = 'text', nativeLocations: NativeSourceLocationRange[] = []): SourceDoc {
  if (!text.trim()) throw new Error('source document is empty');
  const sourceId = 'src_' + hash(`${format}\0${text}`).slice(0, 20);
  const lines = text.split(/(?<=\n)/);
  let spans: SourceSpan[] = [];
  let offset = 0;
  let lineNumber = 1;
  let insideDisplayEquation = false;
  let nativeLocationIndex = 0;
  let previousLocationKey: string | undefined;
  let currentSourceLocation: NativeSourceLocation | undefined;
  let currentCitationSourceId: string | undefined;
  let currentCitationDocumentSha256: string | undefined;
  let currentSourceRole: SourceRole | undefined;
  let currentSourceTitle: string | undefined;
  let active: { kind: SourceSpanKind; rangeIndex: number; startChar: number; startLine: number; sourceLocation?: NativeSourceLocation; citationSourceId?: string; citationDocumentSha256?: string; sourceRole?: SourceRole; sourceTitle?: string; documentStartChar?: number; documentStartLine?: number; text: string } | undefined;
  const flush = (endChar: number, endLine: number) => {
    if (!active) return;
    const body = active.text;
    const id = 'span_' + hash(sourceId + '\0' + active.startChar + '\0' + endChar + '\0' + body).slice(0, 20);
    spans.push({ id, kind: active.kind, startChar: active.startChar, endChar, startLine: active.startLine, endLine, ...(active.sourceLocation ? { sourceLocation: active.sourceLocation } : {}), ...(active.citationSourceId ? { citationSourceId: active.citationSourceId } : {}), ...(active.citationDocumentSha256 ? { citationDocumentSha256: active.citationDocumentSha256 } : {}), ...(active.sourceRole ? { sourceRole: active.sourceRole } : {}), ...(active.sourceTitle ? { sourceTitle: active.sourceTitle } : {}), ...(active.documentStartChar !== undefined ? { documentStartChar: active.documentStartChar } : {}), ...(active.documentStartLine !== undefined ? { documentStartLine: active.documentStartLine } : {}), text: body });
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
    currentCitationDocumentSha256 = rangeMatches ? range!.citationDocumentSha256 : undefined;
    currentSourceRole = rangeMatches ? range!.sourceRole : undefined;
    currentSourceTitle = rangeMatches ? range!.sourceTitle : undefined;
    const rangeIndex = rangeMatches ? nativeLocationIndex : -1;
    // Display-math state never leaks across a page, slide or document boundary.
    const locationKey = JSON.stringify([currentSourceLocation ?? null, currentCitationSourceId ?? null]);
    if (!blank && previousLocationKey !== undefined && locationKey !== previousLocationKey) insideDisplayEquation = false;
    if (!blank) previousLocationKey = locationKey;
    const startsDisplayEquation = !insideDisplayEquation && /^(?:\$\$|\\\[)/.test(trimmed);
    const closesOnSameLine = startsDisplayEquation && trimmed.length > 2 && /(?:\$\$|\\\])$/.test(trimmed);
    const endsDisplayEquation = insideDisplayEquation && /^(?:\$\$|\\\])$/.test(trimmed);
    let kind: SourceSpanKind | undefined = blank ? undefined : (insideDisplayEquation || startsDisplayEquation ? 'equation' : kindFor(line));
    // A figure mentioned inside running prose stays part of that paragraph; a caption line starts its own span.
    if (kind === 'figure-reference' && active?.kind === 'paragraph' && active.rangeIndex === rangeIndex && !CAPTION_LINE.test(line)) kind = 'paragraph';
    const contiguous = active && kind === active.kind && kind !== 'heading' && kind !== 'figure-reference' && active.rangeIndex === rangeIndex && JSON.stringify(active.sourceLocation ?? null) === JSON.stringify(currentSourceLocation ?? null) && active.citationSourceId === currentCitationSourceId && active.citationDocumentSha256 === currentCitationDocumentSha256 && active.sourceRole === currentSourceRole;
    if (!contiguous) flush(offset, lineNumber - 1);
    if (kind) {
      const rangeLineOffset = rangeMatches ? text.slice(range!.startChar, offset).split('\n').length - 1 : 0;
      if (!active) active = { kind, rangeIndex, startChar: offset, startLine: lineNumber, ...(currentSourceLocation ? { sourceLocation: currentSourceLocation } : {}), ...(currentCitationSourceId ? { citationSourceId: currentCitationSourceId } : {}), ...(currentCitationDocumentSha256 ? { citationDocumentSha256: currentCitationDocumentSha256 } : {}), ...(currentSourceRole ? { sourceRole: currentSourceRole } : {}), ...(currentSourceTitle ? { sourceTitle: currentSourceTitle } : {}), ...(rangeMatches && range!.documentStartChar !== undefined ? { documentStartChar: range!.documentStartChar + offset - range!.startChar } : {}), ...(rangeMatches && range!.documentStartLine !== undefined ? { documentStartLine: range!.documentStartLine + rangeLineOffset } : {}), text: '' };
      active.text += line;
    }
    const sentenceEnds = /[.!?][\]"')\u201d\u2019]*\s*$/.test(line);
    if (active && (active.kind === 'paragraph' || active.kind === 'list') && active.text.length >= MAX_SPAN_CHARS && sentenceEnds) flush(offset + line.length, lineNumber);
    if (startsDisplayEquation && !closesOnSameLine) insideDisplayEquation = true;
    else if (endsDisplayEquation) insideDisplayEquation = false;
    offset += line.length;
    if (line.endsWith('\n')) lineNumber += 1;
  }
  flush(text.length, lineNumber - (text.endsWith('\n') ? 1 : 0));

  // Excerpt-bounded spans: long auto-spans make verbatim quotes fail (the model
  // paraphrases across hyphen-breaks and jargon in ~2000-char spans), so split
  // them deterministically here. Short sources keep their exact original spans.
  spans = splitLongSourceSpans(spans).spans;

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
  return {
    sourceId: span.citationSourceId ?? doc.sourceId,
    spanId,
    startChar,
    endChar: startChar + quote.length,
    startLine,
    endLine,
    quote,
    ...((span.citationDocumentSha256 ?? doc.contentSha256) ? { documentSha256: span.citationDocumentSha256 ?? doc.contentSha256 } : {}),
    quoteSha256: hash(quote),
    ...(span.sourceRole ? { sourceRole: span.sourceRole } : {}),
    ...(span.sourceLocation ? { sourceLocation: span.sourceLocation } : {}),
  };
}

/** Verify source offsets and any immutable digests carried by a source citation. */
export function sourceEvidenceRefMatches(doc: SourceDoc, ref: EvidenceReference): boolean {
  const resolved = resolveSourceEvidence(doc, ref.spanId, ref.quote);
  if (!resolved || resolved.sourceId !== ref.sourceId || resolved.startChar !== ref.startChar || resolved.endChar !== ref.endChar || resolved.startLine !== ref.startLine || resolved.endLine !== ref.endLine) return false;
  if (ref.documentSha256 !== undefined && ref.documentSha256 !== resolved.documentSha256) return false;
  if (ref.quoteSha256 !== undefined && ref.quoteSha256 !== resolved.quoteSha256) return false;
  if (ref.sourceRole !== undefined && ref.sourceRole !== (resolved.sourceRole ?? 'primary')) return false;
  return true;
}
