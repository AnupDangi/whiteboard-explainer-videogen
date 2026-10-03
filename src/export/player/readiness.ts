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

/**
 * A running V2 session adopts a newer server view only when it extends what is already playing (more verified frames), or when the
 * finished lock replaces the live prefix. A shorter or equal view is ignored so a transient server state can never rewind playback.
 */
export function shouldAdoptLockedUpdate(current: { frames: number; live?: boolean }, latest: { frames: number; live?: boolean } | undefined): boolean {
  if (!latest) return false;
  if (current.live && !latest.live) return latest.frames >= current.frames;
  return latest.frames > current.frames;
}
