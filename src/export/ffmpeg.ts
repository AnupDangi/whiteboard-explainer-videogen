import { spawn } from 'node:child_process';

/** Thin promise wrapper around a system `ffmpeg` invocation (v9.0.1 confirmed present as of 2026-09-22). Throws with the captured stderr tail on any non-zero exit. */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', (d) => {
      stderr += String(d);
    });
    ff.on('error', (error) => reject(new Error(`ffmpeg failed to start: ${error.message}`)));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-4000)}`))));
  });
}

/** Read the actual muxed file duration used later for chapter offsets. */
export function probeMediaDurationMs(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    probe.stdout.on('data', (data) => { stdout += String(data); });
    probe.stderr.on('data', (data) => { stderr += String(data); });
    probe.on('error', (error) => reject(new Error(`ffprobe failed to start: ${error.message}`)));
    probe.on('close', (code) => {
      const seconds = Number(stdout.trim());
      if (code !== 0 || !Number.isFinite(seconds) || seconds <= 0) return reject(new Error(`ffprobe could not read media duration: ${stderr.slice(-2000)}`));
      resolve(Math.round(seconds * 1000));
    });
  });
}

/**
 * Spawn ffmpeg reading raw PNG frames from stdin (`image2pipe`) at `fps`,
 * muxing in the real audio track at `audioWavPath`, encoding H.264+AAC.
 * Caller writes each frame's PNG bytes via `write()` then calls `end()`.
 */
export function spawnFrameEncoder(outPath: string, fps: number, audioWavPath: string) {
  const args = [
    '-y',
    // Deterministic output: no muxer timestamps/metadata in the file, so the
    // same frames + audio encode byte-identically on the same toolchain.
    // (-fflags is an input flag; the bitexact/map_metadata output options
    // must sit after the inputs, beside the other codec options.)
    '-fflags', '+bitexact',
    '-f', 'image2pipe',
    '-framerate', String(fps),
    '-i', '-',
    '-i', audioWavPath,
    '-flags:v', '+bitexact',
    '-flags:a', '+bitexact',
    '-map_metadata', '-1',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '20',
    '-c:a', 'aac',
    '-shortest',
    outPath,
  ];
  return spawnPipedEncoder(args);
}

function spawnPipedEncoder(args: string[]) {
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  ff.stderr.on('data', (d) => {
    stderr += String(d);
  });
  const done = new Promise<void>((resolve, reject) => {
    ff.on('error', (error) => reject(new Error(`ffmpeg failed to start: ${error.message}`)));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-4000)}`))));
  });

  async function write(chunk: Buffer): Promise<void> {
    const ok = ff.stdin.write(chunk);
    if (!ok) await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        ff.stdin.off('drain', onDrain);
        ff.stdin.off('error', onError);
        ff.stdin.off('close', onClose);
      };
      const onDrain = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(new Error(`ffmpeg input pipe failed: ${error.message}`)); };
      const onClose = () => { cleanup(); reject(new Error('ffmpeg input pipe closed before frame write drained')); };
      ff.stdin.once('drain', onDrain);
      ff.stdin.once('error', onError);
      ff.stdin.once('close', onClose);
    });
  }

  function end(): void {
    ff.stdin.end();
  }

  function abort(): void {
    ff.stdin.destroy();
    ff.kill('SIGKILL');
  }

  return { write, end, abort, done, args };
}

/**
 * Spawn ffmpeg reading raw PNG frames from stdin and writing a silent H.264 clip. Per-scene clips carry no audio: AAC priming
 * would leave a gap at every join, so the master audio is muxed once when the clips are concatenated.
 */
export function spawnClipEncoder(outPath: string, fps: number) {
  const args = ['-y', '-fflags', '+bitexact', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-flags:v', '+bitexact', '-map_metadata', '-1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-g', String(Math.max(1, fps * 2)), outPath];
  return spawnPipedEncoder(args);
}

/** Join silent clips in order without re-encoding the video, and mux the one master audio track. */
export function concatClips(listPath: string, audioWavPath: string, outPath: string): Promise<void> {
  return runFfmpeg(['-y', '-fflags', '+bitexact', '-f', 'concat', '-safe', '0', '-i', listPath, '-i', audioWavPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-flags:a', '+bitexact', '-map_metadata', '-1', '-shortest', outPath]);
}
