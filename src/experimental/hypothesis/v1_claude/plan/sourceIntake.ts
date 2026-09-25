import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { load } from 'cheerio';
import { sourceDocFromText, type NativeSourceLocationRange, type SourceDoc } from './sourceDoc.js';
import type { NativeSourceLocation } from '../../shared/contracts.js';

const exec = promisify(execFile);
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_TEXT = 5_000_000;

export interface OfficeTextExtraction { text: string; nativeLocations: NativeSourceLocationRange[] }

/** Extract body children and retain a source locator for each generated text block. */
export function docxXmlToSource(xml: string): OfficeTextExtraction {
  const $ = load(xml, { xmlMode: true });
  const blocks: Array<{ text: string; sourceLocation: NativeSourceLocation }> = [];
  let paragraphIndex = 0;
  let tableIndex = 0;
  $('w\\:body').children().each((bodyIndex, el) => {
    const node = $(el);
    const name = el.tagName.toLowerCase();
    if (name === 'w:p') {
      paragraphIndex += 1;
      const sourceLocation: NativeSourceLocation = { kind: 'docx-paragraph', bodyBlock: bodyIndex + 1, paragraph: paragraphIndex };
      // Keep Word's mixed prose/math run order. Wrapping every text node in a
      // paragraph containing any Office Math node turns the surrounding prose
      // into a false equation and loses the inline/display distinction.
      const paragraph = node.clone();
      paragraph.find('m\\:oMathPara').each((_j, math) => {
        const formula = $(math).text().trim();
        $(math).replaceWith(formula ? `\n\n$$\n${formula}\n$$\n\n` : '');
      });
      paragraph.find('m\\:oMath').each((_j, math) => {
        const formula = $(math).text().trim();
        $(math).replaceWith(formula ? `\\(${formula}\\)` : '');
      });
      const value = paragraph.text();
      const style = node.find('w\\:pStyle').attr('w:val') ?? '';
      const heading = style.match(/(?:heading|title)(\d?)/i);
      const figure = node.find('wp\\:docPr').attr('descr') || node.find('wp\\:docPr').attr('name');
      if (value.trim()) blocks.push({ text: heading ? `${'#'.repeat(Math.max(1, Math.min(6, Number(heading[1] || 1))))} ${value}` : value, sourceLocation });
      if (figure) blocks.push({ text: `[Figure reference: ${figure}]`, sourceLocation });
    } else if (name === 'w:tbl') {
      tableIndex += 1;
      const sourceLocation: NativeSourceLocation = { kind: 'docx-table', bodyBlock: bodyIndex + 1, table: tableIndex };
      const rows: string[][] = [];
      node.find('w\\:tr').each((_ri, tr) => {
        const cells: string[] = [];
        $(tr).children('w\\:tc').each((_ci, tc) => { cells.push($(tc).find('w\\:t, m\\:t').map((_j, t) => $(t).text()).get().join(' ').trim()); });
        if (cells.some(Boolean)) rows.push(cells);
      });
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        blocks.push({ text: [rows[0], Array(width).fill('---'), ...rows.slice(1)].map((r) => `| ${Array.from({ length: width }, (_, i) => (r[i] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`).join('\n'), sourceLocation });
      }
    } else if (name === 'w:sectpr') {
      // Section metadata is not lesson content.
    }
  });
  let text = '';
  const nativeLocations: NativeSourceLocationRange[] = [];
  for (const [index, block] of blocks.entries()) {
    if (index > 0) text += '\n\n';
    const startChar = text.length;
    text += block.text;
    nativeLocations.push({ startChar, endChar: text.length, sourceLocation: block.sourceLocation });
  }
  return { text, nativeLocations };
}

/** Extract body children in document order, retaining heading levels, table rows, equations and figure captions. */
export function docxXmlToMarkdown(xml: string): string {
  return docxXmlToSource(xml).text;
}

