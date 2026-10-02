import { extname } from 'node:path';
import { load, type Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { NativeSourceLocationRange } from './sourceDoc.js';
import { canonicalWarnings, joinBlocks, markdownTable, newCanonicalCounts, storeAsset, type CanonicalCounts, type TextBlock } from './blocks.js';
import { fetchPublicHttps } from './fetch.js';
import { INTAKE_LIMITS } from './limits.js';
import type { ExtractedFigure, SourceExtraction, SourceExtractor } from './types.js';

export interface HtmlFigureLink { url: string; caption?: string; selector: string }
export interface HtmlExtraction { text: string; title?: string; locations: NativeSourceLocationRange[]; figures: HtmlFigureLink[] }

/** Decode with the HTTP charset, then a `<meta charset>`, then UTF-8. */
export function decodeHtml(bytes: Buffer, contentType?: string): string {
  const label = contentType?.match(/charset=["']?([\w-]+)/i)?.[1] ?? bytes.toString('latin1', 0, 4096).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8';
  try { return new TextDecoder(label).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, table, figure, blockquote, pre, dt, dd';
const INLINE_ONLY = new Set(['a', 'abbr', 'b', 'bdi', 'br', 'cite', 'code', 'em', 'i', 'kbd', 'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var']);
const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * Readable article text in document order. Each block is taken once: an
 * element nested inside another matched block (a `<p>` in an `<li>`, a
 * `<p>` in a `<blockquote>`) is part of its container's text, not repeated.
 * A `<div>` that holds prose directly (only inline children) counts as a block.
 */
export function extractHtmlSource(bytes: Buffer, url: string, contentType?: string, counts: CanonicalCounts = newCanonicalCounts()): HtmlExtraction {
  const $ = load(decodeHtml(bytes, contentType));
  const title = collapse($('title').first().text()) || collapse($('h1').first().text()) || undefined;
  $('script,style,nav,footer,header,aside,noscript,svg,form,template').remove();
  const root: Cheerio<AnyNode> = [$('main').first(), $('article').first(), $('body').first()].find((candidate) => candidate.length && collapse(candidate.text()).length > 0) ?? $.root();
  const proseDivs = root.find('div').filter((_i, div) => {
    const node = $(div);
    return node.contents().toArray().some((child) => child.type === 'text' && collapse($(child).text()).length > 0)
      && node.children().toArray().every((child) => INLINE_ONLY.has(child.tagName.toLowerCase()));
  });
  const matched = root.find(BLOCK_SELECTOR).add(proseDivs);
  const matchedSet = new Set(matched.toArray());
  const blocks: TextBlock[] = [];
  const figures: HtmlFigureLink[] = [];
  matched.each((_index, element) => {
    const node = $(element);
    if (node.parents().toArray().some((ancestor) => matchedSet.has(ancestor))) return;
    const tag = element.tagName.toLowerCase();
    const id = node.attr('id');
    const selector = `${tag}${id ? `#${id}` : ''}`;
    let text: string;
    if (tag === 'figure') {
      const caption = collapse(node.find('figcaption').first().text() || node.find('img').first().attr('alt') || '');
      const imageUrl = node.find('img').first().attr('src');
      if (imageUrl) {
        try { figures.push({ url: new URL(imageUrl, url).href, ...(caption ? { caption } : {}), selector: `figure${id ? `#${id}` : ''}` }); } catch { /* a malformed image URL does not invalidate the article text */ }
      }
      text = caption ? `[Figure metadata: ${caption}]` : '';
    } else if (tag === 'table') {
      const rows = node.find('tr').toArray().map((tr) => $(tr).children('th, td').toArray().map((cell) => collapse($(cell).text()))).filter((row) => row.some(Boolean));
      text = rows.length ? markdownTable(rows) : collapse(node.text());
    } else if (tag === 'pre') {
      text = node.text().replace(/^\n+|\s+$/g, '');
    } else {
      const content = collapse(node.text());
      text = /^h[1-6]$/.test(tag) && content ? `${'#'.repeat(Number(tag[1]))} ${content}` : tag === 'li' && content ? `- ${content}` : content;
    }
    if (text.trim().length < 2 || blocks.at(-1)?.text === text) return;
    blocks.push({ text, sourceLocation: { kind: 'web-url', url, selector } });
  });
  const { text, nativeLocations } = joinBlocks(blocks, counts);
  if (!text) throw new Error('HTML URL contains no readable article text');
  return { text, ...(title ? { title } : {}), locations: nativeLocations, figures };
}

async function fetchHtmlFigures(links: readonly HtmlFigureLink[], pageUrl: string): Promise<ExtractedFigure[]> {
  const selected = [...new Map(links.map((figure) => [figure.url, figure])).values()].slice(0, INTAKE_LIMITS.maxHtmlFigures);
  const figures: ExtractedFigure[] = [];
  let totalBytes = 0;
  for (const figure of selected) {
    try {
      const fetched = await fetchPublicHttps(figure.url, { accept: 'image/*' });
      const mediaType = fetched.contentType.split(';')[0]!.trim().toLowerCase();
      if (!mediaType.startsWith('image/') || mediaType === 'image/svg+xml') continue;
      totalBytes += fetched.bytes.length;
      if (totalBytes > INTAKE_LIMITS.maxHtmlFigureBytes) break;
      const extension = extname(new URL(fetched.finalUrl).pathname) || (mediaType === 'image/jpeg' ? '.jpg' : mediaType === 'image/png' ? '.png' : '.img');
      const { assetPath, sha256 } = await storeAsset(fetched.bytes, extension);
      figures.push({ sha256, sourceLocation: { kind: 'web-url', url: pageUrl, selector: figure.selector }, mediaType, assetPath, ...(figure.caption ? { caption: figure.caption } : {}), derivationStatus: 'embedded-image-crop', indexStatus: 'not-indexed' });
    } catch { /* an unreachable image does not invalidate the article text */ }
  }
  return figures;
}

export const htmlExtractor: SourceExtractor = {
  id: 'html-cheerio',
  version: '2',
  kinds: ['html'],
  async available() { return { ok: true }; },
  async extract(input): Promise<SourceExtraction> {
    const pageUrl = input.url ?? `file:${input.name}`;
    const counts = newCanonicalCounts();
    const extracted = extractHtmlSource(input.bytes, pageUrl, input.contentType, counts);
    const figures = input.url ? await fetchHtmlFigures(extracted.figures, input.url) : [];
    const warnings = canonicalWarnings(counts);
    if (extracted.figures.length > figures.length) warnings.push({ code: 'figures-not-fetched', message: `${extracted.figures.length - figures.length} of ${extracted.figures.length} linked figure image(s) could not be fetched or were not raster images`, count: extracted.figures.length - figures.length });
    return { format: 'markdown', text: extracted.text, nativeLocations: extracted.locations, ...(extracted.title ? { title: extracted.title } : {}), figures, warnings };
  },
};
