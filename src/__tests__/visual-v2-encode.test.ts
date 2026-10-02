import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BoardOpSchema } from '../visual-v2/board-ops/types.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import { compileSceneTimeline } from '../visual-v2/timeline/compile.js';
import { compileScene, holdKey } from '../visual-v2/renderer/frame.js';
import { encodeV2Video } from '../visual-v2/renderer/encode.js';
import { runFfmpeg, probeMediaDurationMs } from '../export/ffmpeg.js';

const ops = [
  BoardOpSchema.parse({ op: 'add', opId: 'o1', beatId: 'b1', id: 'k', element: { type: 'kit', kit: 'stack', paramsJson: '{}', provenance: 'metaphorical' }, at: { region: 'center' } }),
  BoardOpSchema.parse({ op: 'add', opId: 'o2', beatId: 'b1', id: 'x', element: { type: 'token', text: 'x', provenance: 'illustrative' }, at: { region: 'center', container: 'k', slot: 'top' } }),
];
const beats = [{ beatId: 'b1', startMs: 0, endMs: 1500, sentences: [{ startMs: 0, endMs: 750 }, { startMs: 750, endMs: 1500 }] }];

test('hold frames are keyed, animating frames are not', () => {
  const scene = compileScene('s', 'T', compileSceneTimeline({ ops, initial: emptyBoardState(), beats }));
  assert.equal(holdKey(scene, 100), undefined, 'the title is still drawing in');
  const t = scene.timeline.ops;
  assert.equal(holdKey(scene, (t[1]!.t0 + t[1]!.t1) / 2), undefined, 'an op is in flight');
  assert.equal(holdKey(scene, t[1]!.t1 + 500), holdKey(scene, t[1]!.t1 + 1500), 'the same hold has one key');
});

test('encoding a short scene writes an mp4 of the audio length and renders the hold once', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-v2-encode-'));
  try {
    const wav = path.join(dir, 'silence.wav');
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '4', wav]);
    const scene = compileScene('s', 'Short', compileSceneTimeline({ ops, initial: emptyBoardState(), beats }));
    const out = path.join(dir, 'video.mp4');
    const result = await encodeV2Video([{ scene, startMs: 0, endMs: 4000 }], 4000, wav, out, { fps: 10, workerCount: 2, cacheDir: path.join(dir, 'cache') });
    assert.equal(result.frames, 40);
    assert.ok(result.reused > result.rendered, `holds are reused (${result.reused} reused, ${result.rendered} rendered)`);
    assert.ok((await stat(out)).size > 1000);
    const ms = await probeMediaDurationMs(out);
    assert.ok(Math.abs(ms - 4000) < 300, `duration ${ms}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
