import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BoardOpSchema } from '../visual-v2/board-ops/types.js';
import { applyOps, emptyBoardState } from '../visual-v2/board-state/reducer.js';
import { referentOf } from '../assets/referent.js';
import { measureV2Scene, summarizeV2Richness, type IconUse } from '../harness/v2Richness.js';
import { loadRetainedV2Run } from '../harness/retainedV2Run.js';
import { richnessReport } from '../harness/v2RichnessReport.js';

// Synthetic contract fixture only; never a quality or visual measurement.
const G = 'simi-house-v1/general-drawon';
const D = 'simi-house-v1/domain-outline';
const op = (raw: unknown) => BoardOpSchema.parse(raw);
const ops = [
  op({ op: 'add', opId: 'b1.e1', beatId: 'b1', id: 'e1', element: { type: 'entity', conceptId: 'c1', label: 'Cell', provenance: 'illustrative' }, at: { region: 'left' } }),
  op({ op: 'add', opId: 'b1.t1', beatId: 'b1', id: 't1', element: { type: 'token', text: 'ATP', provenance: 'illustrative' }, at: { region: 'right' } }),
  op({ op: 'add', opId: 'b1.x1', beatId: 'b1', id: 'x1', element: { type: 'text', text: 'Energy note', role: 'note', provenance: 'illustrative' }, at: { region: 'bottom' } }),
  op({ op: 'connect', opId: 'b1.r1', beatId: 'b1', id: 'r1', from: 'e1', to: 't1', relation: 'produces', label: 'makes' }),
];
const state = applyOps(emptyBoardState(), ops).state;

test('referentOf strips determiners and singularises the last word', () => {
  assert.equal(referentOf('The Cells'), 'cell');
  assert.equal(referentOf('Compound interest'), 'compound interest');
  assert.equal(referentOf(''), '');
});

test('measureV2Scene counts icons, families, reuse conflicts and text on the board', () => {
  const icons: IconUse[] = [
    { elementId: 'e1', referent: 'cell', assetId: 'a1', houseFamily: G, sidePx: 80, kind: 'entity-picture' },
    { elementId: 't1', referent: 'atp', assetId: 'a1', houseFamily: D, sidePx: 50, kind: 'badge' },
  ];
  const row = measureV2Scene({ sceneId: 's1', states: [state], icons });
  assert.equal(row.depictableCount, 2);
  assert.equal(row.iconBearingCount, 2);
  assert.equal(row.labelOnlyEntityCount, 0);
  assert.equal(row.edgeCount, 1);
  assert.deepEqual(row.iconFamilies, [D, G]);
  assert.equal(row.familyMix, true);
  assert.equal(row.assetReuseConflicts, 1);
  assert.equal(row.minIconSidePx, 50);
  assert.equal(row.textChars, 'Cell'.length + 'ATP'.length + 'Energy note'.length + 'makes'.length);
  assert.equal(row.wordsOnBoard, 5);
  assert.deepEqual(row.elementVariety, ['entity', 'text', 'token']);
});

test('a board with no icons reports zero icon share and every entity label-only', () => {
  const row = measureV2Scene({ sceneId: 's1', states: [state], icons: [] });
  const summary = summarizeV2Richness([row, row]);
  assert.equal(summary.iconBearingShare, 0);
  assert.equal(summary.labelOnlyEntityRatio, 1);
  assert.equal(summary.minIconSidePx, null);
  assert.equal(summary.scenes, 2);
});

const beatTimings = [{ beatId: 'one.b1', startMs: 0, endMs: 3000, sentences: [{ startMs: 0, endMs: 3000 }] }];
const prep = {
  request: { id: 'fixture-lesson' },
  plan: { sections: [{ id: 'one', title: 'One' }] },
  graph: { concepts: [{ id: 'x', label: 'X', kind: 'process' }] },
};
const snapshot = {
  transition: { mode: 'clean' },
  ops: [{ op: 'add', opId: 'o1', beatId: 'one.b1', id: 'x1', element: { type: 'entity', conceptId: 'x', label: 'X', provenance: 'illustrative' }, at: { region: 'center' } }],
  beatTimings,
  timelineHash: 'not-the-replayed-hash',
};

async function fixtureRun(withScene: boolean): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-richness-'));
  await mkdir(path.join(dir, 'v2'));
  await writeFile(path.join(dir, 'lesson-prep.json'), JSON.stringify(prep));
  if (withScene) await writeFile(path.join(dir, 'v2', 'scene.one.json'), JSON.stringify(snapshot));
  return dir;
}

test('loadRetainedV2Run replays a retained scene without a video and marks it incomplete', async () => {
  const dir = await fixtureRun(true);
  try {
    const run = await loadRetainedV2Run(dir);
    assert.equal(run.status, 'loaded');
    assert.equal(run.lessonId, 'fixture-lesson');
    assert.equal(run.complete, false);
    assert.equal(run.hardFailures, null);
    assert.equal(run.scenes.length, 1);
    assert.equal(run.scenes[0]!.timelineReplayMatches, false);
    const report = await richnessReport([dir]);
    assert.equal(report.runs[0]!.summary.iconBearingShare, 0);
    assert.equal(report.pooled.scenes, 0, 'runs without video.mp4 never enter the pooled numbers');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a missing scene snapshot makes the run unavailable, not silently shorter', async () => {
  const dir = await fixtureRun(false);
  try {
    const run = await loadRetainedV2Run(dir);
    assert.equal(run.status, 'unavailable');
    assert.match(run.reason ?? '', /scene\.one\.json/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
