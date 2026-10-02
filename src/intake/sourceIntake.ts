import { readFile } from 'node:fs/promises';
import { fetchPublicHttps } from './fetch.js';
import { runSourceIntake, type IntakePlan } from './registry.js';
import type { SourceDoc } from './sourceDoc.js';

/**
 * Document intake entry points. Files and URLs go through the same reader
 * registry (`intake/registry.ts`); each format's reader lives in `intake/`.
 */
export { isPublicSourceAddress, validatePublicHttpsSourceUrl } from './fetch.js';
export { extractHtmlSource } from './html.js';
export { docxXmlToMarkdown, docxXmlToSource, pptxSlideXmlToMarkdown, pptxSlideXmlToSource } from './office.js';
export { pdfPagesToMarkdown, pdfPagesToSource } from './pdfPoppler.js';
export { intakeWarningFailures, planSourceIntake, registerSourceExtractor } from './registry.js';

/** Read a PDF, DOCX, PPTX, HTML, Markdown, text or JSON file into an evidence-addressable SourceDoc. */
export async function loadSourceDoc(path: string, plan?: IntakePlan): Promise<SourceDoc> {
  return loadSourceDocFromBytes({ bytes: await readFile(path), name: path }, plan);
}

/** Parse the exact bytes already read and hashed by the caller. */
export async function loadSourceDocFromBytes(input: { bytes: Buffer; name: string; url?: string; contentType?: string }, plan?: IntakePlan): Promise<SourceDoc> {
  return runSourceIntake(input, plan);
}

/** Read a public HTTPS URL (HTML, text, PDF, DOCX or PPTX) with DNS pinning and redirect revalidation. */
export async function loadSourceDocFromUrl(url: string): Promise<SourceDoc> {
  const fetched = await fetchPublicHttps(url, { accept: 'text/html,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  const name = new URL(fetched.finalUrl).pathname.split('/').filter(Boolean).at(-1) ?? new URL(fetched.finalUrl).hostname;
  return runSourceIntake({ bytes: fetched.bytes, name, url: fetched.finalUrl, contentType: fetched.contentType });
}
