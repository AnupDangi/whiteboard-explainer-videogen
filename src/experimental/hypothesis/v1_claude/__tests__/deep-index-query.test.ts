import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDeepQueryChunks } from '../../../../ingest/deep-index/deep-indexer.js';

test('service query payload maps data.chunks to answer text instead of a missing answer field (audit Batch 3)', () => {
  // rag-engine/service.py returns {ok, data} with no answer; the old mapping
  // read result.answer and always produced ''. Fail-pre: this was ''.
  const serviceResult = {
    ok: true,
    data: {
      status: 'success',
      message: 'Query executed successfully',
      data: {
        entities: [],
        relationships: [],
        chunks: [{ content: 'first retrieved piece' }, { text: 'second retrieved piece' }],
        references: [],
      },
      metadata: { query_mode: 'naive' },
    },
    queryStatus: 'complete',
  };
  assert.deepEqual(extractDeepQueryChunks(serviceResult.data), ['first retrieved piece', 'second retrieved piece']);
  assert.ok(extractDeepQueryChunks(serviceResult.data).join('\n\n').length > 0);
});

test('chunk extraction walks wrapper envelopes and ignores non-text entries (audit Batch 3)', () => {
  assert.deepEqual(extractDeepQueryChunks({ data: { chunks: [{ content: 'direct' }] } }), ['direct']);
  assert.deepEqual(extractDeepQueryChunks({ data: { result: { chunks: [{ content: 'wrapped' }] } } }), ['wrapped']);
  assert.deepEqual(
    extractDeepQueryChunks({ data: { chunks: [{ content: '  ' }, { id: 1 }, { text: 'kept' }] } }),
    ['kept'],
  );
  assert.deepEqual(extractDeepQueryChunks({ ok: true }), []);
  assert.deepEqual(extractDeepQueryChunks(null), []);
  assert.deepEqual(extractDeepQueryChunks('answer-string-is-not-chunks'), []);
});