/** Extract each PPTX slide in numeric order and bind its generated text to its actual slide number. */
export function pptxSlideXmlToSource(slides: Array<{ name: string; xml: string }>): OfficeTextExtraction {
  const ordered = [...slides].sort((a, b) => Number(a.name.match(/slide(\d+)/i)?.[1] ?? 0) - Number(b.name.match(/slide(\d+)/i)?.[1] ?? 0));
  const blocks = ordered.map(({ name, xml }) => {
      const $ = load(xml, { xmlMode: true });
      const blocks: string[] = [];
      const shapeTree = $('p\\:spTree').first();
      shapeTree.children().each((_i, child) => {
        const node = $(child);
        const tag = child.tagName.toLowerCase();
        if (tag === 'p:sp' || tag === 'p:graphicframe') {
          const table = node.find('a\\:tbl').first();
          if (table.length) {
            const rows: string[][] = [];
            table.find('a\\:tr').each((_ri, tr) => {
              const cells: string[] = [];
              $(tr).children('a\\:tc').each((_ci, tc) => { cells.push($(tc).find('a\\:t').map((_j, t) => $(t).text()).get().join(' ').trim()); });
              if (cells.some(Boolean)) rows.push(cells);
            });
            if (rows.length) {
              const width = Math.max(...rows.map((r) => r.length));
              blocks.push([rows[0], Array(width).fill('---'), ...rows.slice(1)].map((r) => `| ${Array.from({ length: width }, (_, i) => (r[i] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`).join('\n'));
            }
          } else {
            const paragraphs = node.find('a\\:p').map((_pi, p) => $(p).find('a\\:t').map((_j, t) => $(t).text()).get().join('').trim()).get().filter(Boolean);
            if (paragraphs.length) blocks.push(paragraphs.join('\n'));
          }
        } else if (tag === 'p:pic') {
          const description = node.find('p\\:cNvPr').attr('descr') || node.find('p\\:cNvPr').attr('name');
          if (description) blocks.push(`[Figure reference: ${description}]`);
        }
      });
      const number = name.match(/slide(\d+)/i)?.[1] ?? '?';
      return { text: [`## Slide ${number}`, ...blocks].join('\n\n'), slide: Number(number) };
    });
  let text = '';
  const nativeLocations: NativeSourceLocationRange[] = [];
  for (const [index, block] of blocks.entries()) {
    if (index > 0) text += '\n\n';
    const startChar = text.length;
    text += block.text;
    if (Number.isInteger(block.slide)) nativeLocations.push({ startChar, endChar: text.length, sourceLocation: { kind: 'pptx-slide', slide: block.slide } });
  }
  return { text, nativeLocations };
}

/** String-only compatibility wrapper. Intake callers should use pptxSlideXmlToSource. */
export function pptxSlideXmlToMarkdown(slides: Array<{ name: string; xml: string }>): string {
  return pptxSlideXmlToSource(slides).text;
}

