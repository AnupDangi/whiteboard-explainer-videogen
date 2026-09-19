import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBlocks,estimateTokens} from '../dist/src/shared/ingestion/blocks.js';
import {chunkSourceDocument} from '../dist/src/semantic/source/chunker.js';
import {buildIndex,coverageSet,focusSet,graphContext} from '../dist/src/semantic/retrieval/sets.js';
import {loadSourceDocument,saveSourceDocument} from '../dist/src/semantic/source/cache.js';
import {createMemoryCache} from '../dist/src/semantic/cache/store.js';
import {embedTexts} from '../dist/src/semantic/planning/model-adapter.js';

const doc=(text)=>({kind:'text',label:'t',text,sha256:'sha-test',blocks:parseBlocks(text)});

test('W1 blocks: headings, tables, code, equations and figures are typed, not flattened',()=>{
  const blocks=parseBlocks([
    '# Title',
    '',
    'Intro paragraph.',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '$$',
    'E = mc^2',
    '$$',
    '',
    '![diagram](img.png)',
  ].join('\n'));
  const types=blocks.map(b=>b.type);
  for(const expected of ['heading','text','table','code','equation','figure'])assert.ok(types.includes(expected),`missing ${expected} in ${types}`);
  const table=blocks.find(b=>b.type==='table');
  assert.deepEqual(table.columns,['A','B']);
  assert.deepEqual(table.rows,[['1','2']]);
  const heading=blocks.find(b=>b.type==='heading');
  assert.equal(heading.text,'Title');
  assert.equal(heading.level,1);
});

test('W1 chunker: respects heading boundaries, packs to target, keeps code whole',()=>{
  const long='word '.repeat(1000);
  const text=`# Section One\n\n${long}\n\n# Section Two\n\n${long}\n\n\`\`\`\n${'const line = 1;\n'.repeat(60)}\`\`\``;
  const chunks=chunkSourceDocument(doc(text));
  assert.ok(chunks.length>=3,'long sections produce multiple chunks');
  assert.ok(chunks.every(c=>Array.isArray(c.sectionPath)&&c.tokens>0));
  const sections=new Set(chunks.map(c=>c.sectionPath[0]));
  assert.deepEqual([...sections].sort(),['Section One','Section Two'],'a chunk never spans two top-level sections');
  const code=chunks.find(c=>c.blockTypes.includes('code'));
  assert.ok(code&&code.text.includes('const line = 1;'),'the code block survives whole');
  assert.ok(chunks.some(c=>c.tokens>1000),'chunks reach the target');
});

test('W1 coverage/focus: coverage keeps every section, focus ranks the relevant chunk',()=>{
  const text=[
    '# Photosynthesis','plants use sunlight water and carbon dioxide to make glucose','',
    '# Taxation','a tax is a compulsory financial charge imposed by a government','',
  ].join('\n');
  const chunks=chunkSourceDocument(doc(text));
  const coverage=coverageSet(chunks);
  assert.equal(coverage.length,2,'one representative per top-level section');
  const index=buildIndex(chunks);
  const focus=focusSet(index,{objective:'how do plants make glucose using sunlight',topK:1});
  assert.equal(focus.length,1);
  assert.match(focus[0].text,/sunlight|glucose/);
  const context=graphContext(chunks,{objective:'compulsory financial charge government',topK:3});
  assert.ok(context.coverageIds.length>=1&&context.focusIds.length>=1);
  assert.ok(context.chunks.length>=Math.max(context.coverage.length,context.focus.length),'union contains both sets');
});

test('W1 source cache: deterministic document round-trips, keyed by source hash',async()=>{
  const store=createMemoryCache();
  const document=doc('# A\n\nbody text that is long enough to survive');
  await saveSourceDocument(store,document);
  const loaded=await loadSourceDocument(store,'sha-test');
  assert.equal(loaded.text,document.text);
  assert.ok(loaded.blocks.length>=1);
  assert.equal(await loadSourceDocument(store,'other-hash'),undefined);
});

test('W1 embeddings: absent key degrades to BM25-only without throwing',async()=>{
  assert.equal(await embedTexts(['hello'],{env:{}}),null);
});
