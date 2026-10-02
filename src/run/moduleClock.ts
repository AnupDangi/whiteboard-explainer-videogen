/** Keep every narrated scene on the module clock, including scenes without a visual board. */
export function buildModuleSceneClock(
  sceneIds: string[],
  sceneDurationMsById: ReadonlyMap<string, number>,
  sceneGapMs: number,
  boundarySilenceMs: number,
): { intervals: Array<{ sceneId: string; startMs: number; endMs: number }>; durationMs: number } {
  if (!sceneIds.length) throw new Error('Module has no narrated scenes');
  let cursorMs = 0;
  const intervals = sceneIds.map((sceneId, index) => {
    const durationMs = sceneDurationMsById.get(sceneId);
    if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error(`Missing narrated audio duration for ${sceneId}`);
    const interval = { sceneId, startMs: cursorMs, endMs: cursorMs + durationMs };
    cursorMs = interval.endMs + (index < sceneIds.length - 1 ? sceneGapMs : 0);
    return interval;
  });
  return { intervals, durationMs: cursorMs + boundarySilenceMs };
}
