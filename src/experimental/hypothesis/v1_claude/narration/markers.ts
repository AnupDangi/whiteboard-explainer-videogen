import type { NarrationScene, RawMention } from '../types.js';

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

export function buildNarrationScene(sceneId: string, sectionId: string, rawText: string): NarrationScene {
  const { plainText, mentions } = parseMarkers(rawText);
  return { sceneId, sectionId, rawText, plainText, mentions };
}
