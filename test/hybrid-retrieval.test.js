import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chunkSource,retrieveChapterEvidence} from '../dist/src/retrieval.js';

// LD4 hybrid: RRF fusion of BM25 and cosine ranks. Vectors are synthetic — the point
// is the fusion math and the BM25-only fallback, not embedding quality.

function sourceWith(paragraphs){
  return {kind:'text',label:'t',text:paragraphs.join('\n\n'),sha256:'x'};
}

const PARAGRAPHS=[
  'Filler paragraph alpha talks about administrative scheduling without any topical relation here.',
  'The attention mechanism computes compatibility between a query and every key in the context.',
  'Filler paragraph beta covers office furniture logistics and delivery timelines for offices.',
  'The softmax function normalizes the compatibility scores into weights that sum to one.',
];

test('LD4 hybrid: cosine-only signal retrieves a chunk BM25 cannot see (synonym case)',()=>{
  const source=sourceWith(PARAGRAPHS);
  const chunks=chunkSource(source,{maxChars:120});
  assert.equal(chunks.length,4);
  // Query has NO lexical overlap with paragraph 3 (softmax) — BM25 ranks it low/zero.
  // Cosine vectors encode it as the best match: query vector ~ paragraph 3's vector.
  const vectors=[
    [1,0,0],
    [0,1,0],
    [0,0,1],
    [0.9,0.9,0], // highest cosine with query
  ];
  const queryVector=[0.9,0.9,0];
  const evidence=retrieveChapterEvidence(source,'representation collapse across layers',['loss of feature diversity'],300,{maxChars:120,vectors,queryVector});
  assert(evidence.text.includes('softmax'),'cosine-similar chunk retrieved despite zero lexical overlap');
  // Filler paragraphs stay out unless fused in by rank.
  assert(!evidence.text.includes('office furniture'),'furniture stays excluded');
});

test('LD4: missing query vector or vectors falls back to BM25-only determinism',()=>{
  const source=sourceWith(PARAGRAPHS);
  const lexical=retrieveChapterEvidence(source,'attention query keys softmax',['compatibility'],300,{maxChars:120});
  assert(lexical.text.includes('attention mechanism'));
  assert(!lexical.text.includes('office furniture'));
  // Vectors present but no query vector → BM25-only path, same result.
  const vectors=PARAGRAPHS.map((_,i)=>[i+1,1,0]);
  const bm25WithVectors=retrieveChapterEvidence(source,'attention query keys softmax',['compatibility'],300,{maxChars:120,vectors});
  assert.equal(bm25WithVectors.text,lexical.text);
  // Chunk ids ride along in both paths (LD6 hook).
  assert(lexical.ids.length>=1&&lexical.ids.every(id=>/^p\d+:c\d+$/.test(id)));
});
