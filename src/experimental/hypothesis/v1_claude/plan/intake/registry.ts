import { basename, extname } from 'node:path';
import type { RunFailure } from '../../../shared/contracts.js';
import { sourceDocFromText, type SourceDoc } from '../sourceDoc.js';
import { sha256Hex } from './blocks.js';
import { INTAKE_LIMITS } from './limits.js';
import { docxExtractor, pptxExtractor } from './office.js';
import { htmlExtractor } from './html.js';
import { doclingPdfExtractor } from './pdfDocling.js';
import { popplerPdfExtractor, type PdfTextMode } from './pdfPoppler.js';
import { textExtractor } from './text.js';
import type { Availability, IntakeWarning, SourceExtraction, SourceExtractor, SourceInput, SourceKind } from './types.js';

/**
 * Chooses a reader for each document and turns its extraction into a
 * SourceDoc. Built-in readers cover PDF (poppler or Docling), DOCX, PPTX,
 * HTML, Markdown, text and JSON; `registerSourceExtractor` adds a reader that
 * takes precedence for its kinds.
 *
 * Environment:
 *   HYPOTHESIS_PDF_EXTRACTOR = poppler (default) | docling | auto
 *     A named reader that is not available fails the intake with the reason;
 *     `auto` prefers Docling and records an `extractor-fallback` warning when
 *     it has to use poppler.
 *   HYPOTHESIS_PDF_TEXT_MODE = reading (default) | raw   (poppler only)
 */
export type PdfExtractorChoice = 'poppler' | 'docling' | 'auto';

const registered: SourceExtractor[] = [];

export function registerSourceExtractor(extractor: SourceExtractor): void {
  registered.unshift(extractor);
}

