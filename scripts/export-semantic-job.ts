/** Export a semantic V2 job to a single narrated MP4.
 *
 *  Usage: node dist/scripts/export-semantic-job.js --job <uuid> --out <file.mp4> [--fps 12]
 *
 *  Reads .data/semantic/<job>/job.json + per-scene <sceneId>.json (CompiledSceneV2)
 *  and audio files, renders each scene through the canonical renderer, muxes its
 *  narration, then concatenates all scenes into one MP4.
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { renderSVG } from '../src/semantic/renderer/render-svg.js';
import type { CompiledSceneV2 } from '../src/semantic/types.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.findIndex(a => a === `--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const jobId = flag('job');
const out = flag('out');
const fps = Number(flag('fps') ?? '12');
const dataRoot = flag('data-root') ?? join(process.cwd(), '.data', 'semantic');
if (!jobId || !/^[a-f0-9-]{36}$/.test(jobId)) throw new Error('Missing --job <uuid>');
if (!out) throw new Error('Missing --out <file.mp4>');
if (!Number.isFinite(fps) || fps < 1 || fps > 30) throw new Error('fps must be 1–30');

const jobDir = join(dataRoot, jobId);
const job = JSON.parse(await readFile(join(jobDir, 'job.json'), 'utf8'));
if (!['complete', 'partial'].includes(job.status)) throw new Error(`Job ${jobId} is ${job.status}; only complete/partial jobs export`);
if (!job.scenes?.length) throw new Error(`Job ${jobId} has no scenes`);

const sharp = (await import('sharp')).default;
const workDir = join(tmpdir(), `sem-export-${jobId}-${Date.now()}`);
await mkdir(workDir, { recursive: true });
const segments: string[] = [];

try {
  for (const [i, snap] of job.scenes.entries()) {
    const scene = JSON.parse(await readFile(join(jobDir, `${snap.id}.json`), 'utf8')) as CompiledSceneV2;
    const seg = join(workDir, `seg-${i}.mp4`);
    const encoder = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', seg], { stdio: ['pipe', 'inherit', 'inherit'] });
    let failure: Error | undefined;
    encoder.on('error', e => { failure = e; });
    encoder.stdin.on('error', e => { failure = e as Error; });
    const completion = new Promise<void>((resolve, reject) => {
      encoder.on('error', reject);
      encoder.on('close', code => (code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}`))));
    });
    const frames = Math.max(1, Math.ceil((scene.durationMs * fps) / 1000));
    for (let f = 0; f < frames; f++) {
      if (failure) throw failure;
      const png = await sharp(Buffer.from(renderSVG(scene, (f * 1000) / fps, { cursor: true }))).resize(1280, 720).png().toBuffer();
      if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
    }
    encoder.stdin.end();
    await completion;
    // Mux this scene's narration if present.
    const audioName = snap.audioUrl ? String(snap.audioUrl).split('/').pop()! : null;
    let segOut = seg;
    if (audioName) {
      await readFile(join(jobDir, audioName)).catch(() => { throw new Error(`Narration file missing for scene ${snap.id}: ${audioName}`); });
      segOut = join(workDir, `seg-${i}-a.mp4`);
      await new Promise<void>((resolve, reject) => {
        const mux = spawn('ffmpeg', ['-y', '-v', 'error', '-i', seg, '-i', join(jobDir, audioName), '-map', '0:v', '-map', '1:a', '-af', 'apad', '-t', String(scene.durationMs / 1000), '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', segOut], { stdio: 'inherit' });
        mux.on('error', e => reject(new Error(`Audio mux failed for scene ${snap.id}: ${e instanceof Error ? e.message : String(e)}`)));
        mux.on('close', code => (code === 0 ? resolve() : reject(new Error(`Audio mux exited ${code} for scene ${snap.id}`))));
      });
    }
    segments.push(segOut);
    console.log(`segment ${i + 1}/${job.scenes.length}: ${snap.id} ${scene.durationMs}ms${segOut !== seg ? ' +audio' : ' silent'}`);
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(join(workDir, 'list.txt'), segments.map(s => `file '${s}'`).join('\n'));
  await new Promise<void>((resolve, reject) => {
    const cat = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(workDir, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' });
    cat.on('error', reject);
    cat.on('close', code => (code === 0 ? resolve() : reject(new Error(`Concat exited ${code}`))));
  });
  console.log(JSON.stringify({ out, segments: segments.length, job: jobId }));
} finally {
  await rm(workDir, { recursive: true, force: true });
}
