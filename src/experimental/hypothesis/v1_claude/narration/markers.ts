import type { NarrationScene, RawMention, SpokenClaimSpan } from '../types.js';

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
