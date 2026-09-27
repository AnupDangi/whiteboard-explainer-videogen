"""Regenerate the synthetic intake fixtures (python3 make_fixtures.py; needs reportlab).

Every value here is invented test data for code-contract tests of the readers
in plan/intake/. None of it is lesson content, a Simi reference or a golden.
"""
import base64
import zipfile

# 1x1 PNG, padded past the 256-byte "spacer image" threshold with a tEXt chunk.
PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
)

CT = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/></Types>'


def core(title):
    return f'<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{title}</dc:title></cp:coreProperties>'


def docx(path):
    w = 'xmlns:w="w" xmlns:m="m" xmlns:wp="wp" xmlns:a="a" xmlns:r="r"'
    body = f'''<w:document {w}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Valve Basics</w:t></w:r></w:p>
<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:r><w:t>Controlled content survives.</w:t></w:r></w:p></w:sdtContent></w:sdt>
<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r><w:del><w:r><w:delText>REMOVED </w:delText></w:r></w:del><w:ins><w:r><w:t xml:space="preserve">inserted </w:t></w:r></w:ins><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE \\* MERGEFORMAT</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve">text with a ﬁlter and soft­hyphen.</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Photo</w:t></w:r><w:r><w:t>synthesis</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rate</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData><a:blip r:embed="rIdImg"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
</w:body></w:document>'''
    rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="image" Target="media/image1.png"/></Relationships>'
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('[Content_Types].xml', CT)
        z.writestr('docProps/core.xml', core('Valve Handbook'))
        z.writestr('word/document.xml', body)
        z.writestr('word/_rels/document.xml.rels', rels)
        z.writestr('word/media/image1.png', PNG + b'\0' * 400)


def slide(body, hidden=False):
    show = ' show="0"' if hidden else ''
    return f'<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"{show}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>{body}</p:spTree></p:cSld></p:sld>'


def sp(text, placeholder=None):
    ph = f'<p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="{placeholder}"/></p:nvPr></p:nvSpPr>' if placeholder else ''
    return f'<p:sp>{ph}<p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>'


def pptx(path):
    first = slide(sp('Valve Overview', 'title') + '<p:grpSp><p:grpSpPr/>' + sp('Grouped shape text') + '</p:grpSp>' + '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3"/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill></p:pic>')
    second = slide(sp('Second in presentation order'))
    hidden = slide(sp('Hidden slide text'), hidden=True)
    pres = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst></p:presentation>'
    pres_rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="slide" Target="slides/slide2.xml"/><Relationship Id="rId3" Type="slide" Target="slides/slide3.xml"/></Relationships>'
    slide_rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="image" Target="../media/image1.png"/></Relationships>'
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('[Content_Types].xml', CT)
        z.writestr('docProps/core.xml', core('PowerPoint Presentation'))
        z.writestr('ppt/presentation.xml', pres)
        z.writestr('ppt/_rels/presentation.xml.rels', pres_rels)
        z.writestr('ppt/slides/slide1.xml', second)
        z.writestr('ppt/slides/slide2.xml', first)
        z.writestr('ppt/slides/_rels/slide2.xml.rels', slide_rels)
        z.writestr('ppt/slides/slide3.xml', hidden)
        z.writestr('ppt/media/image1.png', PNG + b'\0' * 400)


def pdf(path):
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas
    pdfmetrics.registerFont(TTFont('DV', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
    c = canvas.Canvas(path, pagesize=letter, invariant=1)
    c.setTitle('Synthetic Valve Study')
    width, height = letter
    pages = [
        ['A Study of Valves', '', 'The valve opens when the pump raises', 'the pressure. This effi-', 'cient design reduces the ﬂow loss', 'described in the tables below.'],
        [],
        ['Final remarks close the study with', 'a short summary of the valve.'],
    ]
    for number, lines in enumerate(pages, start=1):
        c.setFont('DV', 9)
        c.drawString(72, height - 40, 'Journal of Synthetic Tests - running header')
        c.setFont('DV', 10)
        y = height - 90
        for line in lines:
            if line:
                c.drawString(72, y, line)
            y -= 13
        c.setFont('DV', 9)
        c.drawString(width / 2, 40, str(number))
        c.showPage()
    c.save()


if __name__ == '__main__':
    docx('valve.docx')
    pptx('valve.pptx')
    pdf('valve.pdf')
