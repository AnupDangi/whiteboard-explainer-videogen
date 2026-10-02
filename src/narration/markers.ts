import type { NarrationScene, RawMention, SpokenClaimSpan } from '../shared/types.js';

/** `[[id|spoken phrase]]` — id is a plain token, phrase is anything but `]]` or `|` (possibly empty; empties surface as an `empty-phrase` failure in resolveMentions, never as literal TTS text). */
const MARKER_RE = /\[\[([a-zA-Z0-9_.-]+)\|([^\]|]*)\]\]/g;

export interface ParsedMarkers {
  plainText: string;
  mentions: RawMention[];
}

/**
 * Strip `[[id|phrase]]` markers from raw scripted text, replacing each with
 * its spoken phrase, and record the phrase's character span in the resulting
 * PLAIN text (claude_pipeline.md §4: "Markers are stripped before TTS but
 * their character/word offsets are preserved").
 */
export function parseMarkers(rawText: string): ParsedMarkers {
  let plainText = '';
  let cursor = 0;
  const mentions: RawMention[] = [];
  MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_RE.exec(rawText))) {
    const [full, id, phrase] = match;
    plainText += rawText.slice(cursor, match.index);
    const plainStart = plainText.length;
    plainText += phrase;
    const plainEnd = plainText.length;
    mentions.push({ id, phrase, plainStart, plainEnd });
    cursor = match.index + full.length;
  }
  plainText += rawText.slice(cursor);
  return { plainText, mentions };
}

/** Claim offsets are always recomputed from the actual marker-stripped text. */
export function resolveClaimSpans(rawText: string, claims: ReadonlyArray<{ claimId: string; exactText: string }>): SpokenClaimSpan[] {
  const { plainText } = parseMarkers(rawText);
  return claims.map(({ claimId, exactText }) => {
    if (!exactText.trim()) throw new Error(`claim ${claimId} has empty exactText`);
    const plainStart = plainText.indexOf(exactText);
    if (plainStart < 0 || plainText.indexOf(exactText, plainStart + 1) >= 0) throw new Error(`claim ${claimId} exactText must occur exactly once in spoken text`);
    return { claimId, exactText, plainStart, plainEnd: plainStart + exactText.length };
  });
}

export function buildNarrationScene(sceneId: string, sectionId: string, rawText: string, claims?: ReadonlyArray<{ claimId: string; exactText: string }>): NarrationScene {
  const { plainText, mentions } = parseMarkers(rawText);
  return { sceneId, sectionId, rawText, plainText, mentions, ...(claims ? { claimSpans: resolveClaimSpans(rawText, claims) } : {}) };
}

const MARKER_GLOBAL = /\[\[([a-zA-Z0-9_.-]+)\|([^\]|]*)\]\]/g;
const CLAIM_MARKER_STOPWORDS = new Set(['this', 'that', 'with', 'from', 'into', 'over', 'than', 'then', 'them', 'they', 'their', 'what', 'when', 'which']);

/** Raw-text index of a plain-text offset, or -1 when the offset falls inside an existing marker's phrase. */
function plainToRaw(raw: string, plainPos: number): number {
  let delta = 0;
  for (const match of raw.matchAll(MARKER_GLOBAL)) {
    const plainStart = match.index! - delta;
    const plainEnd = plainStart + match[2]!.length;
    if (plainPos < plainStart) break;
    if (plainPos < plainEnd) return -1;
    delta += match[0].length - match[2]!.length;
  }
  return plainPos + delta;
}

/**
 * A claim is drawn while its sentence is spoken, so each claim sentence needs a marker of its own. When the writer left
 * one unmarked, wrap the first concept label (or a distinctive word of it) the sentence already says. The spoken words
 * never change; a sentence naming none of its concepts stays unmarked and is reported by the timeline gates.
 */
export function ensureClaimMarkers(rawText: string, claims: ReadonlyArray<{ claimId: string; exactText: string }>, labelsFor: (claimId: string) => string[], maxMarkers: number): string {
  let raw = rawText;
  for (const claim of claims) {
    // Each concept the claim sentence names gets its own marker (the board draws it when it is spoken); a concept the sentence
    // does not name stays unmarked. A concept already covered by a marker in the sentence is left alone.
    for (const label of labelsFor(claim.claimId).slice(0, 4)) {
      const parsed = parseMarkers(raw);
      if (parsed.mentions.length >= maxMarkers) return raw;
      let span: SpokenClaimSpan;
      try { span = resolveClaimSpans(raw, [claim])[0]!; } catch { break; }
      const sentence = parsed.plainText.slice(span.plainStart, span.plainEnd);
      const inSpan = parsed.mentions.filter((mention) => mention.plainStart >= span.plainStart && mention.plainStart < span.plainEnd);
      const words = label.split(/\s+/).filter((word) => word.length >= 4 && !CLAIM_MARKER_STOPWORDS.has(word.toLowerCase())).sort((a, b) => b.length - a.length);
      const needles = [label, ...words];
      if (inSpan.some((mention) => needles.some((needle) => mention.phrase.toLowerCase().includes(needle.toLowerCase())))) continue;
      const taken = new Set(parsed.mentions.map((mention) => mention.id));
      for (const needle of needles) {
        // Spaces and hyphens read alike ("sequence-transduction" names the concept "Sequence transduction").
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/(?:\\?[ -])+/g, '[\\s\\-]+');
        const hit = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').exec(sentence);
        if (!hit) continue;
        const at = span.plainStart + hit.index;
        // Never open a marker inside another marker's phrase.
        if (parsed.mentions.some((mention) => at < mention.plainEnd && at + hit[0].length > mention.plainStart)) continue;
        const rawStart = plainToRaw(raw, at);
        if (rawStart < 0) continue;
        const base = `${claim.claimId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'claim'}_ref`;
        let id = base;
        for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
        raw = `${raw.slice(0, rawStart)}[[${id}|${hit[0]}]]${raw.slice(rawStart + hit[0].length)}`;
        break;
      }
    }
  }
  return raw;
}

/**
 * Remove marker brackets that do not form a valid `[[id|phrase]]` (an unclosed `[[`, a stray `]]`, a nested opener).
 * Valid markers and every spoken word are kept, so a typo in the marker syntax cannot fail a whole scene.
 */
export function stripStrayMarkerBrackets(rawText: string): string {
  const valid: Array<[number, number]> = [];
  MARKER_GLOBAL.lastIndex = 0;
  for (const match of rawText.matchAll(MARKER_GLOBAL)) valid.push([match.index!, match.index! + match[0].length]);
  let out = '';
  for (let index = 0; index < rawText.length; index++) {
    const inside = valid.some(([start, end]) => index >= start && index < end);
    if (!inside && (rawText.startsWith('[[', index) || rawText.startsWith(']]', index))) { index += 1; continue; }
    out += rawText[index];
  }
  return out;
}
