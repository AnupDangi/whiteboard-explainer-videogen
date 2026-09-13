import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPageText,ingestSource} from '../dist/src/explainer/sources.js';

// LD1 acceptance: (a) buildPageText is a pure, deterministic page assembler;
// (b) a real >15-page PDF extracts IN FULL with correct page offsets — the old
// PAGE_LIMIT=15 would have truncated this document at page 15.

test('LD1 buildPageText: form-feed pages become offsets into one joined text',()=>{
  const raw='Alpha page\n\nhas lines\fBeta page\f\fGamma page';
  const {text,pages}=buildPageText(raw);
  assert.deepEqual(pages.map(p=>p.page),[1,2,4]);
  assert.equal(text.slice(pages[1].start,pages[1].start+9),'Beta page');
  assert.equal(text.slice(pages[2].start,pages[2].start+10),'Gamma page');
  // Deterministic: same input, same bytes.
  const again=buildPageText(raw);
  assert.equal(again.text,text);
  assert.deepEqual(again.pages,pages);
});

test('LD1 buildPageText: tailCut caps length and keeps only offsets below the cut',()=>{
  const raw='one two three four\fsecond page content here\fthird page never fits';
  const {text,pages}=buildPageText(raw,30);
  assert(text.length<=30);
  for(const p of pages)assert(p.start<text.length,`offset ${p.start} past cut ${text.length}`);
  assert.equal(pages[0].start,0);
  // First page fits whole; the overflowing page is cut at a word boundary, not mid-word.
  assert(text.startsWith('one two three four'));
  assert(text.endsWith('second'));
});

test('LD1 buildPageText: empty input yields empty text and no offsets',()=>{
  const {text,pages}=buildPageText('');
  assert.equal(text,'');
  assert.deepEqual(pages,[]);
});

/** Hand-rolled n-page PDF with one text line per page (Helvetica base-14 font, no
 *  embedding needed) so the full-document extraction path is tested against real
 *  poppler without any new dependency. */
function buildPdf(pageTexts){
  const esc=s=>s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const out=['%PDF-1.4\n'];
  const offsets=[];
  const push=(num,body)=>{offsets[num]=out.join('').length;out.push(`${num} 0 obj\n${body}\nendobj\n`);};
  push(1,'<< /Type /Catalog /Pages 2 0 R >>');
  push(2,`<< /Type /Pages /Kids [${pageTexts.map((_,i)=>`${5+i*2} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`);
  push(3,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for(let i=0;i<pageTexts.length;i++){
    const contentNum=4+i*2,pageNum=5+i*2;
    const stream=`BT /F1 12 Tf 72 720 Td (${esc(pageTexts[i])}) Tj ET`;
    push(contentNum,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    push(pageNum,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`);
  }
  const body=out.join('');
  const maxNum=4+pageTexts.length*2-1;
  let xref=`xref\n0 ${maxNum+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=maxNum;i++)xref+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  return Buffer.from(body+xref+`trailer\n<< /Size ${maxNum+1} /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF\n`,'latin1');
}

const WORDS=['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet','Kilo','Lima','Mike','November','Oscar','Papa','Quebec','Romeo','Sierra','Tango'];
test('LD1 extraction: a 20-page PDF is ingested whole with page offsets past the old 15-page cap',async()=>{
  const pageTexts=WORDS.map((w,i)=>`${w} page ${i+1} measures 4 units`);
  const pdf=buildPdf(pageTexts);
  const doc=await ingestSource({kind:'pdf',base64:pdf.toString('base64'),name:'book.pdf'});
  assert.equal(doc.pages.length,20);
  assert.deepEqual(doc.pages.map(p=>p.page),Array.from({length:20},(_,i)=>i+1));
  for(let i=0;i<20;i++){
    const start=doc.pages[i].start,end=i<19?doc.pages[i+1].start:doc.text.length;
    const pageSlice=doc.text.slice(start,end);
    assert(pageSlice.startsWith(`${WORDS[i]} page ${i+1}`),`page ${i+1} offset mismatch: ${JSON.stringify(pageSlice.slice(0,30))}`);
  }
  assert(doc.text.includes('Tango page 20 measures 4 units'));
  assert(doc.text.includes('Alpha page 1 measures 4 units'));
});
