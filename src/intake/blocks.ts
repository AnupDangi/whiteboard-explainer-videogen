import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { NativeSourceLocation } from '../shared/contracts.js';
import type { NativeSourceLocationRange } from './sourceDoc.js';
import type { IntakeWarning } from './types.js';

/** Typographic ligatures that PDF and Office text keep as single code points. */
const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
const LIGATURE_PATTERN = new RegExp(`[${Object.keys(LIGATURES).join('')}]`, 'gu');
/** Soft hyphen, zero-width space/joiners, word joiner and BOM: invisible, and they break quote matching. */
const INVISIBLE_PATTERN = /[­​-‍⁠﻿]/gu;

/**
 * Canonical source text: NFC, ligatures expanded, invisible characters removed.
 * Applied once, inside extraction, so every span, offset and stored quote refers
 * to the same canonical text. The counts become an intake warning.
 */
export function canonicalizeText(text: string, counts: CanonicalCounts = newCanonicalCounts()): string {
  const composed = text.normalize('NFC');
  if (composed !== text) counts.recomposed += 1;
  return composed
    .replace(LIGATURE_PATTERN, (ligature) => { counts.ligatures += 1; return LIGATURES[ligature]!; })
    .replace(INVISIBLE_PATTERN, () => { counts.invisible += 1; return ''; });
}

export interface CanonicalCounts { recomposed: number; ligatures: number; invisible: number }
export const newCanonicalCounts = (): CanonicalCounts => ({ recomposed: 0, ligatures: 0, invisible: 0 });

export function canonicalWarnings(counts: CanonicalCounts): IntakeWarning[] {
  const total = counts.recomposed + counts.ligatures + counts.invisible;
  return total ? [{ code: 'text-canonicalized', message: `normalized ${counts.ligatures} ligature(s), removed ${counts.invisible} invisible character(s), recomposed ${counts.recomposed} block(s) to NFC`, count: total }] : [];
}

export interface TextBlock { text: string; sourceLocation?: NativeSourceLocation }

/**
 * Join extracted blocks with blank lines, canonicalizing each block before its
 * range is recorded, so native locations always cover the final text.
 */
export function joinBlocks(blocks: readonly TextBlock[], counts: CanonicalCounts = newCanonicalCounts()): { text: string; nativeLocations: NativeSourceLocationRange[] } {
  let text = '';
  const nativeLocations: NativeSourceLocationRange[] = [];
  for (const block of blocks) {
    const body = canonicalizeText(block.text, counts);
    if (!body.trim()) continue;
    if (text) text += '\n\n';
    const startChar = text.length;
    text += body;
    if (block.sourceLocation) nativeLocations.push({ startChar, endChar: text.length, sourceLocation: block.sourceLocation });
  }
  return { text, nativeLocations };
}

/** A Markdown pipe table; the first row is the header. */
export function markdownTable(rows: readonly (readonly string[])[]): string {
  const width = Math.max(...rows.map((row) => row.length));
  const line = (row: readonly string[]) => `| ${Array.from({ length: width }, (_, i) => (row[i] ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()).join(' | ')} |`;
  return [line(rows[0]!), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

export const sha256Hex = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

export function sourceAssetsDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.HYPOTHESIS_SOURCE_ASSETS_DIR ?? '.data/hypothesis-source-assets');
}

/** Store an extracted image content-addressed; returns its path and digest. */
export async function storeAsset(bytes: Buffer, extension: string): Promise<{ assetPath: string; sha256: string }> {
  const digest = sha256Hex(bytes);
  const dir = sourceAssetsDir();
  await mkdir(dir, { recursive: true });
  const safeExtension = extension.toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
  const assetPath = join(dir, `${digest}${safeExtension}`);
  if (!existsSync(assetPath)) await writeFile(assetPath, bytes, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
  return { assetPath, sha256: digest };
}

const MEDIA_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.jp2': 'image/jp2', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp' };
export const mediaTypeFor = (extension: string): string => MEDIA_TYPES[extension.toLowerCase()] ?? 'application/octet-stream';
