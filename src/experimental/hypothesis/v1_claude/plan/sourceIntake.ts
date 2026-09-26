import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, posix, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { load } from 'cheerio';
import ipaddr from 'ipaddr.js';
import { sourceDocFromText, type NativeSourceLocationRange, type SourceDoc } from './sourceDoc.js';
import type { NativeSourceLocation } from '../../shared/contracts.js';

const exec = promisify(execFile);
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_TEXT = 5_000_000;

export function isPublicSourceAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

export function validatePublicHttpsSourceUrl(value: string): URL {
  const target = new URL(value);
  if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443')) throw new Error('URL sources must use public HTTPS without credentials or a custom port');
  return target;
}

async function fetchPublicHttps(url: string, redirects = 0): Promise<{ bytes: Buffer; contentType: string; finalUrl: string }> {
  const target = validatePublicHttpsSourceUrl(url);
  const addresses = await lookup(target.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicSourceAddress(address))) throw new Error('Private or reserved network addresses are not allowed');
  return new Promise((resolve, reject) => {
    const req = httpsRequest(target, {
      timeout: 60_000,
      headers: { 'User-Agent': 'ExplainCanvasLab-Hypothesis/1.0', Accept: 'text/html,text/plain,application/pdf' },
      lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: any[]) => void) => options.all
        ? callback(null, addresses)
        : callback(null, addresses[0]!.address, addresses[0]!.family)) as never,
    }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        if (redirects >= 3 || !res.headers.location) return reject(new Error('Too many source URL redirects'));
        return fetchPublicHttps(new URL(res.headers.location, target).href, redirects + 1).then(resolve, reject);
      }
      if (status !== 200) { res.resume(); return reject(new Error(`Source URL returned HTTP ${status}`)); }
      const chunks: Buffer[] = [];
      let length = 0;
      res.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > MAX_BYTES) req.destroy(new Error('Source exceeds 50 MB'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: String(res.headers['content-type'] ?? ''), finalUrl: target.href }));
    });
    req.on('timeout', () => req.destroy(new Error('Source URL request timed out')));
    req.on('error', reject);
    req.end();
  });
}

