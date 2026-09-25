import { spawn } from 'node:child_process';

/** Thin promise wrapper around a system `ffmpeg` invocation (v9.0.1 confirmed present, per docs/PIPELINE-AUDIT.md). Throws with the captured stderr tail on any non-zero exit. */
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

/**
 * Spawn ffmpeg reading raw PNG frames from stdin (`image2pipe`) at `fps`,
 * muxing in the real audio track at `audioWavPath`, encoding H.264+AAC.
 * Caller writes each frame's PNG bytes via `write()` then calls `end()`.
 */
export function spawnFrameEncoder(outPath: string, fps: number, audioWavPath: string) {
  const args = [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(fps),
    '-i', '-',
    '-i', audioWavPath,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '20',
    '-c:a', 'aac',
    '-shortest',
    outPath,
  ];
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
