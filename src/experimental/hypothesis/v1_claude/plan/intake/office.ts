import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { NativeSourceLocation } from '../../../shared/contracts.js';
import type { NativeSourceLocationRange } from '../sourceDoc.js';
import { canonicalWarnings, joinBlocks, markdownTable, mediaTypeFor, newCanonicalCounts, storeAsset, type CanonicalCounts, type TextBlock } from './blocks.js';
import { INTAKE_LIMITS, execTool } from './limits.js';
import type { ExtractedFigure, IntakeWarning, SourceExtraction, SourceExtractor } from './types.js';

export interface OfficeTextExtraction { text: string; nativeLocations: NativeSourceLocationRange[]; title?: string }

// ---------------------------------------------------------------- zip access

interface ZipArchive { members: string[]; read(member: string): Promise<Buffer>; readText(member: string): Promise<string | undefined>; close(): Promise<void> }

async function openZip(bytes: Buffer): Promise<ZipArchive> {
  const dir = await mkdtemp(join(tmpdir(), 'hypothesis-office-'));
  const archive = join(dir, 'source.zip');
  await writeFile(archive, bytes);
  try {
    const { stdout } = await execTool('unzip', ['-Z1', archive], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    const members = stdout.split(/\r?\n/).filter(Boolean);
    const read = async (member: string): Promise<Buffer> => {
      const { stdout: raw } = await execTool('unzip', ['-p', archive, member], { encoding: 'buffer', timeout: 20_000, maxBuffer: INTAKE_LIMITS.maxSourceBytes });
      return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    };
    return {
      members,
      read,
      readText: async (member) => (members.includes(member) ? (await read(member)).toString('utf8') : undefined),
      close: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`not a readable Office (zip) file: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
}

function relationships(xml: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  const $ = load(xml, { xmlMode: true });
  $('Relationship').each((_i, relation) => {
    const id = $(relation).attr('Id');
    const target = $(relation).attr('Target');
    if (id && target && $(relation).attr('TargetMode') !== 'External') map.set(id, target);
  });
  return map;
}

/** Package titles that name the application or template rather than the document. */
const PLACEHOLDER_TITLE = /^(?:untitled|title|document\d*|presentation\d*|powerpoint presentation|slide \d+)$/i;

function coreTitle(xml: string | undefined): string | undefined {
  if (!xml) return undefined;
  const title = load(xml, { xmlMode: true })('dc\\:title').first().text().replace(/\s+/g, ' ').trim();
  return title.length >= 3 && !PLACEHOLDER_TITLE.test(title) ? title : undefined;
}

// ---------------------------------------------------------------- DOCX

/** Body-level blocks, with content controls (`w:sdt`) unwrapped so their paragraphs are kept in order. */
function docxBodyBlocks($: CheerioAPI): Element[] {
  const out: Element[] = [];
  const visit = (nodes: Cheerio<Element>) => nodes.each((_i, el) => {
    const name = el.tagName.toLowerCase();
    if (name === 'w:sdt') visit($(el).children('w\\:sdtContent').children());
    else if (name === 'w:customxml') visit($(el).children());
    else out.push(el);
  });
  visit($('w\\:body').first().children());
  return out;
}

/** Visible paragraph text: field codes and deleted revisions removed, tabs and breaks kept as spaces. */
function docxParagraphText($: CheerioAPI, paragraph: Cheerio<AnyNode>): string {
  const clone = paragraph.clone();
  clone.find('w\\:instrText, w\\:del, w\\:delText, w\\:rPr, w\\:pPr').remove();
  clone.find('w\\:tab, w\\:br, w\\:cr').replaceWith(' ');
  // Keep Word's mixed prose/math run order: display math becomes its own
  // `$$` block, inline math stays inside the sentence as \( \).
  const math = (node: AnyNode) => $(node).text().trim().replace(/\$/g, '\\$');
  clone.find('m\\:oMathPara').each((_j, node) => { const formula = math(node); $(node).replaceWith(formula ? `\n\n$$\n${formula}\n$$\n\n` : ''); });
  clone.find('m\\:oMath').each((_j, node) => { const formula = math(node); $(node).replaceWith(formula ? `\\(${formula}\\)` : ''); });
  return clone.text();
}

const GENERIC_DRAWING_NAME = /^(?:picture|image|graphic|grafik|chart|diagram|drawing|object)\s*\d*$/i;

function docxHeadingLevel(paragraph: Cheerio<AnyNode>): number | undefined {
  const outline = paragraph.find('w\\:outlineLvl').attr('w:val');
  if (outline !== undefined && /^\d$/.test(outline)) return Math.min(6, Number(outline) + 1);
  const style = paragraph.find('w\\:pStyle').attr('w:val') ?? '';
  if (/^title$/i.test(style)) return 1;
  const heading = style.match(/heading\s*(\d)/i);
  return heading ? Math.max(1, Math.min(6, Number(heading[1]))) : undefined;
}

function docxBlocks(xml: string): TextBlock[] {
  const $ = load(xml, { xmlMode: true });
  const blocks: TextBlock[] = [];
  let paragraphIndex = 0;
  let tableIndex = 0;
  for (const [index, el] of docxBodyBlocks($).entries()) {
    const node = $(el);
    const name = el.tagName.toLowerCase();
    if (name === 'w:p') {
      paragraphIndex += 1;
      const sourceLocation: NativeSourceLocation = { kind: 'docx-paragraph', bodyBlock: index + 1, paragraph: paragraphIndex };
      const value = docxParagraphText($, node);
      const level = docxHeadingLevel(node);
      const docPr = node.find('wp\\:docPr').first();
      const name = docPr.attr('name');
      const figure = docPr.attr('descr') || (name && !GENERIC_DRAWING_NAME.test(name) ? name : undefined);
      if (value.trim()) blocks.push({ text: level ? `${'#'.repeat(level)} ${value.trim()}` : value, sourceLocation });
      if (figure) blocks.push({ text: `[Figure reference: ${figure}]`, sourceLocation });
    } else if (name === 'w:tbl') {
      tableIndex += 1;
      const rows: string[][] = [];
      node.find('w\\:tr').each((_ri, tr) => {
        const cells = $(tr).children('w\\:tc').map((_ci, tc) => $(tc).find('w\\:p').map((_pi, p) => docxParagraphText($, $(p)).trim()).get().filter(Boolean).join(' ')).get();
        if (cells.some(Boolean)) rows.push(cells);
      });
      if (rows.length) blocks.push({ text: markdownTable(rows), sourceLocation: { kind: 'docx-table', bodyBlock: index + 1, table: tableIndex } });
    }
  }
  return blocks;
}

/** DOCX body in document order: headings, prose, inline/display math, tables and figure references, each with its native locator. */
export function docxXmlToSource(xml: string, counts: CanonicalCounts = newCanonicalCounts()): OfficeTextExtraction {
  return joinBlocks(docxBlocks(xml), counts);
}

/** String-only compatibility wrapper. Intake callers should use docxXmlToSource. */
export function docxXmlToMarkdown(xml: string): string {
  return docxXmlToSource(xml).text;
}

async function docxFigureRefs(zip: ZipArchive, documentXml: string): Promise<Map<string, NativeSourceLocation[]>> {
  const rels = relationships(await zip.readText('word/_rels/document.xml.rels'));
  const $ = load(documentXml, { xmlMode: true });
  const refs = new Map<string, NativeSourceLocation[]>();
  let paragraph = 0;
  for (const [index, el] of docxBodyBlocks($).entries()) {
    if (el.tagName.toLowerCase() !== 'w:p') continue;
    paragraph += 1;
    const node = $(el);
    const ids = [...node.find('a\\:blip').map((_j, image) => $(image).attr('r:embed')).get(), ...node.find('v\\:imagedata').map((_j, image) => $(image).attr('r:id')).get()].filter(Boolean) as string[];
    for (const id of ids) addMediaRef(refs, 'word', rels.get(id), { kind: 'docx-paragraph', bodyBlock: index + 1, paragraph });
  }
  return refs;
}

// ---------------------------------------------------------------- PPTX

export interface PptxSlide { name: string; xml: string }

/** Slide members in presentation order (`ppt/presentation.xml` → `sldIdLst`). */
function presentationOrder(presentationXml: string | undefined, relsXml: string | undefined): string[] | undefined {
  if (!presentationXml) return undefined;
  const rels = relationships(relsXml);
  const $ = load(presentationXml, { xmlMode: true });
  const order = $('p\\:sldIdLst p\\:sldId').map((_i, el) => rels.get($(el).attr('r:id') ?? '')).get().filter(Boolean).map((target) => posix.normalize(`ppt/${target}`));
  return order.length ? order : undefined;
}

function pptxShapeBlocks($: CheerioAPI, tree: Cheerio<AnyNode>, out: { blocks: string[]; title?: string }): void {
  tree.children().each((_i, child) => {
    const node = $(child);
    const tag = (child as Element).tagName?.toLowerCase();
    if (tag === 'p:grpsp') { pptxShapeBlocks($, node, out); return; }
    if (tag === 'p:sp' || tag === 'p:graphicframe') {
      const table = node.find('a\\:tbl').first();
      if (table.length) {
        const rows: string[][] = [];
        table.find('a\\:tr').each((_ri, tr) => {
          const cells = $(tr).children('a\\:tc').map((_ci, tc) => $(tc).find('a\\:p').map((_pi, p) => $(p).find('a\\:t').map((_j, t) => $(t).text()).get().join('').trim()).get().filter(Boolean).join(' ')).get();
          if (cells.some(Boolean)) rows.push(cells);
        });
        if (rows.length) out.blocks.push(markdownTable(rows));
        return;
      }
      const paragraphs = node.find('a\\:p').map((_pi, p) => $(p).find('a\\:t, a\\:br').map((_j, t) => ((t as Element).tagName.toLowerCase() === 'a:br' ? ' ' : $(t).text())).get().join('').trim()).get().filter(Boolean);
      if (!paragraphs.length) return;
      const placeholder = node.find('p\\:nvPr p\\:ph').attr('type');
      if (placeholder === 'title' || placeholder === 'ctrTitle') {
        out.title ??= paragraphs.join(' ');
        out.blocks.push(`### ${paragraphs.join(' ')}`);
      } else out.blocks.push(paragraphs.join('\n'));
    } else if (tag === 'p:pic') {
      const description = node.find('p\\:cNvPr').attr('descr') || node.find('p\\:cNvPr').attr('name');
      if (description && !GENERIC_DRAWING_NAME.test(description)) out.blocks.push(`[Figure reference: ${description}]`);
    }
  });
}