export function extractHtmlSource(bytes: Buffer, url: string): { text: string; title?: string; locations: NativeSourceLocationRange[]; figures: Array<{ url: string; caption?: string; selector: string }> } {
  const $ = load(bytes.toString('utf8'));
  const title = $('title').first().text().trim() || $('h1').first().text().trim() || undefined;
  $('script,style,nav,footer,header,aside,noscript,svg,form').remove();
  const blocks: Array<{ text: string; selector: string }> = [];
  const figures: Array<{ url: string; caption?: string; selector: string }> = [];
  const selector = 'main h1, main h2, main h3, main h4, main p, main li, main table, main figure, article h1, article h2, article h3, article h4, article p, article li, article table, article figure, body h1, body h2, body h3, body h4, body p, body li, body table, body figure';
  $(selector).each((_index, element) => {
    const node = $(element);
    const tag = element.tagName.toLowerCase();
    const content = (tag === 'figure' ? node.find('figcaption').first().text() || node.find('img').first().attr('alt') || '' : node.text()).replace(/\s+/g, ' ').trim();
    if (tag === 'figure') {
      const imageUrl = node.find('img').first().attr('src');
      if (imageUrl) {
        try { figures.push({ url: new URL(imageUrl, url).href, ...(content ? { caption: content } : {}), selector: `figure${node.attr('id') ? `#${node.attr('id')}` : ''}` }); } catch { /* malformed image URLs do not invalidate readable article text */ }
      }
    }
    if (content.length < 2) return;
    const text = tag.match(/^h[1-4]$/) ? `${'#'.repeat(Number(tag[1]))} ${content}` : tag === 'li' ? `- ${content}` : tag === 'table' ? content : tag === 'figure' ? `[Figure metadata: ${content}]` : content;
    if (blocks.at(-1)?.text !== text) blocks.push({ text, selector: `${tag}${node.attr('id') ? `#${node.attr('id')}` : ''}` });
  });
  if (!blocks.length) throw new Error('HTML URL contains no readable article text');
  let text = '';
  const locations: NativeSourceLocationRange[] = [];
  for (const [index, block] of blocks.entries()) {
    if (index) text += '\n\n';
    const startChar = text.length;
    text += block.text;
    locations.push({ startChar, endChar: text.length, sourceLocation: { kind: 'web-url', url, selector: block.selector } });
  }
  return { text, title, locations, figures };
}

async function fetchHtmlFigureAssets(figures: Array<{ url: string; caption?: string; selector: string }>, sourceId: string, pageUrl: string): Promise<NonNullable<SourceDoc['figureAssets']>> {
  const selected = [...new Map(figures.map((figure) => [figure.url, figure])).values()].slice(0, 20);
  const result: NonNullable<SourceDoc['figureAssets']> = [];
  const assetDir = resolve(process.env.HYPOTHESIS_SOURCE_ASSETS_DIR ?? '.data/hypothesis-source-assets');
  await mkdir(assetDir, { recursive: true });
  let totalBytes = 0;
  for (const figure of selected) {
    try {
      const fetched = await fetchPublicHttps(figure.url);
      const mediaType = fetched.contentType.split(';')[0]!.trim().toLowerCase();
      if (!mediaType.startsWith('image/') || mediaType === 'image/svg+xml') continue;
      totalBytes += fetched.bytes.length;
      if (totalBytes > 100 * 1024 * 1024) break;
      const digest = createHash('sha256').update(fetched.bytes).digest('hex');
      const extension = extname(new URL(fetched.finalUrl).pathname).toLowerCase().replace(/[^.a-z0-9]/g, '') || (mediaType === 'image/jpeg' ? '.jpg' : mediaType === 'image/png' ? '.png' : '.img');
      const assetPath = join(assetDir, `${digest}${extension}`);
      if (!existsSync(assetPath)) await writeFile(assetPath, fetched.bytes, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      result.push({ sourceId, sha256: digest, sourceLocation: { kind: 'web-url', url: pageUrl, selector: figure.selector }, mediaType, assetPath, ...(figure.caption ? { caption: figure.caption } : {}), derivationStatus: 'embedded-image-crop', indexStatus: 'not-indexed' });
    } catch { /* unreachable or malformed image assets do not invalidate the source text */ }
  }
  return result;
}

/** Read a public HTML, text, or PDF URL with DNS pinning, redirect revalidation, and exact location provenance. */
export async function loadSourceDocFromUrl(url: string): Promise<SourceDoc> {
  const result = await fetchPublicHttps(url);
  const isPdf = result.contentType.toLowerCase().includes('application/pdf') || result.bytes.subarray(0, 5).toString() === '%PDF-';
  let doc: SourceDoc;
  if (isPdf) {
    const pdf = await pdfText(result.bytes);
    const extraction = pdfPagesToSource(pdf.text);
    doc = sourceDocFromText(extraction.text, 'pdf', extraction.nativeLocations);
    doc.title = new URL(result.finalUrl).pathname.split('/').filter(Boolean).at(-1) ?? 'PDF source';
  } else if (result.contentType.toLowerCase().includes('text/plain')) {
    const text = result.bytes.toString('utf8');
    if (text.trim().length < 20) throw new Error('Text URL contains fewer than 20 readable characters');
    doc = sourceDocFromText(text, 'text', [{ startChar: 0, endChar: text.length, sourceLocation: { kind: 'web-url', url: result.finalUrl } }]);
  } else if (result.contentType.toLowerCase().includes('text/html') || /<html[\s>]/i.test(result.bytes.toString('utf8', 0, 512))) {
    const extracted = extractHtmlSource(result.bytes, result.finalUrl);
    doc = sourceDocFromText(extracted.text, 'markdown', extracted.locations);
    doc.title = extracted.title;
    doc.sourceId = `src_${createHash('sha256').update(`${result.finalUrl}\0${doc.sourceId}`).digest('hex').slice(0, 20)}`;
    doc.sourceUrl = result.finalUrl;
    doc.figureAssets = await fetchHtmlFigureAssets(extracted.figures, doc.sourceId, result.finalUrl);
  } else throw new Error('URL must return HTML, plain text, or PDF');
  if (doc.text.length > MAX_TEXT) throw new Error(`Extracted source exceeds ${MAX_TEXT.toLocaleString()} characters`);
  if (!doc.sourceUrl) {
    doc.sourceId = `src_${createHash('sha256').update(`${result.finalUrl}\0${doc.sourceId}`).digest('hex').slice(0, 20)}`;
    doc.sourceUrl = result.finalUrl;
  }
  doc.contentSha256 = createHash('sha256').update(result.bytes).digest('hex');
  if (isPdf) doc.figureAssets = await extractPdfFigureAssets(result.bytes, doc.sourceId, doc.spans.filter((span) => span.sourceLocation?.kind === 'pdf-page').length);
  return doc;
}

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

async function extractOfficeFigureAssets(bytes: Buffer, sourceId: string, kind: 'docx' | 'pptx'): Promise<NonNullable<SourceDoc['figureAssets']>> {
  const dir = await mkdtemp(join(tmpdir(), 'hypothesis-office-images-'));
  const archive = join(dir, 'source.zip');
  await writeFile(archive, bytes);
  const prefix = kind === 'docx' ? 'word' : 'ppt';
  const mediaMembers = new Set<string>();
  const locations = new Map<string, NativeSourceLocation[]>();
  const addReference = (target: string, location: NativeSourceLocation) => {
    const member = posix.normalize(`${prefix}/${target}`).replace(/^\.\//, '');
    if (!member.startsWith(`${prefix}/media/`) || member.split('/').includes('..')) return;
    mediaMembers.add(member);
    const refs = locations.get(member) ?? [];
    refs.push(location);
    locations.set(member, refs);
  };
  const relationships = (xml: string): Map<string, string> => {
    const map = new Map<string, string>();
    const $ = load(xml, { xmlMode: true });
    $('Relationship').each((_i, relation) => {
      const id = $(relation).attr('Id');
      const target = $(relation).attr('Target');
      if (id && target && !target.startsWith('/')) map.set(id, target);
    });
    return map;
  };
  try {
    const { stdout: listing } = await exec('unzip', ['-Z1', archive], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
    const members = listing.split(/\r?\n/).filter(Boolean);
    if (kind === 'docx') {
      const [documentXml, relsXml] = await Promise.all([
        unzipMember(archive, 'word/document.xml'),
        unzipMember(archive, 'word/_rels/document.xml.rels').catch(() => '<Relationships/>'),
      ]);
      const rels = relationships(relsXml);
      const $ = load(documentXml, { xmlMode: true });
      let paragraph = 0;
      let bodyBlock = 0;
      $('w\\:body').children().each((_i, element) => {
        bodyBlock += 1;
        const node = $(element);
        if (element.tagName.toLowerCase() !== 'w:p') return;
        paragraph += 1;
        const refs = [...node.find('a\\:blip').map((_j, image) => $(image).attr('r:embed')).get(), ...node.find('v\\:imagedata').map((_j, image) => $(image).attr('r:id')).get()].filter(Boolean) as string[];
        for (const id of refs) { const target = rels.get(id); if (target) addReference(target, { kind: 'docx-paragraph', bodyBlock, paragraph }); }
      });
    } else {
      const slides = members.filter((member) => /^ppt\/slides\/slide\d+\.xml$/.test(member));
      for (const slidePath of slides) {
        const slideNumber = Number(slidePath.match(/slide(\d+)\.xml$/)?.[1]);
        const stem = slidePath.split('/').at(-1)!;
        const relationshipPath = `ppt/slides/_rels/${stem}.rels`;
        const [slideXml, relsXml] = await Promise.all([unzipMember(archive, slidePath), unzipMember(archive, relationshipPath).catch(() => '<Relationships/>')]);
        const rels = relationships(relsXml);
        const $ = load(slideXml, { xmlMode: true });
        const refs = $('a\\:blip').map((_j, image) => $(image).attr('r:embed')).get().filter(Boolean) as string[];
        for (const id of refs) { const target = rels.get(id); if (target) addReference(posix.normalize(`slides/${target}`), { kind: 'pptx-slide', slide: slideNumber }); }
      }
    }
    if (mediaMembers.size > 100) throw new Error('Office document has more than 100 embedded figure assets');
    const assetDir = resolve(process.env.HYPOTHESIS_SOURCE_ASSETS_DIR ?? '.data/hypothesis-source-assets');
    await mkdir(assetDir, { recursive: true });
    const figures: NonNullable<SourceDoc['figureAssets']> = [];
    let totalBytes = 0;
    for (const member of mediaMembers) {
      const { stdout: raw } = await exec('unzip', ['-p', archive, member], { encoding: 'buffer', timeout: 20_000, maxBuffer: 50 * 1024 * 1024 });
      const imageBytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      totalBytes += imageBytes.length;
      if (totalBytes > 250 * 1024 * 1024) throw new Error('Office embedded figures exceed 250 MB');
      const digest = createHash('sha256').update(imageBytes).digest('hex');
      const extension = extname(member).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
      const assetPath = join(assetDir, `${digest}${extension}`);
      if (!existsSync(assetPath)) await writeFile(assetPath, imageBytes, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      for (const sourceLocation of locations.get(member) ?? []) figures.push({ sourceId, sha256: digest, sourceLocation, mediaType: extension === '.png' ? 'image/png' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'application/octet-stream', assetPath, derivationStatus: 'embedded-image-crop', indexStatus: 'not-indexed' });
    }
    return figures;
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

async function extractPdfFigureAssets(bytes: Buffer, sourceId: string, pages: number): Promise<NonNullable<SourceDoc['figureAssets']>> {
  const dir = await mkdtemp(join(tmpdir(), 'hypothesis-pdf-images-'));
  const pdfPath = join(dir, 'source.pdf');
  await writeFile(pdfPath, bytes);
  const assetDir = resolve(process.env.HYPOTHESIS_SOURCE_ASSETS_DIR ?? '.data/hypothesis-source-assets');
  const figures: NonNullable<SourceDoc['figureAssets']> = [];
  let totalBytes = 0;
  try {
    await mkdir(assetDir, { recursive: true });
    for (let page = 1; page <= pages && figures.length < 100; page++) {
      const prefix = join(dir, `page-${page}`);
      try { await exec('pdfimages', ['-all', '-f', String(page), '-l', String(page), pdfPath, prefix], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }); }
      catch (error) { if (page === 1 && /ENOENT/.test(String(error))) break; continue; }
      const files = (await readdir(dir)).filter((name) => name.startsWith(`page-${page}-`) && !name.endsWith('.pdf')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      for (const filename of files) {
        if (figures.length >= 100 || totalBytes >= 250 * 1024 * 1024) break;
        const imageBytes = await readFile(join(dir, filename));
        if (imageBytes.length < 256) continue;
        totalBytes += imageBytes.length;
        if (totalBytes > 250 * 1024 * 1024) break;
        const digest = createHash('sha256').update(imageBytes).digest('hex');
        const extension = extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
        const assetPath = join(assetDir, `${digest}${extension}`);
        if (!existsSync(assetPath)) await writeFile(assetPath, imageBytes, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
        const mediaType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : extension === '.jp2' ? 'image/jp2' : 'application/octet-stream';
        figures.push({ sourceId, sha256: digest, page, mediaType, assetPath, derivationStatus: 'embedded-image-crop', indexStatus: 'not-indexed' });
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
  return figures;
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
  else if (ext === '.txt' || ext === '.text' || ext === '.json') { format = 'text'; text = ext === '.json' ? JSON.stringify(JSON.parse(bytes.toString('utf8')), null, 2) : bytes.toString('utf8'); }
  else throw new Error(`Unsupported source format ${ext || '(no extension)'}; use PDF, DOCX, PPTX, Markdown, or text`);
  if (text.length > MAX_TEXT) throw new Error(`Extracted source exceeds ${MAX_TEXT.toLocaleString()} characters`);
  if (text.trim().length < 20) throw new Error(`Source ${basename(path)} has fewer than 20 extractable characters`);
  const doc = sourceDocFromText(text, format, nativeLocations);
  if (!doc.title) doc.title = basename(path, ext);
  doc.contentSha256 = createHash('sha256').update(bytes).digest('hex');
  if (format === 'pdf') doc.figureAssets = await extractPdfFigureAssets(bytes, doc.sourceId, nativeLocations.length);
  if (format === 'docx' || format === 'pptx') doc.figureAssets = await extractOfficeFigureAssets(bytes, doc.sourceId, format);
  return doc;
}
