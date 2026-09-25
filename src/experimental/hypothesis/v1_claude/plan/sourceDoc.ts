import { createHash } from 'node:crypto';
import type { EvidenceReference, NativeSourceLocation } from '../../shared/contracts.js';

export type SourceSpanKind = 'heading' | 'paragraph' | 'list' | 'table' | 'equation' | 'figure-reference';

export interface SourceSpan {
  id: string;
  kind: SourceSpanKind;
  startChar: number;
  endChar: number;
  startLine: number;
  endLine: number;
  sourceLocation?: NativeSourceLocation;
  text: string;
}

export interface SourceDoc {
  schemaVersion: 'source-doc/v2';
  sourceId: string;
  format: 'text' | 'markdown' | 'pdf' | 'docx' | 'pptx';
  title?: string;
  text: string;
  spans: SourceSpan[];
}

export interface NativeSourceLocationRange {
  startChar: number;
  endChar: number;
  sourceLocation: NativeSourceLocation;
}

/** Keep the exact source once in model prompts, with a compact structural/location index. */
export function sourcePrompt(doc: SourceDoc): string {
  const index = doc.spans.map(({ id, kind, startChar, endChar, startLine, endLine, sourceLocation }) => ({ id, kind, startChar, endChar, startLine, endLine, ...(sourceLocation ? { sourceLocation } : {}) }));
  return JSON.stringify({ schemaVersion: doc.schemaVersion, sourceId: doc.sourceId, format: doc.format, title: doc.title, text: doc.text, spanIndex: index }, null, 1);
}

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function kindFor(line: string): SourceSpanKind {
  if (/^\s{0,3}#{1,6}\s/.test(line)) return 'heading';
  if (/^\s*\|.*\|\s*$/.test(line)) return 'table';
  if (/^\s*(\$\$|\\\[|\\\()/.test(line)) return 'equation';
  if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) return 'list';
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
  let active: { kind: SourceSpanKind; startChar: number; startLine: number; sourceLocation?: NativeSourceLocation; text: string } | undefined;
  const flush = (endChar: number, endLine: number) => {
    if (!active) return;
    const body = active.text;
    const id = 'span_' + hash(sourceId + '\0' + active.startChar + '\0' + endChar + '\0' + body).slice(0, 20);
    spans.push({ id, kind: active.kind, startChar: active.startChar, endChar, startLine: active.startLine, endLine, ...(active.sourceLocation ? { sourceLocation: active.sourceLocation } : {}), text: body });
    active = undefined;
  };

  for (const line of lines) {
    const blank = line.trim().length === 0;
    const trimmed = line.trim();
    while (nativeLocationIndex < nativeLocations.length && offset >= nativeLocations[nativeLocationIndex].endChar) nativeLocationIndex += 1;
    const range = nativeLocations[nativeLocationIndex];
    const rangeLocation = range && offset >= range.startChar && offset < range.endChar ? range.sourceLocation : undefined;
    // Only extractor-authored ranges establish native provenance. Visible
    // document text can imitate generated Page/Slide headings and is untrusted.
    currentSourceLocation = rangeLocation;
    const startsDisplayEquation = !insideDisplayEquation && /^(?:\$\$|\\\[)/.test(trimmed);
    const closesOnSameLine = startsDisplayEquation && trimmed.length > 2 && /(?:\$\$|\\\])$/.test(trimmed);
    const endsDisplayEquation = insideDisplayEquation && /^(?:\$\$|\\\])$/.test(trimmed);
    const kind = blank ? undefined : (insideDisplayEquation || startsDisplayEquation ? 'equation' : kindFor(line));
    const contiguous = active && kind === active.kind && kind !== 'heading' && kind !== 'figure-reference' && JSON.stringify(active.sourceLocation ?? null) === JSON.stringify(currentSourceLocation ?? null);
    if (!contiguous) flush(offset, lineNumber - 1);
    if (kind) {
      if (!active) active = { kind, startChar: offset, startLine: lineNumber, ...(currentSourceLocation ? { sourceLocation: currentSourceLocation } : {}), text: '' };
      active.text += line;
    }
    if (startsDisplayEquation && !closesOnSameLine) insideDisplayEquation = true;
    else if (endsDisplayEquation) insideDisplayEquation = false;
    offset += line.length;
    if (line.endsWith('\n')) lineNumber += 1;
  }
  flush(text.length, lineNumber - (text.endsWith('\n') ? 1 : 0));

  const title = spans.find((span) => span.kind === 'heading')?.text.replace(/^\s{0,3}#{1,6}\s*/, '').trim();
  return { schemaVersion: 'source-doc/v2', sourceId, format, ...(title ? { title } : {}), text, spans };
}

export type SourceEvidenceRef = EvidenceReference;

export function resolveSourceEvidence(doc: SourceDoc, spanId: string, quote: string): SourceEvidenceRef | undefined {
  const span = doc.spans.find((candidate) => candidate.id === spanId);
  if (!span || !quote || !span.text.includes(quote)) return undefined;
  const relative = span.text.indexOf(quote);
  const startChar = span.startChar + relative;
  const lineOffset = span.text.slice(0, relative).split('\n').length - 1;
  const startLine = span.startLine + lineOffset;
  const endLine = startLine + quote.split('\n').length - 1;
  return { sourceId: doc.sourceId, spanId, startChar, endChar: startChar + quote.length, startLine, endLine, quote, ...(span.sourceLocation ? { sourceLocation: span.sourceLocation } : {}) };
}
