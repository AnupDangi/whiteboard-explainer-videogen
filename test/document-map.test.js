import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildDocumentMap,mapCachePath,readCachedMap,writeCachedMap} from '../dist/src/explainer/document-map.js';

function docWithPages(pageTexts){
  const pages=[];let text='';
  for(const p of pageTexts){
    pages.push({page:pages.length+1,start:text.length});
    text+=(text?'\n\n':'')+p;
  }
  return {kind:'pdf',label:'Test Book',text,sha256:'sha-test',pages};
}

test('LD2 map: numbered headings become ordered sections with pages and tiling spans',()=>{
  const pages=[
    '1. Chapter Alpha\nAlpha body text about transformers and attention mechanisms. Key number: 4 units.',
    '2. Chapter Bravo\nBravo body continues the mechanism. Another number: 9 items.',
    '3. Chapter Charlie\nCharlie body closes the loop. Final number: 2 cases.',
  ];
  const source=docWithPages(pages);
  const map=buildDocumentMap(source);
  assert.equal(map.kind,'paper');
  assert.equal(map.sections.length,3);
  assert.deepEqual(map.sections.map(s=>s.page),[1,2,3]);
  // Sections tile the text: each section ends where the next begins.
  for(let i=0;i<map.sections.length-1;i++)assert.equal(map.sections[i].end,map.sections[i+1].start);
  assert.equal(map.sections[2].end,source.text.length);
  assert(map.sections[0].summary.includes('Alpha body'));
  assert(map.sections[0].summary.includes('4 units'),'number-bearing sentence rides into the summary');
  assert.equal(map.sections[0].id,'s1');
});

test('LD2 map: heading cap keeps spans tiling and first/last preserved',()=>{
  const pages=Array.from({length:60},(_,i)=>`${i+1}. Heading Section\nBody paragraph ${i} with filler content to separate headings.`);
  const source=docWithPages(pages);
  const map=buildDocumentMap(source);
  assert(map.sections.length<=48);
  assert.equal(map.sections[0].title,'1. Heading Section');
  for(let i=0;i<map.sections.length-1;i++)assert.equal(map.sections[i].end,map.sections[i+1].start);
});

test('LD2 map: structureless long document falls back to page windows',()=>{
  const pages=Array.from({length:25},(_,i)=>`lorem ipsum dolor sit amet ${i} consectetur adipiscing elit sed do eiusmod tempor`);
  const source=docWithPages(pages);
  const map=buildDocumentMap(source);
  // No headings detected → kind stays 'unknown' even though page windows exist.
  assert.equal(map.kind,'unknown');
  assert(map.sections.length>=2);
  assert(map.sections[0].title.startsWith('Pages 1–'));
  for(let i=0;i<map.sections.length-1;i++)assert.equal(map.sections[i].end,map.sections[i+1].start);
  assert.equal(map.sections[map.sections.length-1].end,source.text.length);
});

test('LD2 map: flat text without pages gets one section',()=>{
  const map=buildDocumentMap({kind:'text',label:'Paste',text:'Just a plain pasted prompt with no headings at all. It has two sentences.',sha256:'s'});
  assert.equal(map.kind,'unknown');
  assert.equal(map.sections.length,1);
  assert.equal(map.sections[0].charCount,73);
});

test('LD2 map junk filter: figure labels and legend rows never become sections',()=>{
  // Real numbered sections + junk: a 30-char figure label and a repeated-token legend row.
  const pages=[
    '1. Architecture\nThe architecture body explains the mechanism in detail with enough text volume to qualify as real section content for the map.',
    '2. Pre-Training\nThe pre-training body continues with more substantial explanatory content so the section spans remain meaningful for retrieval routing.',
    'Shared Expert\nfig',
    'RMSNorm RMSNorm\nbar',
    '3. Post-Training\nThe post-training body closes the document with the summary paragraphs and final remarks of the technical report here.',
  ];
  const source=docWithPages(pages);
  const map=buildDocumentMap(source);
  const titles=map.sections.map(s=>s.title);
  assert(!titles.some(t=>t.startsWith('Shared Expert')),'tiny figure label dropped');
  assert(!titles.some(t=>t.startsWith('RMSNorm RMSNorm')),'repeated-token legend row dropped');
  // The dropped heading's text is absorbed — sections still tile the whole document.
  for(let i=0;i<map.sections.length-1;i++)assert.equal(map.sections[i].end,map.sections[i+1].start);
  assert.equal(map.sections[map.sections.length-1].end,source.text.length);
  assert(map.sections.some(s=>s.title.includes('Post-Training')),'numbered junk is kept, real numbered sections survive');
});

test('LD2 cache: sha256-keyed map file round-trips',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-cache-'));
  try{
    const source=docWithPages(['1. Chapter Alpha\nBody one. 4 units.','2. Chapter Bravo\nBody two. 9 items.','3. Chapter Charlie\nBody three. 2 cases.']);
    const map=buildDocumentMap(source);
    assert.equal(await readCachedMap(dir,'abc'),null);
    await writeCachedMap(dir,'abc',map);
    // Versioned cache: heuristic changes must invalidate stale maps, not serve them.
    assert(/^map-v\d+-abc\.json$/.test(mapCachePath(dir,'abc').split('/').pop()));
    const back=await readCachedMap(dir,'abc');
    assert.deepEqual(back,map);
  }finally{await rm(dir,{recursive:true,force:true});}
});
