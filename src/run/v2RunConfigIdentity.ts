export interface SpeechModelSelection {
  model: string;
  voice: string;
  /** Per-request and per-scene output provenance; it is not a configuration choice. */
  sceneId?: string;
  capabilitySnapshotId?: string | null;
}

/**
 * Return the distinct effective speech profiles for a run. Per-scene assignments,
 * request snapshot IDs, and repetition counts remain in run provenance, not in
 * the configuration identity shared across benchmark cases.
 */
export function effectiveSpeechProfiles(selections: readonly SpeechModelSelection[]): Array<{ model: string; voice: string }> {
  const profiles = new Map<string, { model: string; voice: string }>();
  for (const { model, voice } of selections) {
    const profile = { model, voice };
    profiles.set(JSON.stringify(profile), profile);
  }
  return [...profiles.values()].sort((a, b) => a.model.localeCompare(b.model) || a.voice.localeCompare(b.voice));
}