function envChoice<T extends string>(env: NodeJS.ProcessEnv, key: string, allowed: readonly T[], fallback: T): T {
  const value = (env[key] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${key} must be one of ${allowed.join(', ')} (got "${env[key]}")`);
  return value as T;
}

export const pdfExtractorChoice = (env: NodeJS.ProcessEnv = process.env): PdfExtractorChoice => envChoice(env, 'HYPOTHESIS_PDF_EXTRACTOR', ['poppler', 'docling', 'auto'] as const, 'poppler');
const pdfTextMode = (env: NodeJS.ProcessEnv): PdfTextMode => envChoice(env, 'HYPOTHESIS_PDF_TEXT_MODE', ['reading', 'raw'] as const, 'reading');

function builtInExtractors(env: NodeJS.ProcessEnv): SourceExtractor[] {
  const choice = pdfExtractorChoice(env);
  const poppler = popplerPdfExtractor(pdfTextMode(env));
  const pdf = choice === 'poppler' ? [poppler] : choice === 'docling' ? [doclingPdfExtractor(env)] : [doclingPdfExtractor(env), poppler];
  return [textExtractor, htmlExtractor, docxExtractor, pptxExtractor, ...pdf];
}

const OFFICE_TYPES: Record<string, SourceKind> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};
const EXTENSION_KINDS: Record<string, SourceKind> = { '.pdf': 'pdf', '.docx': 'docx', '.pptx': 'pptx', '.html': 'html', '.htm': 'html', '.md': 'markdown', '.markdown': 'markdown', '.txt': 'text', '.text': 'text', '.json': 'json' };

/** Decide what the bytes are from their signature, the Content-Type and the file extension. */
export function detectSourceKind(input: SourceInput): SourceKind {
  const type = (input.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const byExtension = EXTENSION_KINDS[extname(input.name).toLowerCase()];
  if (input.bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (byExtension === 'pdf' || type === 'application/pdf') throw new Error(`${input.name} is not a valid PDF (missing %PDF- header)`);
  if (OFFICE_TYPES[type]) return OFFICE_TYPES[type]!;
  if (byExtension === 'docx' || byExtension === 'pptx') return byExtension;
  if (type === 'text/html' || type === 'application/xhtml+xml' || byExtension === 'html' || (!byExtension && /<(?:!doctype html|html)[\s>]/i.test(input.bytes.toString('utf8', 0, 1024)))) return 'html';
  if (byExtension) return byExtension;
  if (type === 'text/markdown') return 'markdown';
  if (type === 'application/json') return 'json';
  if (type.startsWith('text/')) return 'text';
  throw new Error(`Unsupported source ${input.name}${type ? ` (${type})` : ''}; use PDF, DOCX, PPTX, HTML, Markdown, text or JSON`);
}

export interface IntakePlan { kind: SourceKind; extractor: SourceExtractor; warnings: IntakeWarning[] }

// Probed once per process (a Docling probe imports the Python package).
const availability = new Map<string, Promise<Availability>>();
const checkAvailable = (extractor: SourceExtractor): Promise<Availability> => {
  const key = `${extractor.id}@${extractor.version}`;
  if (!availability.has(key)) availability.set(key, extractor.available());
  return availability.get(key)!;
};

/** Pick the reader for one input. The chosen id and version belong in the S1 cache key. */
export async function planSourceIntake(input: SourceInput, env: NodeJS.ProcessEnv = process.env): Promise<IntakePlan> {
  const kind = detectSourceKind(input);
  const candidates = [...registered, ...builtInExtractors(env)].filter((extractor) => extractor.kinds.includes(kind));
  const warnings: IntakeWarning[] = [];
  const unavailable: string[] = [];
  for (const [index, extractor] of candidates.entries()) {
    const status = await checkAvailable(extractor);
    if (status.ok) {
      if (unavailable.length) warnings.push({ code: 'extractor-fallback', message: `used ${extractor.id} because ${unavailable.join('; ')}` });
      return { kind, extractor, warnings };
    }
    unavailable.push(`${extractor.id} is unavailable: ${status.reason}`);
    // A reader the user named explicitly never silently falls back.
    const explicitPdf = kind === 'pdf' && pdfExtractorChoice(env) !== 'auto' && !registered.includes(extractor);
    if (explicitPdf || index === candidates.length - 1) break;
  }
  throw new Error(`No ${kind.toUpperCase()} reader is available: ${unavailable.join('; ') || 'none registered'}`);
}

/** The document title when the extractor found none: the file name without extension, separators as spaces. */
export function titleFromName(input: SourceInput): string {
  const name = input.url ? decodeURIComponent(new URL(input.url).pathname.split('/').filter(Boolean).at(-1) ?? '') : basename(input.name);
  const stem = name.slice(0, name.length - extname(name).length).replace(/[_\s]+/g, ' ').replace(/(?<=\S)-(?=\S)/g, ' ').trim();
  return stem || (input.url ? new URL(input.url).hostname : 'Source');
}

/** Turn an extraction into the evidence-addressable SourceDoc every stage reads. */
export function finalizeSourceDoc(extraction: SourceExtraction, input: SourceInput, extractor: SourceExtractor, planWarnings: readonly IntakeWarning[] = []): SourceDoc {
  if (extraction.text.length > INTAKE_LIMITS.maxTextChars) throw new Error(`Extracted source exceeds ${INTAKE_LIMITS.maxTextChars.toLocaleString()} characters`);
  if (extraction.text.trim().length < INTAKE_LIMITS.minTextChars) throw new Error(`Source ${input.url ?? input.name} has fewer than ${INTAKE_LIMITS.minTextChars} extractable characters`);
  const doc = sourceDocFromText(extraction.text, extraction.format, extraction.nativeLocations);
  const headingTitle = extraction.generatedHeadings ? undefined : doc.title;
  doc.title = extraction.title ?? headingTitle ?? titleFromName(input);
  if (input.url) {
    doc.sourceId = `src_${sha256Hex(`${input.url}\0${doc.sourceId}`).slice(0, 20)}`;
    doc.sourceUrl = input.url;
  }
  doc.contentSha256 = sha256Hex(input.bytes);
  if (extraction.figures.length || ['pdf', 'docx', 'pptx'].includes(extraction.format)) doc.figureAssets = extraction.figures.map((figure) => ({ sourceId: doc.sourceId, ...figure }));
  doc.intake = { extractor: extractor.id, extractorVersion: extractor.version, warnings: [...planWarnings, ...extraction.warnings] };
  return doc;
}

/** Read one document with the planned (or newly chosen) reader. */
export async function runSourceIntake(input: SourceInput, plan?: IntakePlan): Promise<SourceDoc> {
  if (input.bytes.length > INTAKE_LIMITS.maxSourceBytes) throw new Error(`Source exceeds ${INTAKE_LIMITS.maxSourceBytes / 1024 / 1024} MB`);
  const chosen = plan ?? await planSourceIntake(input);
  let extraction: SourceExtraction;
  try { extraction = await chosen.extractor.extract(input); }
  catch (error) { throw new Error(`${chosen.extractor.id} could not read ${input.url ?? input.name}: ${error instanceof Error ? error.message : String(error)}`); }
  return finalizeSourceDoc(extraction, input, chosen.extractor, chosen.warnings);
}

/** Intake warnings as soft run failures, so they stay visible in the S1 stage record. */
export function intakeWarningFailures(doc: SourceDoc): RunFailure[] {
  return (doc.intake?.warnings ?? []).map((warning) => ({ code: `intake-${warning.code}`, stage: 'S1-source-intake', message: warning.message, hard: false }));
}