/**
 * Number the visible slides. With a presentation order, a slide's number is
 * its position in that order (hidden slides keep their position); without
 * one, the number in the member name is used.
 */
export function pptxSlideNumbers(slides: readonly PptxSlide[], order?: readonly string[]): Array<{ slide: PptxSlide; number: number; hidden: boolean }> {
  const byName = new Map(slides.map((slide) => [slide.name, slide]));
  const ordered = order
    ? order.flatMap((name, index) => (byName.has(name) ? [{ slide: byName.get(name)!, number: index + 1 }] : []))
    : [...slides].map((slide) => ({ slide, number: Number(slide.name.match(/slide(\d+)\.xml$/i)?.[1] ?? 0) })).sort((a, b) => a.number - b.number);
  return ordered.map((entry) => ({ ...entry, hidden: /^\s*<[^>]*?\bshow="(?:0|false)"/.test(entry.slide.xml.replace(/^<\?xml[^>]*>\s*/, '')) }));
}

/**
 * PPTX slides in presentation order, each introduced by a generated
 * `## Slide N` heading and bound to a `pptx-slide` location. Grouped shapes
 * are read; hidden slides are skipped.
 */
export function pptxSlideXmlToSource(slides: readonly PptxSlide[], options: { order?: readonly string[]; counts?: CanonicalCounts } = {}): OfficeTextExtraction & { hiddenSlides: number } {
  const blocks: TextBlock[] = [];
  let title: string | undefined;
  let hiddenSlides = 0;
  for (const { slide, number, hidden } of pptxSlideNumbers(slides, options.order)) {
    if (hidden) { hiddenSlides += 1; continue; }
    const $ = load(slide.xml, { xmlMode: true });
    const content: { blocks: string[]; title?: string } = { blocks: [] };
    pptxShapeBlocks($, $('p\\:spTree').first(), content);
    title ??= content.title;
    blocks.push({ text: [`## Slide ${number}`, ...content.blocks].join('\n\n'), sourceLocation: { kind: 'pptx-slide', slide: number } });
  }
  return { ...joinBlocks(blocks, options.counts), ...(title ? { title } : {}), hiddenSlides };
}

