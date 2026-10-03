import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditRetainedBoard } from './audit-retained-board-v2.mjs';

const beat = (sceneId) => ({ beatId: `${sceneId}.b1`, claimIds: ['c'], entities: [{ conceptId: 'x' }], narrationOnly: false, visualInvariant: 'x remains shown' });
const narration = (sceneId) => ({ text: 'X.', beatSpans: [{ beatId: `${sceneId}.b1`, sentenceSpans: [{ charStart: 0, charEnd: 2 }] }] });
const timing = (sceneId) => [{ beatId: `${sceneId}.b1`, startMs: 0, endMs: 3000, sentences: [{ startMs: 0, endMs: 3000 }] }];
const prep = {
  plan: { sections: ['one', 'two'].map((id) => ({ id, title: id, conceptIds: ['x'] })) },
  graph: { concepts: [{ id: 'x', label: 'X', evidence: [] }] },
  beatPlans: { one: [beat('one')], two: [beat('two')] },
  beatNarrations: { one: narration('one'), two: narration('two') },
  sourceDoc: { spans: [] },
};
const first = {
  transition: { mode: 'clean' }, ops: [{ op: 'add', opId: 'o1', beatId: 'one.b1', id: 'x1', element: { type: 'entity', conceptId: 'x', label: 'X', provenance: 'illustrative', bindings: { conceptIds: ['x'], claimIds: ['c'] } }, at: { region: 'center' }, persistence: 'lesson' }], beatTimings: timing('one'),
};
const second = { transition: { mode: 'retain-all' }, ops: [{ op: 'highlight', opId: 'o2', beatId: 'two.b1', target: 'x1' }], beatTimings: timing('two') };

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'board-audit-'));
  await mkdir(path.join(dir, 'v2'));
  await writeFile(path.join(dir, 'lesson-prep.json'), JSON.stringify(prep));
  await writeFile(path.join(dir, 'v2', 'scene.one.json'), JSON.stringify(first));
  await writeFile(path.join(dir, 'v2', 'scene.two.json'), JSON.stringify(second));
  return dir;
}

test('audits accepted snapshots with inherited board state without changing run files', async () => {
  const dir = await fixture();
  try {
    const before = await readFile(path.join(dir, 'v2', 'scene.two.json'), 'utf8');
    const report = await auditRetainedBoard(dir);
    assert.deepEqual(report.scenes.map((scene) => scene.status), ['accepted-snapshot-valid', 'accepted-snapshot-valid']);
    assert.equal(report.counts.acceptedSnapshotValid, 2);
    assert.equal(report.historicalRawS6AndRepairStatus, 'unmeasured');
    assert.match(report.caveat, /not original raw S6 responses/);
    assert.equal(await readFile(path.join(dir, 'v2', 'scene.two.json'), 'utf8'), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('separates current invalidity from historical failures and missing accepted snapshots', async () => {
  const dir = await fixture();
  try {
    await writeFile(path.join(dir, 'v2', 'scene.one.json'), JSON.stringify({ ...first, ops: [{ ...first.ops[0], element: { ...first.ops[0].element, bindings: undefined } }] }));
    const invalid = await auditRetainedBoard(dir);
    assert.equal(invalid.scenes[0].status, 'accepted-snapshot-invalid');
    assert.ok(invalid.scenes[0].currentValidatorProblems.some((problem) => /bindings/.test(problem.path)));
    assert.equal(invalid.scenes[0].historicalValidatorProblems, 'unavailable');
    await rm(path.join(dir, 'v2', 'scene.two.json'));
    const missing = await auditRetainedBoard(dir);
    assert.equal(missing.scenes[1].status, 'unavailable');
    assert.equal(missing.counts.unavailable, 1);
    await rm(path.join(dir, 'lesson-prep.json'));
    const absentPrep = await auditRetainedBoard(dir);
    assert.equal(absentPrep.status, 'unavailable');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
