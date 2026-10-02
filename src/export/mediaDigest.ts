import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

/**
 * Decoded-media digests. Container bytes can differ for harmless reasons, so equality is judged on what a player would show
 * and play: a SHA-256 of every decoded video frame and of the decoded audio samples.
 */
export interface MediaDigest { videoFrames: number; video: string; audio: string }

function ffmpegText(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-v', 'error', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    ff.stdout.on('data', (d) => { out += String(d); });
    ff.stderr.on('data', (d) => { err += String(d); });
    ff.on('error', (error) => reject(new Error(`ffmpeg failed to start: ${error.message}`)));
    ff.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-2000)}`))));
  });
}

/** Per-frame hashes folded into one digest, plus the frame count; and the audio stream hash. */
export async function decodedMediaDigest(file: string): Promise<MediaDigest> {
  const frames = (await ffmpegText(['-i', file, '-map', '0:v:0', '-f', 'framehash', '-hash', 'sha256', '-'])).split('\n').filter((line) => line && !line.startsWith('#'));
  const hashes = frames.map((line) => line.split(',').map((part) => part.trim()).pop()!);
  const audioLine = (await ffmpegText(['-i', file, '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-'])).trim();
  const audio = /SHA256=([0-9a-f]{64})/i.exec(audioLine)?.[1];
  if (!audio || hashes.length === 0) throw new Error(`could not digest decoded media of ${file}`);
  return { videoFrames: hashes.length, video: createHash('sha256').update(hashes.join('\n')).digest('hex'), audio };
}

export function mediaDigestsMatch(a: MediaDigest, b: MediaDigest): string[] {
  const problems: string[] = [];
  if (a.videoFrames !== b.videoFrames) problems.push(`frame count ${a.videoFrames} vs ${b.videoFrames}`);
  if (a.video !== b.video) problems.push('decoded video frames differ');
  if (a.audio !== b.audio) problems.push('decoded audio samples differ');
  return problems;
}
