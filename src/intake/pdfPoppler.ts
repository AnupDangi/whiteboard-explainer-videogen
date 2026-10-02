import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { NativeSourceLocationRange } from './sourceDoc.js';
import { canonicalWarnings, canonicalizeText, mediaTypeFor, newCanonicalCounts, storeAsset, type CanonicalCounts } from './blocks.js';
import { INTAKE_LIMITS, execTool, toolAvailable } from './limits.js';
import type { ExtractedFigure, IntakeWarning, SourceExtraction, SourceExtractor } from './types.js';

/**
 * `reading` (pdftotext's default) rebuilds reading order, separates text blocks
 * with blank lines and joins words hyphenated across lines. `raw` keeps the
 * content-stream order with no block breaks; use it only for PDFs whose layout
 * analysis reorders columns badly.
 */
export type PdfTextMode = 'reading' | 'raw';

export function splitPdfPages(extractedText: string): string[] {
  const pages = extractedText.split('\f');
  // pdftotext terminates the final page with a form-feed; discard only that
  // sentinel. Empty interior pages are real page positions and must survive.
  if (pages.at(-1)?.trim() === '') pages.pop();
  return pages;
}

const EDGE_LINES = 3;
const runningKey = (line: string): string => line.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ').toLowerCase();

/**
 * Remove running headers/footers and bare page numbers: short lines at the top
 * or bottom of a page that repeat (digits ignored) on at least 40% of pages.
 * Needs three or more pages; shorter documents are returned unchanged.
 */
export function stripRunningLines(pages: readonly string[]): { pages: string[]; removed: number } {
  if (pages.length < 3) return { pages: [...pages], removed: 0 };
  const edgeIndexes = (lines: string[]): number[] => {
    const nonEmpty = lines.flatMap((line, index) => (line.trim() ? [index] : []));
    return [...new Set([...nonEmpty.slice(0, EDGE_LINES), ...nonEmpty.slice(-EDGE_LINES)])];
  };
  const pageLines = pages.map((page) => page.split('\n'));
  const frequency = new Map<string, number>();
  for (const lines of pageLines) {
    const keys = new Set(edgeIndexes(lines).map((index) => runningKey(lines[index]!)).filter((key) => key.length <= 120));
    for (const key of keys) frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));
  let removed = 0;
  const stripped = pageLines.map((lines) => {
    const drop = new Set(edgeIndexes(lines).filter((index) => (frequency.get(runningKey(lines[index]!)) ?? 0) >= threshold));
    removed += drop.size;
    return lines.filter((_line, index) => !drop.has(index)).join('\n');
  });
  return { pages: stripped, removed };
}

/**
 * Keep 1-based PDF page identity, including blank pages. Each page becomes a
 * generated `## Page N` heading plus its canonical text, bound to a
 * `pdf-page` location; visible text that imitates a page heading cannot
 * change that location.
 */
export function pdfPagesToSource(extractedText: string, counts: CanonicalCounts = newCanonicalCounts()): { text: string; nativeLocations: NativeSourceLocationRange[] } {
  return pagesToSource(splitPdfPages(extractedText), counts);
}

function pagesToSource(pages: readonly string[], counts: CanonicalCounts): { text: string; nativeLocations: NativeSourceLocationRange[] } {
  let text = '';
  const nativeLocations: NativeSourceLocationRange[] = [];
  for (const [index, page] of pages.entries()) {
    if (index > 0) text += '\n\n';
    const startChar = text.length;
    text += `## Page ${index + 1}\n\n${canonicalizeText(page.trim(), counts)}`;
    nativeLocations.push({ startChar, endChar: text.length, sourceLocation: { kind: 'pdf-page', page: index + 1 } });
  }
  return { text, nativeLocations };
}

/** String-only compatibility wrapper. Intake callers should use pdfPagesToSource. */
export function pdfPagesToMarkdown(extractedText: string): string {
  return pdfPagesToSource(extractedText).text;
}

/** Metadata titles that name the authoring tool or file rather than the document. */
const PLACEHOLDER_TITLE = /^(?:untitled|title|document\d*|microsoft (?:word|powerpoint) - .*|.*\.(?:docx?|pptx?|pdf|tex|dvi|ps|indd))$/i;

export function usablePdfTitle(value: string | undefined): string | undefined {
  const title = value?.replace(/\s+/g, ' ').trim();
  return title && title.length >= 3 && !PLACEHOLDER_TITLE.test(title) ? title : undefined;
}

