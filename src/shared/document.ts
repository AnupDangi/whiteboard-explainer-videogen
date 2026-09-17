/** What document a lesson is teaching.
 *
 *  The semantic pipeline grounded its FACTS in the source - concepts, claims,
 *  evidence spans - but carried no idea of what the source IS. `TeachingInput`
 *  had `sourceText`, `sourceId` and `evidenceScope` and nothing else, so the
 *  board showed a scene the model invented ("The KV Cache Bottleneck") and never
 *  once named the paper. A teacher opens by saying what this is, who wrote it and
 *  what it argues; the pipeline had nowhere to put that.
 *
 *  This derives the identity the teaching prompt needs. It is deliberately
 *  conservative: an explicit title always wins, then a markdown heading, then a
 *  short leading line, then the source id. Nothing here invents a title that the
 *  document does not support. */

export type DocumentKind = 'paper' | 'report' | 'book' | 'article' | 'document';

export interface DocumentIdentity {
  /** Human-readable title as the document states it, or a derived fallback. */
  title: string;
  /** Named authors, when the document states them. Never guessed. */
  authors: string[];
  kind: DocumentKind;
  /** Where the title came from, so a wrong title is diagnosable. */
  titleSource: 'explicit' | 'markdown-heading' | 'leading-line' | 'source-id';
}

const TITLE_MAX = 160;

/** Strip markdown emphasis, links and trailing punctuation from a title line. */
function cleanTitle(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.:;,]\s*$/, '')
    .trim()
    .slice(0, TITLE_MAX);
}

/** Title-case an id like `deepseek_v41_tech_report` without guessing words. */
function titleFromId(sourceId: string): string {
  return cleanTitle(
    sourceId
      .replace(/^src_/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
  );
}

/** Lines that are never a title: blank, a date, a page marker, a bare number. */
function looksLikeNoise(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 6) return true;
  if (/^\d{1,4}$/.test(trimmed)) return true;
  if (/^[A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}$/.test(trimmed)) return true; // "Jan 27th, 2026"
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return true;
  if (/^arxiv:/i.test(trimmed)) return true;
  if (/^page\s+\d+/i.test(trimmed)) return true;
  return false;
}

/** A person's name list. Distinct from a title because it is short, has no verb
 *  and is usually 2-5 comma- or "and"-separated capitalised tokens. */
function looksLikeAuthors(line: string): boolean {
  const trimmed = cleanTitle(line);
  if (!trimmed || trimmed.length > 120) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  const parts = trimmed.split(/,| and /i).map(part => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 12) return false;
  return parts.every(part => /^[A-Z][\p{L}'.\- ]+$/u.test(part) && part.split(/\s+/).length <= 5);
}

/** `By A. Author, B. Author` / `Authors: A, B` / `A. Author and B. Author`. */
function authorsFrom(text: string): string[] {
  const labelled = text.match(/^\s*(?:\*{0,2})(?:by|authors?)\s*[:\-]\s*(.{2,200})$/im);
  if (labelled) {
    const names = labelled[1].split(/,| and /i).map(name => cleanTitle(name)).filter(name => name.length > 1 && name.length < 80);
    if (names.length) return names.slice(0, 12);
  }
  /** The line immediately after the title, when it reads as a name list. The
   *  "llms-cant-jump" source is exactly `LLMs can't jump` / `Tom Zahavy, Google DeepMind`. */
  const lines = text.split('\n').map(line => line.trim());
  const titleIndex = lines.findIndex(line => !looksLikeNoise(line));
  for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 4); index++) {
    const candidate = lines[index];
    if (!candidate) continue;
    if (looksLikeAuthors(candidate)) return candidate.split(/,| and /i).map(name => cleanTitle(name)).filter(Boolean).slice(0, 12);
    break;
  }
  return [];
}

function kindFrom(text: string, explicit?: DocumentKind): DocumentKind {
  if (explicit) return explicit;
  if (/arxiv|abstract|we (?:propose|present|introduce|argue)|this (?:paper|position paper)/i.test(text)) return 'paper';
  if (/technical report|research@|benchmark|model card/i.test(text)) return 'report';
  /** A single "chapter" heading is a section name; a book has several. The MLA
   *  fixture says "organized into three chapters" and was mislabelled as a book. */
  if ((text.match(/^#{1,6}\s+chapter\b/gim) ?? []).length >= 2) return 'book';
  return 'document';
}

export function documentIdentity(options: {
  text?: string;
  sourceId?: string;
  title?: string;
  authors?: string[];
  kind?: DocumentKind;
}): DocumentIdentity | undefined {
  const text = options.text ?? '';
  const lines = text.split('\n');
  const head = lines.slice(0, 40).join('\n');

  let title = options.title?.trim();
  let titleSource: DocumentIdentity['titleSource'] = 'explicit';

  if (!title) {
    const heading = lines.find(line => /^#{1,6}\s+\S/.test(line));
    if (heading) {
      title = cleanTitle(heading);
      titleSource = 'markdown-heading';
    }
  }

  if (!title) {
    /** A title is the first line that is not noise, does not read as prose, and
     *  is not itself a name list. A line ending in a colon continues onto the
     *  next line: the DeepSeek report is `DeepSeek-V4.1-Flash:` / `Pushing the
     *  Limits of KV Cache Compression` across two lines. Measured failure the
     *  first time: the "llms-cant-jump" source opens with the date `Jan 27th,
     *  2026`, which was taken for the title and appeared on the board. */
    const raw = lines.map(line => line.trim());
    for (let index = 0; index < Math.min(raw.length, 40); index++) {
      const line = raw[index];
      if (looksLikeNoise(line)) continue;
      const candidate = cleanTitle(line);
      if (!candidate || candidate.length > 110) continue;
      if (/[.!?]$/.test(line) && candidate.split(/\s+/).length > 8) continue;
      if (looksLikeAuthors(line)) continue;
      /** A title continues when this line ends in a colon, or when the next
       *  non-empty line starts lower-case: the arXiv fixture is `Dream-RSI:
       *  Recursive Self-Improvement` / `through Evolving Worlds`. */
      const nextRaw = raw.slice(index + 1).find(entry => entry.trim()) ?? '';
      const continues = /:$/.test(line) || (/^[a-z]/.test(nextRaw.trim()) && nextRaw.trim().length < 90);
      const next = continues ? cleanTitle(nextRaw) : '';
      const needsColon = /:$/.test(line);
      title = continues && next
        ? (needsColon ? `${candidate}: ${next.replace(/^:\s*/, '')}` : `${candidate} ${next}`)
        : candidate;
      titleSource = 'leading-line';
      break;
    }
  }

  if (!title && options.sourceId) {
    title = titleFromId(options.sourceId);
    titleSource = 'source-id';
  }

  if (!title) return undefined;

  return {
    title,
    authors: options.authors ?? authorsFrom(head),
    kind: kindFrom(text, options.kind),
    titleSource,
  };
}
