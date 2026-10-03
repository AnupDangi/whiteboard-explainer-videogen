/**
 * Pure WAV helpers for the live (still-growing) V2 preview: each ready scene's speech is padded with silence to its
 * placement on the master clock and the scenes are joined in order, so the browser plays exactly the audio the final
 * master will contain for that prefix. PCM 16-bit only; anything else fails closed rather than guessing.
 */
export interface PcmWav { sampleRate: number; channels: number; data: Buffer }

export function parsePcmWav(bytes: Buffer): PcmWav {
  if (bytes.length < 44 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let offset = 12; let format: { channels: number; sampleRate: number } | undefined;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || bytes.readUInt16LE(body) !== 1 || bytes.readUInt16LE(body + 14) !== 16) throw new Error('only 16-bit PCM WAV is supported');
      format = { channels: bytes.readUInt16LE(body + 2), sampleRate: bytes.readUInt32LE(body + 4) };
    } else if (id === 'data') {
      if (!format || format.channels < 1 || format.sampleRate < 1) throw new Error('WAV data precedes a valid fmt chunk');
      // A streamed WAV may declare a size larger than what is present; trust the bytes that exist.
      const end = Math.min(bytes.length, body + size);
      return { ...format, data: bytes.subarray(body, end - ((end - body) % (2 * format.channels))) };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

export function buildPcmWav(sampleRate: number, channels: number, data: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Join scene speech in order, each padded with silence to its placement length. */
export function joinPaddedScenes(scenes: ReadonlyArray<{ wav: Buffer; placementMs: number }>): Buffer {
  if (!scenes.length) throw new Error('no scenes to join');
  let format: { sampleRate: number; channels: number } | undefined;
  const parts: Buffer[] = [];
  for (const { wav, placementMs } of scenes) {
    const parsed = parsePcmWav(wav);
    if (format && (format.sampleRate !== parsed.sampleRate || format.channels !== parsed.channels)) throw new Error('scene audio formats differ');
    format = { sampleRate: parsed.sampleRate, channels: parsed.channels };
    const frameBytes = 2 * parsed.channels;
    const wantedFrames = Math.round(placementMs * parsed.sampleRate / 1000);
    const haveFrames = parsed.data.length / frameBytes;
    if (haveFrames > wantedFrames + 1) throw new Error('scene audio is longer than its placement');
    parts.push(parsed.data, Buffer.alloc(Math.max(0, wantedFrames - haveFrames) * frameBytes));
  }
  return buildPcmWav(format!.sampleRate, format!.channels, Buffer.concat(parts));
}
