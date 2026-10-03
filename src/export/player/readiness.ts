/** Pure helpers for ready-prefix playback of immutable, frame-hash-addressed media. */
export function readyFramePrefixLength(frameCount: number, isReady: (frame: number) => boolean): number {
  let frame = 0;
  while (frame < frameCount && isReady(frame)) frame++;
  return frame;
}

export function readyPrefixEndMs(frameCount: number, fps: number, durationMs: number): number {
  if (!Number.isSafeInteger(frameCount) || frameCount < 0 || !Number.isFinite(fps) || fps <= 0 || !Number.isFinite(durationMs) || durationMs < 0) return 0;
  return Math.min(durationMs, frameCount * 1000 / fps);
}

/** Clamp a seek to a frame that is inside the contiguous verified prefix. */
export function clampSeekToReadyPrefix(requestedMs: number, readyFrames: number, fps: number, durationMs: number): number {
  if (!Number.isFinite(requestedMs) || readyFrames <= 0 || fps <= 0 || durationMs <= 0) return 0;
  const latestReadyFrameTime = Math.max(0, (readyFrames - 1) * 1000 / fps);
  return Math.max(0, Math.min(requestedMs, durationMs, latestReadyFrameTime));
}
