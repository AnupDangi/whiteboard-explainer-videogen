import { readFile } from 'node:fs/promises';
import { fetchPublicHttps } from './intake/fetch.js';
import { runSourceIntake, type IntakePlan } from './intake/registry.js';
import type { SourceDoc } from './sourceDoc.js';

/**
 * Document intake entry points. Files and URLs go through the same reader
 * registry (`intake/registry.ts`); each format's reader lives in `intake/`.
 */
export { isPublicSourceAddress, validatePublicHttpsSourceUrl } from './intake/fetch.js';
export { extractHtmlSource } from './intake/html.js';
export { docxXmlToMarkdown, docxXmlToSource, pptxSlideXmlToMarkdown, pptxSlideXmlToSource } from './intake/office.js';
export { pdfPagesToMarkdown, pdfPagesToSource } from './intake/pdfPoppler.js';
export { intakeWarningFailures, planSourceIntake, registerSourceExtractor } from './intake/registry.js';

/** Read a PDF, DOCX, PPTX, HTML, Markdown, text or JSON file into an evidence-addressable SourceDoc. */
export async function loadSourceDoc(path: string, plan?: IntakePlan): Promise<SourceDoc> {
  return runSourceIntake({ bytes: await readFile(path), name: path }, plan);
}

/** Read a public HTTPS URL (HTML, text, PDF, DOCX or PPTX) with DNS pinning and redirect revalidation. */
export async function loadSourceDocFromUrl(url: string): Promise<SourceDoc> {
  const fetched = await fetchPublicHttps(url, { accept: 'text/html,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  const name = new URL(fetched.finalUrl).pathname.split('/').filter(Boolean).at(-1) ?? new URL(fetched.finalUrl).hostname;
  return runSourceIntake({ bytes: fetched.bytes, name, url: fetched.finalUrl, contentType: fetched.contentType });
}
