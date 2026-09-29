import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { NativeSourceLocation } from '../../../shared/contracts.js';
import { canonicalWarnings, joinBlocks, markdownTable, mediaTypeFor, newCanonicalCounts, storeAsset, type TextBlock } from './blocks.js';
import { execTool } from './limits.js';
import type { ExtractedFigure, IntakeWarning, SourceExtraction, SourceExtractor } from './types.js';

/**
 * Optional layout-aware PDF reader: `parse-engine/convert.py` (Docling) runs as
 * a separate Python process and writes typed items in reading order plus
 * picture crops. This module is the only place that understands Docling labels.
 * Model output is never involved; the items are data.
 */

/** One typed item from `meta.json` (see parse-engine/convert.py). */
export interface DoclingItem {
  type: string;
  page?: number | null;
  selfRef?: string | null;
  text?: string;
  latex?: string;
  captions?: string[];
  columns?: string[];
  rows?: string[][];
}
export interface DoclingCrop { kind: 'picture' | 'table'; file?: string; sha256?: string; page?: number | null; selfRef?: string | null; error?: string }
export interface DoclingMeta { items?: DoclingItem[]; cropsIndex?: DoclingCrop[]; pages?: number; pictures?: number; device?: string }

/** The directory that holds `parse-engine/`, found from this file in either `src/` or `dist/src/`. */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(dir, 'parse-engine', 'convert.py'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function doclingPaths(env: NodeJS.ProcessEnv = process.env): { python: string; script: string } {
  const root = repoRoot();
  return { python: env.DOCLING_PYTHON || join(root, 'parse-engine', '.venv', 'bin', 'python'), script: join(root, 'parse-engine', 'convert.py') };
}

const HEADING_TYPES = new Set(['title', 'section_header', 'heading']);
const RUNNING_TYPES = new Set(['page_header', 'page_footer']);

/** Map Docling items to located text blocks. Pure: the same items always give the same text. */
export function doclingItemsToBlocks(items: readonly DoclingItem[]): { blocks: TextBlock[]; title?: string; dropped: { running: number; emptyFormulas: number } } {
  const blocks: TextBlock[] = [];
  const dropped = { running: 0, emptyFormulas: 0 };
  let title: string | undefined;
  const attachedCaptions = new Set(items.flatMap((item) => item.captions ?? []).map((caption) => caption.trim()).filter(Boolean));
  const at = (item: DoclingItem): NativeSourceLocation | undefined => (typeof item.page === 'number' ? { kind: 'pdf-page', page: item.page } : undefined);
  const push = (text: string, item: DoclingItem) => {
    const sourceLocation = at(item);
    blocks.push({ text, ...(sourceLocation ? { sourceLocation } : {}) });
  };
  for (const item of items) {
    const text = (item.text ?? '').trim();
    if (RUNNING_TYPES.has(item.type)) { dropped.running += 1; continue; }
    if (item.type === 'list_item') {
      const previous = blocks.at(-1);
      if (text && previous && /^- /.test(previous.text) && JSON.stringify(previous.sourceLocation) === JSON.stringify(at(item))) previous.text += `\n- ${text}`;
      else if (text) push(`- ${text}`, item);
    } else if (HEADING_TYPES.has(item.type)) {
      if (!text) continue;
      if (item.type === 'title') title ??= text;
      push(`${item.type === 'title' ? '#' : '##'} ${text}`, item);
    } else if (item.type === 'formula') {
      const latex = (item.latex ?? item.text ?? '').trim();
      if (latex) push(`$$\n${latex}\n$$`, item);
      else dropped.emptyFormulas += 1;
    } else if (item.type === 'table') {
      const rows = [item.columns ?? [], ...(item.rows ?? [])].filter((row) => row.some((cell) => cell.trim()));
      const caption = item.captions?.find((value) => value.trim())?.trim();
      if (caption) push(caption, item);
      if (rows.length) push(markdownTable(rows), item);
      else if (text) push(text, item);
    } else if (item.type === 'picture') {
      const caption = item.captions?.find((value) => value.trim())?.trim();
      if (caption) push(`[Figure metadata: ${caption}]`, item);
    } else if (item.type === 'caption') {
      if (text && !attachedCaptions.has(text)) push(text, item);
    } else if (text) push(text, item);
  }
  return { blocks, ...(title ? { title } : {}), dropped };
}

function runConvert(python: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Docling timed out after ${timeoutMs} ms (DOCLING_TIMEOUT_MS)`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const last = stdout.trim().split('\n').at(-1) ?? '';
      if (code === 0) resolve(last);
      else reject(new Error(`Docling exited ${code}: ${(safeJson(last)?.error as string | undefined) ?? stderr.trim().slice(-400)}`));
    });
  });
}

const safeJson = (value: string): Record<string, unknown> | undefined => { try { return JSON.parse(value) as Record<string, unknown>; } catch { return undefined; } };

export function doclingPdfExtractor(env: NodeJS.ProcessEnv = process.env): SourceExtractor {
  const { python, script } = doclingPaths(env);
  return {
    id: 'pdf-docling',
    version: '1',
    kinds: ['pdf'],
    async available() {
      if (!existsSync(script)) return { ok: false, reason: `Docling converter not found at ${script}` };
      if (!existsSync(python) && !env.DOCLING_PYTHON) return { ok: false, reason: `Docling Python not found at ${python}; create parse-engine/.venv with docling installed or set DOCLING_PYTHON` };
      try { await execTool(python, ['-c', 'import docling'], { timeout: 60_000 }); return { ok: true }; }
      catch (error) { return { ok: false, reason: `${python} cannot import docling: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` }; }
    },
    async extract(input): Promise<SourceExtraction> {
      const dir = await mkdtemp(join(tmpdir(), 'hypothesis-docling-'));
      try {
        const source = join(dir, 'source.pdf');
        const out = join(dir, 'out');
        await writeFile(source, input.bytes);
        const args = [script, '--input', source, '--out', out];
        for (const [flag, key] of [['--device', 'DOCLING_DEVICE'], ['--ocr', 'DOCLING_OCR'], ['--formulas', 'DOCLING_FORMULAS'], ['--max-pages', 'DOCLING_MAX_PAGES']] as const) if (env[key]) args.push(flag, env[key]!);
        const result = safeJson(await runConvert(python, args, Number(env.DOCLING_TIMEOUT_MS || 600_000)));
        if (!result?.ok) throw new Error(`Docling failed: ${String(result?.error ?? 'no result')}`);
        const meta = JSON.parse(await readFile(String(result.meta ?? join(out, 'meta.json')), 'utf8')) as DoclingMeta;
        const mapped = doclingItemsToBlocks(meta.items ?? []);
        const counts = newCanonicalCounts();
        const { text, nativeLocations } = joinBlocks(mapped.blocks, counts);
        const figures: ExtractedFigure[] = [];
        const captionByRef = new Map((meta.items ?? []).filter((item) => item.type === 'picture' && item.selfRef).map((item) => [item.selfRef!, item.captions?.find((value) => value.trim())?.trim()]));
        for (const crop of meta.cropsIndex ?? []) {
          if (crop.kind !== 'picture' || !crop.file) continue;
          const { assetPath, sha256 } = await storeAsset(await readFile(join(out, crop.file)), extname(crop.file));
          const caption = crop.selfRef ? captionByRef.get(crop.selfRef) : undefined;
          figures.push({ sha256, ...(typeof crop.page === 'number' ? { page: crop.page, sourceLocation: { kind: 'pdf-page', page: crop.page } } : {}), mediaType: mediaTypeFor(extname(crop.file)), assetPath, ...(caption ? { caption } : {}), derivationStatus: 'embedded-image-crop', indexStatus: 'not-indexed' });
        }
        const warnings: IntakeWarning[] = [...canonicalWarnings(counts)];
        if (mapped.dropped.running) warnings.push({ code: 'running-lines-removed', message: `dropped ${mapped.dropped.running} page header/footer item(s)`, count: mapped.dropped.running });
        if (mapped.dropped.emptyFormulas) warnings.push({ code: 'formula-without-text', message: `${mapped.dropped.emptyFormulas} formula item(s) had no recognised text (enable DOCLING_FORMULAS=on)`, count: mapped.dropped.emptyFormulas });
        const cropErrors = (meta.cropsIndex ?? []).filter((crop) => crop.error).length;
        if (cropErrors) warnings.push({ code: 'figure-crop-failed', message: `${cropErrors} picture/table crop(s) could not be written`, count: cropErrors });
        const pagesWithText = new Set(nativeLocations.map((range) => (range.sourceLocation?.kind === 'pdf-page' ? range.sourceLocation.page : 0)));
        const emptyPages = Array.from({ length: meta.pages ?? 0 }, (_, index) => index + 1).filter((page) => !pagesWithText.has(page));
        if (emptyPages.length) warnings.push({ code: 'page-without-text', message: `page(s) ${emptyPages.join(', ')} produced no text items`, count: emptyPages.length });
        return { format: 'pdf', text, nativeLocations, ...(mapped.title ? { title: mapped.title } : {}), figures, warnings };
      } finally { await rm(dir, { recursive: true, force: true }); }
    },
  };
}
