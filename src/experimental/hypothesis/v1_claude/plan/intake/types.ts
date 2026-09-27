import type { NativeSourceLocationRange, SourceDoc, SourceFigureAsset } from '../sourceDoc.js';

/** The kinds of input an extractor can read (HTML becomes a Markdown-format SourceDoc). */
export type SourceKind = 'pdf' | 'docx' | 'pptx' | 'html' | 'markdown' | 'text' | 'json';

/** One document to read: raw bytes plus whatever the caller knows about where they came from. */
export interface SourceInput {
  bytes: Buffer;
  /** File name (or the last URL path segment); used for format detection and the title fallback. */
  name: string;
  /** Final URL after redirects, for URL sources. */
  url?: string;
  /** HTTP Content-Type, for URL sources. */
  contentType?: string;
}

/** A recoverable extraction problem that must stay visible in the run record. */
export interface IntakeWarning { code: string; message: string; count?: number }

/** A figure found by an extractor. `sourceId` is attached once the document identity is known. */
export type ExtractedFigure = Omit<SourceFigureAsset, 'sourceId'>;

/** What an extractor returns: canonical text with extractor-authored location ranges. */
export interface SourceExtraction {
  format: SourceDoc['format'];
  text: string;
  nativeLocations: NativeSourceLocationRange[];
  /** Title from document metadata or the document's own title element. */
  title?: string;
  /**
   * The extractor wrote structural headings of its own (`## Page 3`, `## Slide 2`).
   * They mark native locations for the model but are never a document title.
   */
  generatedHeadings?: boolean;
  figures: ExtractedFigure[];
  warnings: IntakeWarning[];
}

export type Availability = { ok: true } | { ok: false; reason: string };

/**
 * A pluggable document reader. Register one in `registry.ts`; the rest of the
 * pipeline only sees the finished SourceDoc and the extractor id/version
 * recorded in `SourceDoc.intake`.
 */
export interface SourceExtractor {
  id: string;
  /** Bump when the output for the same bytes changes; it is part of the S1 cache key. */
  version: string;
  kinds: readonly SourceKind[];
  available(): Promise<Availability>;
  extract(input: SourceInput): Promise<SourceExtraction>;
}

/** Recorded on every SourceDoc so a run shows which reader produced its evidence. */
export interface IntakeRecord { extractor: string; extractorVersion: string; warnings: IntakeWarning[] }