/** String-only compatibility wrapper. Intake callers should use pptxSlideXmlToSource. */
export function pptxSlideXmlToMarkdown(slides: readonly PptxSlide[]): string {
  return pptxSlideXmlToSource(slides).text;
}

// ---------------------------------------------------------------- figures

function addMediaRef(refs: Map<string, NativeSourceLocation[]>, prefix: string, target: string | undefined, location: NativeSourceLocation): void {
  if (!target) return;
  const member = posix.normalize(`${prefix}/${target}`);
  if (!member.startsWith(`${prefix}/media/`) || member.split('/').includes('..')) return;
  refs.set(member, [...(refs.get(member) ?? []), location]);
}

async function storeOfficeFigures(zip: ZipArchive, refs: Map<string, NativeSourceLocation[]>): Promise<{ figures: ExtractedFigure[]; warnings: IntakeWarning[] }> {
  const members = [...refs.keys()];
  const kept = members.slice(0, INTAKE_LIMITS.maxFigures);
  const figures: ExtractedFigure[] = [];
  let totalBytes = 0;
  let stored = 0;
  for (const member of kept) {
    const bytes = await zip.read(member);
    if (totalBytes + bytes.length > INTAKE_LIMITS.maxFigureBytes) continue;
    totalBytes += bytes.length;
    stored += 1;
    const { assetPath, sha256 } = await storeAsset(bytes, extname(member));
    for (const sourceLocation of refs.get(member) ?? []) figures.push({ sha256, sourceLocation, ...(sourceLocation.kind === 'pptx-slide' ? { page: sourceLocation.slide } : {}), mediaType: mediaTypeFor(extname(member)), assetPath, derivationStatus: 'embedded-image-crop', indexStatus: 'not-indexed' });
  }
  const skipped = members.length - stored;
  return { figures, warnings: skipped ? [{ code: 'figures-capped', message: `kept ${stored} embedded image(s); ${skipped} more exceeded the figure limits`, count: skipped }] : [] };
}

