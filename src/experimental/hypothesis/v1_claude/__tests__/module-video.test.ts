import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildAssemblyFfmpegArgs, buildChapterMetadata, buildModuleConcatList, combineModuleCaptions, encodeModuleVideos, type ModuleVideoInput } from '../export/moduleVideo.js';

test('module video exports resume only when both clip and content manifest verify', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-module-video-'));
  try {
    const audioPath = path.join(dir, 'module.wav');
    await writeFile(audioPath, Buffer.from('synthetic audio bytes'));
    const module: ModuleVideoInput = {
      id: 'module_1', title: 'Mechanism = cause', scenes: [{ laidOut: {} as never, timeline: {} as never, startMs: 0, endMs: 1000 }], durationMs: 1000, audioPath,
    };
    let encodes = 0;
    const encode = async (_scenes: ModuleVideoInput['scenes'], _duration: number, _audio: string, outputPath: string) => {
      encodes++;
      await writeFile(outputPath, `clip-${encodes}`);
      return { frames: 30, ffmpegArgs: [] };
    };
    const options = { encode, probeDuration: async () => 1000 };
    const first = await encodeModuleVideos([module], dir, options);
    const resumed = await encodeModuleVideos([module], dir, options);
    assert.equal(encodes, 1);
    assert.equal(first[0]!.cacheHit, false);
    assert.equal(resumed[0]!.cacheHit, true);
    assert.equal(resumed[0]!.contentHash, first[0]!.contentHash);

    await writeFile(first[0]!.path, 'damaged clip');
    const repaired = await encodeModuleVideos([module], dir, options);
    assert.equal(encodes, 2, 'a corrupt clip must be regenerated');
    assert.equal(repaired[0]!.cacheHit, false);
    assert.equal(await readFile(repaired[0]!.path, 'utf8'), 'clip-2');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('module chapter metadata follows ordered durations and escapes ffmetadata delimiters', () => {
  const result = buildChapterMetadata([
    { moduleId: 'm1', title: 'First = step', durationMs: 1500.4 },
    { moduleId: 'm2', title: 'Second; step', durationMs: 2500 },
  ]);
  assert.deepEqual(result.chapters, [
    { id: 'm1', title: 'First = step', startMs: 0, endMs: 1500 },
    { id: 'm2', title: 'Second; step', startMs: 1500, endMs: 4000 },
  ]);
  assert.match(result.text, /title=First \\= step/);
  assert.match(result.text, /title=Second\\; step/);
  assert.throws(() => buildChapterMetadata([{ moduleId: 'bad', title: 'x', durationMs: 0 }]), /invalid duration/);
});

test('module concat list resolves generated clip paths absolutely when output directory is relative', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-module-relative-'));
  try {
    const audioPath = path.join(dir, 'module.wav');
    await writeFile(audioPath, Buffer.from('synthetic audio bytes'));
    const relativeOutputDir = path.relative(process.cwd(), path.join(dir, 'module-clips'));
    const [artifact] = await encodeModuleVideos([{
      id: 'relative_module', title: 'Relative output', scenes: [{ laidOut: {} as never, timeline: {} as never, startMs: 0, endMs: 1000 }], durationMs: 1000, audioPath,
    }], relativeOutputDir, {
      encode: async (_scenes, _duration, _audio, outputPath) => {
        await writeFile(outputPath, 'clip-bytes');
        return { frames: 30, ffmpegArgs: [] };
      },
      probeDuration: async () => 1000,
    });
    assert.ok(artifact);
    assert.equal(path.isAbsolute(artifact.path), false, 'the generated artifact path reproduces the relative-output condition');
    assert.equal(buildModuleConcatList([artifact]), `file '${path.resolve(artifact.path)}'\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('MP4 assembly keeps copied video/audio while selecting mov_text for the subtitle stream', () => {
  const args = buildAssemblyFfmpegArgs('concat.txt', 'chapters.ffmeta', 'captions.vtt', 'lesson.partial.mp4');
  const copyIndex = args.indexOf('-c');
  const subtitleCodecIndex = args.indexOf('-c:s');
  assert.ok(copyIndex >= 0 && subtitleCodecIndex > copyIndex);
  assert.equal(args[copyIndex + 1], 'copy');
  assert.equal(args[subtitleCodecIndex + 1], 'mov_text');
  const captionlessArgs = buildAssemblyFfmpegArgs('concat.txt', 'chapters.ffmeta', undefined, 'diagnostic.partial.mp4');
  assert.ok(captionlessArgs.includes('-map') && captionlessArgs.includes('0'), 'captionless diagnostics still mux the module video/audio streams');
  assert.ok(!captionlessArgs.includes('2:0') && !captionlessArgs.includes('-c:s'), 'no invalid subtitle stream is synthesized');
});

test('module captions shift onto the assembled clock and validate cue intervals', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-module-captions-'));
  try {
    const first = path.join(dir, 'first.vtt');
    const second = path.join(dir, 'second.vtt');
    await writeFile(first, 'WEBVTT\n\n00:00:00.100 --> 00:00:00.800\nfirst\n');
    await writeFile(second, 'WEBVTT\n\n00:00:00.000 --> 00:00:00.500\nsecond\n');
    const combined = await combineModuleCaptions([
      { moduleId: 'm1', durationMs: 1000, captionsPath: first },
      { moduleId: 'm2', durationMs: 2000, captionsPath: second },
    ]);
    assert.match(combined!, /00:00:00\.100 --> 00:00:00\.800/);
    assert.match(combined!, /00:00:01\.000 --> 00:00:01\.500/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('module encodes share the host raster permit across concurrent callers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-module-pool-'));
  try {
    const audioPath = path.join(dir, 'module.wav');
    await writeFile(audioPath, Buffer.from('audio'));
    let active = 0;
    let maximum = 0;
    const encode = async (_scenes: ModuleVideoInput['scenes'], _duration: number, _audio: string, outputPath: string) => {
      active++;
      maximum = Math.max(maximum, active);
      await delay(25);
      await writeFile(outputPath, 'clip');
      active--;
      return { frames: 1, ffmpegArgs: [] };
    };
    await Promise.all(Array.from({ length: 5 }, (_, index) => encodeModuleVideos([{
      id: `module_${index}`, title: `Module ${index}`, scenes: [{ laidOut: {} as never, timeline: {} as never, startMs: 0, endMs: 1000 }], durationMs: 1000, audioPath,
    }], dir, { encode, probeDuration: async () => 1000, rasterLimit: 2, resourcePoolOptions: { rootDir: path.join(dir, 'pool'), pollMs: 10 } })));
    assert.equal(maximum, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