async function unzipMember(path: string, member: string): Promise<string> {
  const { stdout } = await exec('unzip', ['-p', path, member], { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function officeText(bytes: Buffer, kind: 'docx' | 'pptx'): Promise<OfficeTextExtraction> {
  if (bytes.length > MAX_BYTES) throw new Error('Source exceeds 50 MB');
  const dir = await mkdtemp(join(tmpdir(), 'hypothesis-source-'));
  const path = join(dir, 'source.zip');
  try {
    await writeFile(path, bytes);
    const { stdout: listing } = await exec('unzip', ['-Z1', path], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
    const members = listing.split(/\r?\n/).filter(Boolean);
    if (kind === 'docx') {
      if (!members.includes('word/document.xml')) throw new Error('DOCX is missing word/document.xml');
      return docxXmlToSource(await unzipMember(path, 'word/document.xml'));
    }
    const slides = members.filter((m) => /^ppt\/slides\/slide\d+\.xml$/.test(m)).map((name) => name);
    if (!slides.length) throw new Error('PPTX contains no readable slides');
    if (slides.length > 500) throw new Error('PPTX exceeds the 500-slide intake limit');
    const xmls: Array<{ name: string; xml: string }> = [];
    for (let i = 0; i < slides.length; i += 4) {
      xmls.push(...await Promise.all(slides.slice(i, i + 4).map(async (name) => ({ name, xml: await unzipMember(path, name) }))));
    }
    return pptxSlideXmlToSource(xmls);
  } catch (error) {
    if (error instanceof Error && /DOCX|PPTX/.test(error.message)) throw error;
    throw new Error(`Could not extract ${kind.toUpperCase()} source: ${error instanceof Error ? error.message : String(error)}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function pdfText(bytes: Buffer): Promise<OfficeTextExtraction> {
  if (bytes.length > MAX_BYTES || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF or source exceeds 50 MB');
  const dir = await mkdtemp(join(tmpdir(), 'hypothesis-pdf-'));
  try {
    const path = join(dir, 'source.pdf');
    await writeFile(path, bytes);
    const { stdout } = await exec('pdftotext', ['-raw', path, '-'], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    const pages = splitPdfPages(stdout);
    const extractedText = pages.join('').trim();
    if (extractedText.length < 20) throw new Error('PDF contains fewer than 20 extractable text characters; scanned PDFs require OCR, which is not enabled');
    return pdfPagesToSource(stdout);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

function splitPdfPages(extractedText: string): string[] {
  const pages = extractedText.split('\f');
  // pdftotext terminates the final page with a form-feed; discard only that
  // sentinel. Empty interior pages are real page positions and must survive.
  if (pages.at(-1)?.trim() === '') pages.pop();
  return pages;
}

/** Keep 1-based PDF page identity, including blank pages, in extracted source text. */
export function pdfPagesToSource(extractedText: string): OfficeTextExtraction {
  const pages = splitPdfPages(extractedText);
  let text = '';
  const nativeLocations: NativeSourceLocationRange[] = [];
  for (const [index, page] of pages.entries()) {
    if (index > 0) text += '\n\n';
    const startChar = text.length;
    text += `## Page ${index + 1}\n\n${page.trim()}`;
    nativeLocations.push({ startChar, endChar: text.length, sourceLocation: { kind: 'pdf-page', page: index + 1 } });
  }
  return { text, nativeLocations };
}

/** String-only compatibility wrapper. Intake callers should use pdfPagesToSource. */
export function pdfPagesToMarkdown(extractedText: string): string {
  return pdfPagesToSource(extractedText).text;
}

/** Read text/Markdown/PDF/DOCX/PPTX into the same evidence-addressable SourceDoc contract. */
export async function loadSourceDoc(path: string): Promise<SourceDoc> {
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES) throw new Error('Source exceeds 50 MB');
  const ext = extname(path).toLowerCase();
  let format: SourceDoc['format'];
  let text: string;
  let nativeLocations: NativeSourceLocationRange[] = [];
  if (ext === '.pdf') { format = 'pdf'; const extraction = await pdfText(bytes); text = extraction.text; nativeLocations = extraction.nativeLocations; }
  else if (ext === '.docx') { format = 'docx'; const office = await officeText(bytes, 'docx'); text = office.text; nativeLocations = office.nativeLocations; }
  else if (ext === '.pptx') { format = 'pptx'; const office = await officeText(bytes, 'pptx'); text = office.text; nativeLocations = office.nativeLocations; }
  else if (ext === '.md' || ext === '.markdown') { format = 'markdown'; text = bytes.toString('utf8'); }
  else if (ext === '.txt' || ext === '.text') { format = 'text'; text = bytes.toString('utf8'); }
  else throw new Error(`Unsupported source format ${ext || '(no extension)'}; use PDF, DOCX, PPTX, Markdown, or text`);
  if (text.length > MAX_TEXT) throw new Error(`Extracted source exceeds ${MAX_TEXT.toLocaleString()} characters`);
  if (text.trim().length < 20) throw new Error(`Source ${basename(path)} has fewer than 20 extractable characters`);
  return sourceDocFromText(text, format, nativeLocations);
}
