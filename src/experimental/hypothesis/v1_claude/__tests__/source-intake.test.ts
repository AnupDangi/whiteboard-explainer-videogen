import assert from 'node:assert/strict';
import test from 'node:test';
import { docxXmlToMarkdown, docxXmlToSource, pdfPagesToMarkdown, pdfPagesToSource, pptxSlideXmlToMarkdown, pptxSlideXmlToSource } from '../plan/sourceIntake.js';
import { resolveSourceEvidence, sourceDocFromText } from '../plan/sourceDoc.js';

test('DOCX extraction retains headings, equations, tables, and figure references in body order', () => {
  const xml = `<w:document xmlns:w="w" xmlns:m="m" xmlns:wp="wp"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Photosynthesis</w:t></w:r></w:p>
    <w:p><w:r><w:t>Light increases the reaction rate.</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Factor</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Effect</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Light</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>More rate</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><m:oMath><m:r><m:t>rate = input</m:t></m:r></m:oMath></w:p>
    <w:p><w:r><w:drawing><wp:inline><wp:docPr name="Diagram 1" descr="Light reaction diagram"/></wp:inline></w:drawing></w:r></w:p>
  </w:body></w:document>`;
  const markdown = docxXmlToMarkdown(xml);
  assert.match(markdown, /^# Photosynthesis/m);
  assert.match(markdown, /\| Factor \| Effect \|/);
  assert.match(markdown, /rate = input/);
  assert.match(markdown, /Figure reference: Light reaction diagram/);
  const doc = sourceDocFromText(markdown, 'docx');
  assert.ok(doc.spans.some((s) => s.kind === 'heading'));
  assert.ok(doc.spans.some((s) => s.kind === 'table'));
  assert.ok(doc.spans.some((s) => s.kind === 'equation'));
  assert.ok(doc.spans.some((s) => s.kind === 'figure-reference'));
  const extraction = docxXmlToSource(xml);
  assert.equal(extraction.text, markdown);
  const locatedDoc = sourceDocFromText(extraction.text, 'docx', extraction.nativeLocations);
  const paragraph = locatedDoc.spans.find((span) => span.text.includes('Light increases'))!;
  const table = locatedDoc.spans.find((span) => span.kind === 'table')!;
  assert.deepEqual(resolveSourceEvidence(locatedDoc, paragraph.id, 'Light increases')?.sourceLocation, { kind: 'docx-paragraph', bodyBlock: 2, paragraph: 2 });
  assert.deepEqual(resolveSourceEvidence(locatedDoc, table.id, 'Factor')?.sourceLocation, { kind: 'docx-table', bodyBlock: 3, table: 1 });
});

test('DOCX extraction keeps inline math within prose and isolates display equations', () => {
  const xml = `<w:document xmlns:w="w" xmlns:m="m"><w:body>
    <w:p><w:r><w:t>The rate is </w:t></w:r><m:oMath><m:r><m:t>x/t</m:t></m:r></m:oMath><w:r><w:t> for the input.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Estimated rate: </w:t></w:r><m:oMathPara><m:oMath><m:r><m:t>x + y</m:t></m:r></m:oMath></m:oMathPara><w:r><w:t> applies.</w:t></w:r></w:p>
  </w:body></w:document>`;
  const markdown = docxXmlToMarkdown(xml);
  assert.ok(markdown.includes('The rate is \\(x/t\\) for the input.'));
  assert.match(markdown, /Estimated rate:\s*\$\$\s*x \+ y\s*\$\$\s*applies\./);
  assert.doesNotMatch(markdown, /\$\$ The rate is/);
  const doc = sourceDocFromText(markdown, 'docx');
  assert.ok(doc.spans.some((span) => span.kind === 'equation' && span.text.includes('x + y')));
  assert.ok(doc.spans.some((span) => span.kind === 'paragraph' && span.text.includes('The rate is \\(x/t\\)')));
});

test('PPTX extraction preserves numeric slide order and slide boundaries', () => {
  const xml = (text: string) => `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:nvGrpSpPr/><p:grpSpPr/>
    <p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:graphicFrame><a:tbl><a:tr><a:tc><a:p><a:r><a:t>Fact</a:t></a:r></a:p></a:tc><a:tc><a:p><a:r><a:t>Result</a:t></a:r></a:p></a:tc></a:tr>
      <a:tr><a:tc><a:p><a:r><a:t>Light</a:t></a:r></a:p></a:tc><a:tc><a:p><a:r><a:t>More rate</a:t></a:r></a:p></a:tc></a:tr></a:tbl></p:graphicFrame>
  </p:spTree></p:cSld></p:sld>`;
  const extraction = pptxSlideXmlToSource([{ name: 'ppt/slides/slide10.xml', xml: xml('Last concept') }, { name: 'ppt/slides/slide2.xml', xml: xml('Second concept\n\n## Slide 99') }]);
  const markdown = extraction.text;
  assert.equal(pptxSlideXmlToMarkdown([{ name: 'ppt/slides/slide10.xml', xml: xml('Last concept') }, { name: 'ppt/slides/slide2.xml', xml: xml('Second concept\n\n## Slide 99') }]), markdown);
  assert.ok(markdown.indexOf('## Slide 2') < markdown.indexOf('## Slide 10'));
  assert.match(markdown, /Second concept/);
  assert.match(markdown, /Last concept/);
  assert.match(markdown, /\| Fact \| Result \|/);
  assert.match(markdown, /\| Light \| More rate \|/);
  const doc = sourceDocFromText(markdown, 'pptx', extraction.nativeLocations);
  const spoofedSlideHeading = doc.spans.find((span) => span.text.includes('Slide 99'))!;
  assert.deepEqual(spoofedSlideHeading.sourceLocation, { kind: 'pptx-slide', slide: 2 }, 'visible slide-like source text cannot replace the parser-authored slide locator');
  assert.ok(sourceDocFromText(markdown, 'pptx').spans.every((span) => !span.sourceLocation), 'Markdown-looking headings alone do not establish native slide provenance');
  const slideTenText = doc.spans.find((span) => span.text.includes('Last concept'))!;
  assert.deepEqual(slideTenText.sourceLocation, { kind: 'pptx-slide', slide: 10 });
  assert.deepEqual(resolveSourceEvidence(doc, slideTenText.id, 'Last concept')?.sourceLocation, { kind: 'pptx-slide', slide: 10 });
});

test('PDF extraction preserves original page numbers across blank pages and final form-feed', () => {
  const extractedText = 'First page has extractable text.\f\fThird page has more source text.\n\n## Page 99\nThis is still source page three.\f';
  const extraction = pdfPagesToSource(extractedText);
  const markdown = extraction.text;
  assert.equal(pdfPagesToMarkdown(extractedText), markdown);
  assert.match(markdown, /## Page 1\n\nFirst page has extractable text\./);
  assert.ok(markdown.indexOf('## Page 1') < markdown.indexOf('## Page 2'));
  assert.ok(markdown.indexOf('## Page 2') < markdown.indexOf('## Page 3'));
  assert.match(markdown, /## Page 3[\s\S]*Third page has more source text\./);
  assert.equal((markdown.match(/^## Page \d+$/gm) ?? []).length, 4); // includes the untrusted source heading
  const doc = sourceDocFromText(markdown, 'pdf', extraction.nativeLocations);
  const spoofedPageHeading = doc.spans.find((span) => span.text.includes('Page 99'))!;
  assert.deepEqual(spoofedPageHeading.sourceLocation, { kind: 'pdf-page', page: 3 }, 'visible page-like source text cannot replace the parser-authored page locator');
  assert.ok(sourceDocFromText(markdown, 'pdf').spans.every((span) => !span.sourceLocation), 'Markdown-looking headings alone do not establish native page provenance');
  const page3 = doc.spans.find((span) => span.kind === 'heading' && span.text.includes('Page 3'));
  const page3Text = doc.spans.find((span) => span.kind === 'paragraph' && span.text.includes('Third page'));
  assert.ok(page3 && page3Text && page3.startLine < page3Text.startLine);
  assert.deepEqual(page3Text?.sourceLocation, { kind: 'pdf-page', page: 3 });
  assert.deepEqual(resolveSourceEvidence(doc, page3Text!.id, 'Third page')?.sourceLocation, { kind: 'pdf-page', page: 3 });
});

test('source identity changes when the same bytes are parsed under a different format', () => {
  const text = '# Same title\n\nSame factual source text.';
  assert.notEqual(sourceDocFromText(text, 'text').sourceId, sourceDocFromText(text, 'markdown').sourceId);
});
