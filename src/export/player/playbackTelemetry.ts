/** Browser-reported playback is a player-boundary measurement, not proof of sound at a speaker. */
export const FIRST_AUDIO_PLAYBACK_VERSION = 'hypothesis-first-audio-playback/v2' as const;

export interface InitialPlaybackIdentity {
  sceneId: string;
  frame: 0;
  frameHash: string;
  sceneAudioHash: string;
}

export interface PlaybackTelemetrySession {
  schemaVersion: typeof FIRST_AUDIO_PLAYBACK_VERSION;
  runId: string;
  sessionId: string;
  eventUrl: '/telemetry/first-audio-playback';
  requestAcceptedAtEpochMs?: number;
  issuedAudioUrl: string;
  initial: InitialPlaybackIdentity;
}

export interface FirstAudioPlaybackEvent {
  schemaVersion: typeof FIRST_AUDIO_PLAYBACK_VERSION;
  type: 'player.first-audio-playback';
  eventId: string;
  runId: string;
  sessionId: string;
  measurementSource: 'browser-player';
  requestAcceptedAtEpochMs: number | null;
  browserTimeOriginMs: number;
  playerLoadedMonoMs: number;
  firstFrameReadyMonoMs: number;
  userPlayMonoMs: number;
  playerStartMonoMs: number;
  firstAudioPlaybackMonoMs: number;
  readyToUserPlayMs: number;
  userPlayToPlayerStartMs: number;
  playerStartToFirstAudioMs: number;
  userPlayToFirstAudioMs: number;
  playerLoadToFirstAudioMs: number;
  requestToFirstAudioMs: number | null;
  audioCurrentTimeSec: number;
  audioUrl: string;
  observedFrame: number;
  observedFrameHash: string;
  initial: InitialPlaybackIdentity;
}

export interface PlaybackGateSample {
  userInitiated: boolean;
  playing: boolean;
  audioPaused: boolean;
  audioMuted: boolean;
  audioVolume: number;
  previousAudioTimeSec: number;
  audioTimeSec: number;
  displayedFrameHash: string | undefined;
  expectedFrameHash: string;
  displayedFrame: number;
  currentSceneId: string;
  initial: InitialPlaybackIdentity;
  currentAudioUrl: string;
}

/** Require the initial verified visual and advancing, unmuted media clock after a user play action. */
export function qualifiesFirstAudioPlayback(sample: PlaybackGateSample): boolean {
  return sample.userInitiated && sample.playing && !sample.audioPaused && !sample.audioMuted
    && Number.isFinite(sample.audioVolume) && sample.audioVolume > 0
    && Number.isFinite(sample.previousAudioTimeSec) && Number.isFinite(sample.audioTimeSec)
    && sample.audioTimeSec > sample.previousAudioTimeSec && sample.audioTimeSec > 0
    && Number.isSafeInteger(sample.displayedFrame) && sample.displayedFrame >= 0 && sample.currentSceneId === sample.initial.sceneId
    && sample.displayedFrameHash === sample.expectedFrameHash
    && sample.currentAudioUrl.startsWith('/locked/');
}

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_-]{1,120}$/;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function isFirstAudioPlaybackEvent(value: unknown): value is FirstAudioPlaybackEvent {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const initial = item.initial as Record<string, unknown> | undefined;
  if (item.schemaVersion !== FIRST_AUDIO_PLAYBACK_VERSION || item.type !== 'player.first-audio-playback'
    || item.measurementSource !== 'browser-player' || !ID.test(String(item.runId)) || !ID.test(String(item.sessionId))
    || item.eventId !== `${item.sessionId}:first-audio-playback/v2` || !initial
    || !ID.test(String(initial.sceneId)) || initial.frame !== 0 || !HASH.test(String(initial.frameHash))
    || !HASH.test(String(initial.sceneAudioHash)) || typeof item.audioUrl !== 'string' || !item.audioUrl.startsWith('/locked/')
    || !Number.isSafeInteger(item.observedFrame) || (item.observedFrame as number) < 0 || !HASH.test(String(item.observedFrameHash))) return false;
  for (const field of ['browserTimeOriginMs', 'playerLoadedMonoMs', 'firstFrameReadyMonoMs', 'userPlayMonoMs', 'playerStartMonoMs', 'firstAudioPlaybackMonoMs', 'readyToUserPlayMs', 'userPlayToPlayerStartMs', 'playerStartToFirstAudioMs', 'userPlayToFirstAudioMs', 'playerLoadToFirstAudioMs', 'audioCurrentTimeSec']) {
    if (!nonnegative(item[field])) return false;
  }
  const loaded = item.playerLoadedMonoMs as number;
  const ready = item.firstFrameReadyMonoMs as number;
  const clicked = item.userPlayMonoMs as number;
  const started = item.playerStartMonoMs as number;
  const played = item.firstAudioPlaybackMonoMs as number;
  const requestAcceptedAt = item.requestAcceptedAtEpochMs;
  const requestToFirstAudio = item.requestToFirstAudioMs;
  const tolerance = 0.01;
  const requestElapsed = requestAcceptedAt === null ? undefined : (item.browserTimeOriginMs as number) + played - (requestAcceptedAt as number);
  const requestTimingValid = requestAcceptedAt === null
    ? requestToFirstAudio === null
    : nonnegative(requestAcceptedAt) && (requestElapsed! < 0
      ? requestToFirstAudio === null
      : nonnegative(requestToFirstAudio) && Math.abs(requestElapsed! - (requestToFirstAudio as number)) <= 2);
  return requestTimingValid && loaded <= ready && ready <= clicked && clicked <= started && started < played
    && Math.abs((clicked - ready) - (item.readyToUserPlayMs as number)) <= tolerance
    && Math.abs((started - clicked) - (item.userPlayToPlayerStartMs as number)) <= tolerance
    && Math.abs((played - started) - (item.playerStartToFirstAudioMs as number)) <= tolerance
    && Math.abs((played - clicked) - (item.userPlayToFirstAudioMs as number)) <= tolerance
    && Math.abs((played - loaded) - (item.playerLoadToFirstAudioMs as number)) <= tolerance;
}
