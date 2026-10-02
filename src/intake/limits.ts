import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Intake limits shared by every extractor and the URL fetcher. */
export const INTAKE_LIMITS = {
  maxSourceBytes: 50 * 1024 * 1024,
  maxTextChars: 5_000_000,
  minTextChars: 20,
  /** A page with less extractable text than this is reported as `page-without-text`. */
  minPageTextChars: 20,
  maxFigures: 100,
  maxFigureBytes: 250 * 1024 * 1024,
  maxHtmlFigures: 20,
  maxHtmlFigureBytes: 100 * 1024 * 1024,
  maxSlides: 500,
  urlIdleTimeoutMs: 60_000,
  urlTotalDeadlineMs: 180_000,
  urlMaxRedirects: 3,
  toolTimeoutMs: 60_000,
} as const;

export const execTool = promisify(execFile);

/** True when `bin` runs; used by extractors to report a missing dependency by name. */
export async function toolAvailable(bin: string, probeArgs: string[] = ['-v']): Promise<boolean> {
  try {
    await execTool(bin, probeArgs, { timeout: 10_000 });
    return true;
  } catch (error) {
    // Several poppler tools print their version and exit non-zero; only a missing binary is "unavailable".
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}