async function pdfMetadataTitle(path: string): Promise<string | undefined> {
  try {
    const { stdout } = await execTool('pdfinfo', ['-enc', 'UTF-8', path], { timeout: 20_000, maxBuffer: 1024 * 1024 });
    return usablePdfTitle(stdout.match(/^Title:\s*(.*)$/m)?.[1]);
  } catch { return undefined; }
}

async function pdfFigures(path: string, dir: string): Promise<{ figures: ExtractedFigure[]; warnings: IntakeWarning[] }> {
  const prefix = join(dir, 'img');
  try { await execTool('pdfimages', ['-all', '-p', path, prefix], { timeout: INTAKE_LIMITS.toolTimeoutMs * 2, maxBuffer: 2 * 1024 * 1024 }); }
  catch (error) { return { figures: [], warnings: [{ code: 'pdf-figures-unavailable', message: `pdfimages failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` }] }; }
  // `-p` names files img-<page>-<index>.<ext>.
  const files = (await readdir(dir)).filter((name) => /^img-\d+-\d+\./.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const figures: ExtractedFigure[] = [];
  let totalBytes = 0;
  let skipped = 0;
  for (const filename of files) {
    const bytes = await readFile(join(dir, filename));
    if (bytes.length < 256) continue; // masks, rules and spacer images
    if (figures.length >= INTAKE_LIMITS.maxFigures || totalBytes + bytes.length > INTAKE_LIMITS.maxFigureBytes) { skipped += 1; continue; }
    totalBytes += bytes.length;
    const extension = extname(filename);
    const { assetPath, sha256 } = await storeAsset(bytes, extension);
    figures.push({ sha256, page: Number(filename.split('-')[1]), mediaType: mediaTypeFor(extension), assetPath, derivationStatus: 'embedded-image-crop', indexStatus: 'not-indexed' });
  }
  return { figures, warnings: skipped ? [{ code: 'figures-capped', message: `kept the first ${figures.length} embedded images; ${skipped} more exceeded the figure limits`, count: skipped }] : [] };
}

/** PDF text through poppler's `pdftotext`, figures through `pdfimages`, title from `pdfinfo`. */
export function popplerPdfExtractor(mode: PdfTextMode = 'reading'): SourceExtractor {
  return {
    id: 'pdf-poppler',
    version: `2-${mode}`,
    kinds: ['pdf'],
    async available() {
      return await toolAvailable('pdftotext') ? { ok: true } : { ok: false, reason: 'pdftotext (poppler-utils) is not installed; install poppler (brew install poppler / apt-get install poppler-utils) or select HYPOTHESIS_PDF_EXTRACTOR=docling' };
    },
    async extract(input): Promise<SourceExtraction> {
      const dir = await mkdtemp(join(tmpdir(), 'hypothesis-pdf-'));
      try {
        const path = join(dir, 'source.pdf');
        await writeFile(path, input.bytes);
        const { stdout } = await execTool('pdftotext', [...(mode === 'raw' ? ['-raw'] : []), '-enc', 'UTF-8', path, '-'], { timeout: INTAKE_LIMITS.toolTimeoutMs, maxBuffer: 64 * 1024 * 1024 });
        const warnings: IntakeWarning[] = [];
        const running = stripRunningLines(splitPdfPages(stdout));
        if (running.removed) warnings.push({ code: 'running-lines-removed', message: `removed ${running.removed} repeated header/footer/page-number line(s)`, count: running.removed });
        const emptyPages = running.pages.flatMap((page, index) => (page.trim().length < INTAKE_LIMITS.minPageTextChars ? [index + 1] : []));
        if (running.pages.join('').trim().length < INTAKE_LIMITS.minTextChars) throw new Error('PDF has no extractable text layer (scanned?); select HYPOTHESIS_PDF_EXTRACTOR=docling with DOCLING_OCR=on to read it');
        if (emptyPages.length) warnings.push({ code: 'page-without-text', message: `page(s) ${emptyPages.join(', ')} have no extractable text (scanned or image-only); their content is not available as evidence`, count: emptyPages.length });
        const counts = newCanonicalCounts();
        const { text, nativeLocations } = pagesToSource(running.pages, counts);
        const figures = await pdfFigures(path, dir);
        const title = await pdfMetadataTitle(path);
        return { format: 'pdf', text, nativeLocations, ...(title ? { title } : {}), generatedHeadings: true, figures: figures.figures, warnings: [...warnings, ...canonicalWarnings(counts), ...figures.warnings] };
      } finally { await rm(dir, { recursive: true, force: true }); }
    },
  };
}
