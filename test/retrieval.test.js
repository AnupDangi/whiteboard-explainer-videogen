import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chunkSource,retrieveChapterEvidence} from '../dist/src/retrieval.js';

function docWithPages(pageTexts){
  const pages=[];let text='';
  for(const p of pageTexts){
    pages.push({page:pages.length+1,start:text.length});
    text+=(text?'\n\n':'')+p;
  }
  return {kind:'pdf',label:'Test Book',text,sha256:'sha-test',pages};
}

test('LD3 chunkSource: paragraph chunks carry stable per-page ids',()=>{
  const pages=[
    'First paragraph on page one with several words of content.\n\nSecond paragraph also on page one, a little longer than the first one.',
    'Third paragraph opens page two with its own content and words.',
  ];
  const source=docWithPages(pages);
  const chunks=chunkSource(source,{maxChars:120});
  assert(chunks.length>=2);
  assert.equal(chunks[0].id,`p1:c1`);
  assert.equal(chunks[0].page,1);
  assert.equal(chunks[0].start,0);
  const onPage2=chunks.find(c=>c.page===2);
  assert(onPage2,'a chunk starts on page 2');
  assert.equal(onPage2.id,'p2:c1');
  assert(source.text.slice(onPage2.start,onPage2.start+5).length===5,'chunk start is a valid text offset');
  // Deterministic: same input, same chunk ids and offsets.
  const again=chunkSource(source,{maxChars:120});
  assert.deepEqual(again,chunks);
});

test('LD3 BM25: evidence ranks topic chunks above filler and returns chunk ids',()=>{
  const filler=Array.from({length:6},(_,i)=>`Filler paragraph ${i} about administrative scheduling policy with no topical relation whatsoever.`).join('\n\n');
  const topic='The attention mechanism computes compatibility between a query and every key in the context, then softmax normalizes the scores into weights that sum to one.';
  const furniture='Completely unrelated paragraph about office furniture logistics and delivery timelines.';
  const source={kind:'text',label:'t',text:[filler,topic,furniture].join('\n\n'),sha256:'x'};
  const evidence=retrieveChapterEvidence(source,'How does attention use queries keys and softmax normalization?',['Compatibility scores'],600,{maxChars:180});
  assert(evidence.text.includes('attention mechanism'),'topic chunk retrieved');
  assert(!evidence.text.includes('office furniture'),'furniture excluded');
  assert(evidence.ids.length>=1&&evidence.ids.every(id=>/^p\d+:c\d+$/.test(id)),'chunk ids ride along');
});

test('LD3: no-term queries fall back to document-order evidence within budget',()=>{
  const paragraphs=Array.from({length:8},(_,i)=>`Paragraph ${i} carries some generic educational content for the fallback path test.`);
  const source={kind:'text',label:'t',text:paragraphs.join('\n\n'),sha256:'x'};
  const evidence=retrieveChapterEvidence(source,'',[''],400,{maxChars:120});
  assert(evidence.text.length>0&&evidence.text.length<=450,'bounded evidence returned');
  const firstChunk=chunkSource(source,{maxChars:120})[0];
  assert(evidence.text.startsWith(firstChunk.text),'document-order fallback starts at the first chunk');
});