// ---------------------------------------------------------------- extractors

export const docxExtractor: SourceExtractor = {
  id: 'docx-ooxml',
  version: '2',
  kinds: ['docx'],
  async available() { return { ok: true }; },
  async extract(input): Promise<SourceExtraction> {
    const zip = await openZip(input.bytes);
    try {
      const documentXml = await zip.readText('word/document.xml');
      if (!documentXml) throw new Error('DOCX is missing word/document.xml');
      const counts = newCanonicalCounts();
      const { text, nativeLocations } = docxXmlToSource(documentXml, counts);
      const figures = await storeOfficeFigures(zip, await docxFigureRefs(zip, documentXml));
      const title = coreTitle(await zip.readText('docProps/core.xml'));
      return { format: 'docx', text, nativeLocations, ...(title ? { title } : {}), figures: figures.figures, warnings: [...canonicalWarnings(counts), ...figures.warnings] };
    } finally { await zip.close(); }
  },
};

export const pptxExtractor: SourceExtractor = {
  id: 'pptx-ooxml',
  version: '2',
  kinds: ['pptx'],
  async available() { return { ok: true }; },
  async extract(input): Promise<SourceExtraction> {
    const zip = await openZip(input.bytes);
    try {
      const names = zip.members.filter((member) => /^ppt\/slides\/slide\d+\.xml$/.test(member));
      if (!names.length) throw new Error('PPTX contains no readable slides');
      if (names.length > INTAKE_LIMITS.maxSlides) throw new Error(`PPTX exceeds the ${INTAKE_LIMITS.maxSlides}-slide intake limit`);
      const slides: PptxSlide[] = [];
      for (const name of names) slides.push({ name, xml: (await zip.readText(name))! });
      const order = presentationOrder(await zip.readText('ppt/presentation.xml'), await zip.readText('ppt/_rels/presentation.xml.rels'));
      const counts = newCanonicalCounts();
      const extraction = pptxSlideXmlToSource(slides, { ...(order ? { order } : {}), counts });
      const refs = new Map<string, NativeSourceLocation[]>();
      for (const { slide, number, hidden } of pptxSlideNumbers(slides, order)) {
        if (hidden) continue;
        const stem = slide.name.split('/').at(-1)!;
        const rels = relationships(await zip.readText(`ppt/slides/_rels/${stem}.rels`));
        const $ = load(slide.xml, { xmlMode: true });
        for (const id of $('a\\:blip').map((_j, image) => $(image).attr('r:embed')).get().filter(Boolean) as string[]) addMediaRef(refs, 'ppt', rels.get(id) ? posix.normalize(`slides/${rels.get(id)}`) : undefined, { kind: 'pptx-slide', slide: number });
      }
      const figures = await storeOfficeFigures(zip, refs);
      const warnings: IntakeWarning[] = [...canonicalWarnings(counts), ...figures.warnings];
      if (extraction.hiddenSlides) warnings.push({ code: 'hidden-slides-skipped', message: `skipped ${extraction.hiddenSlides} hidden slide(s)`, count: extraction.hiddenSlides });
      const title = coreTitle(await zip.readText('docProps/core.xml')) ?? extraction.title;
      return { format: 'pptx', text: extraction.text, nativeLocations: extraction.nativeLocations, ...(title ? { title } : {}), generatedHeadings: true, figures: figures.figures, warnings };
    } finally { await zip.close(); }
  },
};
