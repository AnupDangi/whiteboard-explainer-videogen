import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBatchPlan,
  parseBatchArgs,
  provenanceRowFor,
  renderBatchSummaryMarkdown,
  requireLiveConfirmation,
  summarizeBatchRuns,
} from '../harness/validationBatch.js';

test('parse requires a prompt and at least one source', () => {
  assert.throws(() => parseBatchArgs(['--source=a.md', '--confirm-live']), /--prompt/);
  assert.throws(() => parseBatchArgs(['--prompt=p', '--confirm-live']), /--source/);
});

test('parse rejects non-integer durations and records the live flag', () => {
  assert.throws(() => parseBatchArgs(['--prompt=p', '--source=a.md', '--duration=abc']), /duration/);
  assert.throws(() => parseBatchArgs(['--prompt=p', '--source=a.md', '--duration=0']), /duration/);
  assert.equal(parseBatchArgs(['--prompt=p', '--source=a.md']).confirmLive, false);
  assert.equal(parseBatchArgs(['--prompt=p', '--source=a.md', '--confirm-live']).confirmLive, true);
});

test('parse expands repeatable and comma-separated durations, defaulting to 60', () => {
  const parsed = parseBatchArgs(['--prompt=p', '--source=a.md', '--source=b.md', '--duration=60,300']);
  assert.deepEqual(parsed.sources, ['a.md', 'b.md']);
  assert.deepEqual(parsed.durations, [60, 300]);
  assert.deepEqual(parseBatchArgs(['--prompt=p', '--source=a.md']).durations, [60]);
});

test('confirmation gate refuses without the explicit flag and passes with it', () => {
  assert.throws(() => requireLiveConfirmation(parseBatchArgs(['--prompt=p', '--source=a.md'])), /--confirm-live/);
  requireLiveConfirmation(parseBatchArgs(['--prompt=p', '--source=a.md', '--confirm-live']));
});

test('plan crosses sources with durations using domain-free ids', () => {
  const plan = buildBatchPlan(parseBatchArgs(['--prompt=p', '--source=d/alpha.md', '--source=d/beta.md', '--duration=60,300', '--confirm-live']));
  assert.deepEqual(plan.map((s) => s.id), ['alpha-60s', 'alpha-300s', 'beta-60s', 'beta-300s']);
  const prefixed = buildBatchPlan(parseBatchArgs(['--prompt=p', '--source=d/alpha.md', '--id-prefix=phase 7']));
  assert.equal(prefixed[0].id, 'phase-7-alpha-60s');
});

test('summary aggregates fixture provenance rows without provider calls', () => {
  const specs = buildBatchPlan(parseBatchArgs(['--prompt=p', '--source=a.md', '--source=b.md', '--confirm-live']));
  const rows = [
    provenanceRowFor(specs[0]!, {
      pipelineStatus: 'draft', hardFailures: 0, costUsd: 0.02, tampered: false, finalVideoDurationSec: 61.2,
      metrics: { 'semantic.majorClaimVisualCoverage': 0.92, 'semantic.requiredRelationCoverage': 0.9, ignored: 'no', invalid: Number.NaN },
    }, 0, 'p/a.json'),
    provenanceRowFor(specs[1]!, null, 1, null),
  ];
  assert.deepEqual(rows[0]!.metrics, { 'semantic.majorClaimVisualCoverage': 0.92, 'semantic.requiredRelationCoverage': 0.9 });
  assert.equal(rows[1].status, 'no-provenance');
  assert.equal(rows[1].tampered, null);
  const summary = summarizeBatchRuns(rows);
  assert.deepEqual(summary.totals, {
    attempted: 2,
    withProvenance: 1,
    byStatus: { draft: 1, 'no-provenance': 1 },
    totalCostUsd: 0.02,
    tamperedCount: 0,
    metricMeans: {
      'semantic.majorClaimVisualCoverage': { count: 1, mean: 0.92 },
      'semantic.requiredRelationCoverage': { count: 1, mean: 0.9 },
    },
  });
  const md = renderBatchSummaryMarkdown(summary, { commit: 'abc123', modelNote: 'fixture' });
  assert.match(md, /\| source \| duration \| id \| status \| hard \| costUsd \| tampered \| videoSec \| visual \| relation \| state-change \| R11 text \|/);
  assert.match(md, /\| a\.md \| 60 \| a-60s \| draft \| 0 \| 0\.02 \| false \| 61\.2 \| 0\.92 \| 0\.9 \| n\/a \| n\/a \|/);
  assert.match(md, /semantic\.majorClaimVisualCoverage: 0\.920 \(n=1\)/);
  assert.match(md, /Tampered runs: 0/);
});
