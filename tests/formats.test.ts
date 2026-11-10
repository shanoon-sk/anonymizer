import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import * as mupdf from 'mupdf'
import { processFiles } from '../src/engine/processor'
import { createOcr } from '../src/engine/ocr'
import { DEFAULT_SELECTED, type AnonymizeOptions } from '../src/shared/entities'

const OPTS: AnonymizeOptions = { types: DEFAULT_SELECTED, customTerms: [], exportText: true, useNer: false }
const tessdata = join(__dirname, '..', 'resources', 'tessdata')
const hasTess = existsSync(join(tessdata, 'slk.traineddata'))

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'anon-test-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

// ─── Fixture builders ───────────────────────────────────────────────────────

async function makeDocx(path: string) {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:jan.novak@firma.sk" TargetMode="External"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`
  )
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>` +
      `<w:p><w:r><w:t xml:space="preserve">Zmluvu uzatvára pán </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Ján</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> Nov</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ák</w:t></w:r><w:r><w:t xml:space="preserve">, r. č. 850101/0001 &amp; IBAN SK31 1200 0000 1987 4263 7541.</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t xml:space="preserve">Kontakt: </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>jan.novak@firma.sk</w:t></w:r></w:hyperlink></w:p>` +
      `<w:p><w:ins w:id="1" w:author="Mária Kováčová" w:date="2024-01-01T00:00:00Z"><w:r><w:t>Novák súhlasí.</w:t></w:r></w:ins></w:p>` +
      `<w:sectPr><w:footerReference w:type="default" r:id="rId6"/></w:sectPr></w:body></w:document>`
  )
  zip.file(
    'word/footer1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:ftr ${W}><w:p><w:r><w:t>Alfa Beta s.r.o., IČO 35763469</w:t></w:r></w:p></w:ftr>`
  )
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Ján Novák</dc:creator><cp:lastModifiedBy>Ján Novák</cp:lastModifiedBy></cp:coreProperties>`
  )
  await writeFile(path, await zip.generateAsync({ type: 'uint8array' }))
}

async function makeXlsx(path: string) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Ján Novák'
  const ws = wb.addWorksheet('Peter Malý')
  ws.addRow(['Meno', 'IČO', 'Telefón', 'Poznámka', 'Suma'])
  ws.addRow(['Peter Malý', 35763469, '0905123456', 'Platba z účtu SK31 1200 0000 1987 4263 7541', 120.5])
  ws.addRow(['Eva Veľká', 36631124, '+421 911 222 333', 'kontakt eva@velka.sk', 99])
  ws.getCell('D2').note = 'Overiť u Peter Malý'
  const s2 = wb.addWorksheet('Súhrn')
  s2.getCell('A1').value = { formula: "SUM('Peter Malý'!E2:E3)", result: 219.5 }
  s2.getCell('A2').value = 'Spracovala Eva Veľká'
  await wb.xlsx.writeFile(path)
}

/** WinAnsi-encode a string for a PDF literal (enough for Slovak test texts). */
function winAnsi(s: string): string {
  const map: Record<string, number> = { á: 0xe1, é: 0xe9, í: 0xed, ó: 0xf3, ú: 0xfa, ý: 0xfd, ä: 0xe4, ô: 0xf4, Č: 0x43, č: 0x63, ž: 0x9e, Ž: 0x8e, š: 0x9a, Š: 0x8a }
  return [...s].map((c) => (map[c] ? '\\' + map[c].toString(8) : c.replace(/[\\()]/g, '\\$&'))).join('')
}

function makeTextPdfDoc(lines: string[]): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument()
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'), 'Latin')
  const res = doc.addObject({ Font: { F1: font } })
  const content = lines.map((l, i) => `BT /F1 14 Tf 50 ${780 - i * 28} Td (${winAnsi(l)}) Tj ET`).join('\n')
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, res, content))
  return doc
}

const PDF_LINES = [
  'Faktura c. 2024015',
  'Odberatel: Jan Novak, Hlavna 12, 811 01 Bratislava',
  'ICO: 35763469   DIC: 2020100005',
  'IBAN: SK31 1200 0000 1987 4263 7541',
  'E-mail: jan.novak@firma.sk, tel. +421 905 123 456'
]

async function makePdf(path: string) {
  const doc = makeTextPdfDoc(PDF_LINES)
  doc.setMetaData('info:Author', 'Jan Novak')
  await writeFile(path, doc.saveToBuffer('compress').asUint8Array())
}

async function makeScannedPdf(path: string) {
  const src = makeTextPdfDoc(PDF_LINES)
  const scale = 200 / 72
  const pix = src.loadPage(0).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false)
  const doc = new mupdf.PDFDocument()
  const img = doc.addImage(new mupdf.Image(pix))
  const res = doc.addObject({ XObject: { Im0: img } })
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, res, 'q 595 0 0 842 0 0 cm /Im0 Do Q'))
  await writeFile(path, doc.saveToBuffer('compress').asUint8Array())
}

function pdfText(buf: Uint8Array): string {
  const doc = mupdf.Document.openDocument(buf, 'application/pdf')
  let t = ''
  for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText('preserve-whitespace').asText()
  return t
}

async function zipText(path: string): Promise<string> {
  const zip = await JSZip.loadAsync(await readFile(path))
  let all = ''
  for (const f of Object.keys(zip.files)) if (!zip.files[f].dir && /\.(xml|rels)$/.test(f)) all += await zip.file(f)!.async('string')
  return all
}

const noop = () => {}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DOCX', () => {
  it('anonymizes body, split runs, hyperlinks, footer, tracked-change author and metadata', async () => {
    const input = join(dir, 'zmluva.docx')
    await makeDocx(input)
    const [res] = await processFiles([input], OPTS, null, {}, noop)
    expect(res.error).toBeUndefined()
    const xml = await zipText(res.outputs[0])
    for (const secret of ['Novák', 'Nov</w:t>', '850101', 'SK31', 'jan.novak', '35763469', 'Kováčová', 'Alfa Beta'])
      expect(xml, secret).not.toContain(secret)
    expect(xml).toContain('[OSOBA_1]')
    expect(xml).toContain('mailto:[EMAIL_1]')
    expect(xml).toContain('<w:b/>') // formatting preserved
    expect(xml).toContain('&amp;') // entities preserved
    // the result is still a valid zip with a document
    const zip = await JSZip.loadAsync(await readFile(res.outputs[0]))
    expect(zip.file('word/document.xml')).toBeTruthy()
  })
})

describe('output file name', () => {
  it('hides names found in the documents, with the same placeholders', async () => {
    const input = join(dir, 'zmluva – Novák - final.docx')
    await makeDocx(input)
    const [res] = await processFiles([input], OPTS, null, {}, noop)
    expect(res.error).toBeUndefined()
    expect(basename(res.outputs[0])).toBe('zmluva – [OSOBA_1] - final_anonymizovane.docx')
  })

  it('also finds names glued together in the name ("fa_IngJanNovak_2024")', async () => {
    const input = join(dir, 'fa_JanNovak_2024.docx')
    await makeDocx(input)
    const [res] = await processFiles([input], OPTS, null, {}, noop)
    expect(basename(res.outputs[0])).toBe('fa [OSOBA_1] 2024_anonymizovane.docx')
  })

  it('keeps the name untouched when there is nothing to hide', async () => {
    const input = join(dir, 'zmluva_o_dielo_v2.docx')
    await makeDocx(input)
    const [res] = await processFiles([input], OPTS, null, {}, noop)
    expect(basename(res.outputs[0])).toBe('zmluva_o_dielo_v2_anonymizovane.docx')
  })
})

describe('XLSX', () => {
  it('anonymizes typed columns, numbers, comments, sheet names and keeps formulas working', async () => {
    const input = join(dir, 'mzdy.xlsx')
    await makeXlsx(input)
    const [res] = await processFiles([input], OPTS, null, {}, noop)
    expect(res.error).toBeUndefined()
    const xml = await zipText(res.outputs[0])
    for (const secret of ['Peter', 'Malý', 'Veľká', '35763469', '36631124', '0905123456', '911 222', 'eva@velka.sk', 'SK31 1200', 'Ján Novák'])
      expect(xml, secret).not.toContain(secret)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(res.outputs[0])
    const ws = wb.worksheets[0]
    expect(ws.name).toBe('OSOBA_1')
    expect(ws.getCell('A2').value).toBe('[OSOBA_1]')
    expect(ws.getCell('B2').value).toBe('[ICO_1]')
    expect(ws.getCell('E2').value).toBe(120.5) // amounts untouched
    expect(ws.getCell('A1').value).toBe('Meno') // headers untouched
    const f = wb.getWorksheet('Súhrn')!.getCell('A1').value as { formula: string }
    expect(f.formula).toBe("SUM('OSOBA_1'!E2:E3)")
    expect(wb.getWorksheet('Súhrn')!.getCell('A2').value).toBe('Spracovala [OSOBA_2]')
  })
})

describe('PDF', () => {
  it('truly removes text (not just covers it), adds placeholders and scrubs metadata', async () => {
    const input = join(dir, 'faktura.pdf')
    await makePdf(input)
    const [res] = await processFiles([input], OPTS, null, {}, noop)
    expect(res.error).toBeUndefined()
    const buf = new Uint8Array(await readFile(res.outputs[0]))
    const text = pdfText(buf)
    for (const secret of ['Novak', '35763469', '2020100005', 'SK31', 'jan.novak', '905 123', 'Hlavna'])
      expect(text, secret).not.toContain(secret)
    expect(text).toContain('[ICO_1]')
    expect(text).toContain('Faktura c. 2024015')
    // Raw bytes must not contain the secrets either (old content streams garbage-collected)
    const raw = Buffer.from(mupdf.Document.openDocument(buf, 'application/pdf').asPDF()!.saveToBuffer('decompress').asUint8Array()).toString('latin1')
    expect(raw).not.toContain('35763469')
    expect(raw).not.toContain('Jan Novak')
    const md = await readFile(res.outputs[1], 'utf8')
    expect(md).toContain('## Strana 1')
    expect(md).toContain('[IBAN_1]')
  })

  // LLM ingestion (pdf.js, PyMuPDF…) reads text in content-stream order: placeholders must sit where the value was.
  const TABLE = [
    'BT /F1 12 Tf 50 780 Td (Obchodne meno) Tj ET',
    'BT /F1 12 Tf 250 780 Td (Ing. Jan Novak) Tj ET',
    'BT /F1 12 Tf 50 760 Td (ICO) Tj ET',
    'BT /F1 12 Tf 250 760 Td (35763469) Tj ET',
    'BT /F1 12 Tf 50 740 Td (Platba od Jan Novak prijata dna 1. 2. 2024.) Tj ET'
  ].join('\n')
  const EXPECTED_ORDER = 'Obchodne meno [OSOBA_1] ICO [ICO_1] Platba od [OSOBA_1] prijata dna 1. 2. 2024.'

  async function makeTablePdf(path: string, rotate: 0 | 90 = 0) {
    const doc = new mupdf.PDFDocument()
    const font = doc.addSimpleFont(new mupdf.Font('Helvetica'), 'Latin')
    const res = doc.addObject({ Font: { F1: font } })
    // Two pages: several re-recorded pages once broke MuPDF's de-duplication on save (blank pages).
    doc.insertPage(-1, doc.addPage([0, 0, 595, 842], rotate, res, TABLE))
    doc.insertPage(-1, doc.addPage([0, 0, 595, 842], rotate, res, TABLE))
    const page = doc.loadPage(0) as mupdf.PDFPage
    page.createLink([400, 50, 500, 70], 'https://www.example.org/manual')
    await writeFile(path, doc.saveToBuffer('compress').asUint8Array())
  }
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim()

  it('keeps placeholders in reading order in the text layer', async () => {
    const input = join(dir, 'tabulka.pdf')
    await makeTablePdf(input)
    const [res] = await processFiles([input], OPTS, null, {}, noop)
    expect(res.error).toBeUndefined()
    const buf = new Uint8Array(await readFile(res.outputs[0]))
    expect(flat(pdfText(buf))).toBe(`${EXPECTED_ORDER} ${EXPECTED_ORDER}`)
    const raw = Buffer.from(mupdf.Document.openDocument(buf, 'application/pdf').asPDF()!.saveToBuffer('decompress').asUint8Array()).toString('latin1')
    expect(raw).not.toContain('Novak')
    expect(raw).not.toContain('35763469')
  })

  it('places placeholders where the values were on rotated pages and keeps links', async () => {
    const input = join(dir, 'otocena.pdf')
    await makeTablePdf(input, 90)
    const [res] = await processFiles([input], OPTS, null, {}, noop)
    expect(res.error).toBeUndefined()
    const before = mupdf.Document.openDocument(new Uint8Array(await readFile(input)), 'application/pdf').loadPage(0)
    const after = mupdf.Document.openDocument(new Uint8Array(await readFile(res.outputs[0])), 'application/pdf').loadPage(0)
    expect(flat(after.toStructuredText('preserve-whitespace').asText())).toBe(EXPECTED_ORDER)
    const was = before.search('35763469', undefined)[0][0]
    const now = after.search('[ICO_1]', undefined)[0][0]
    expect(Math.abs(now[0] - was[0])).toBeLessThan(3)
    expect(Math.abs(now[1] - was[1])).toBeLessThan(3)
    expect(after.getLinks().map((l) => l.getURI())).toEqual(['https://www.example.org/manual'])
  })

  // Chrome prints fonts it cannot embed (e.g. variable fonts) as Type 3 fonts, which MuPDF's PDF writer
  // cannot write; ligatures ("fi") lost their text because the writer's ToUnicode comes from the font cmap.
  it('handles Type 3 fonts and ligatures without falling back, text stays readable', async () => {
    const input = join(dir, 'chrome.pdf')
    const doc = new mupdf.PDFDocument()
    const helv = doc.addSimpleFont(new mupdf.Font('Helvetica'), 'Latin')
    const box = '600 0 0 0 500 700 d1\n50 0 400 700 re f'
    const t3 = doc.addObject({
      Type: 'Font',
      Subtype: 'Type3',
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      FontBBox: [0, 0, 600, 700],
      FirstChar: 65,
      LastChar: 66,
      Widths: [600, 600],
      Encoding: { Type: 'Encoding', Differences: [65, doc.newName('A'), doc.newName('B')] },
      CharProcs: { A: doc.addStream(box, {}), B: doc.addStream(box, {}) },
      Resources: {}
    })
    const times = new mupdf.Font('Times-Roman')
    const t0 = doc.addFont(times)
    const fi = times.encodeCharacter(0xfb01)
    const hex = (g: number) => g.toString(16).padStart(4, '0')
    // ToUnicode: the ligature glyph maps to the two letters "fi"; "nan" maps to itself.
    const cids = [...'nan'].map((c) => times.encodeCharacter(c.charCodeAt(0)))
    const cmap = [
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /T def /CMapType 2 def',
      '1 begincodespacerange <0000> <FFFF> endcodespacerange',
      `${1 + 2} beginbfchar <${hex(fi)}> <00660069> <${hex(cids[0])}> <006E> <${hex(cids[1])}> <0061> endbfchar`,
      'endcmap CMapName currentdict /CMap defineresource pop end end'
    ].join('\n')
    t0.put('ToUnicode', doc.addStream(cmap, {}))
    const res = doc.addObject({ Font: { F1: helv, F3: t3, F0: t0 } })
    const content = [
      'BT /F3 14 Tf 50 800 Td (AB) Tj ET',
      'BT /F1 12 Tf 50 780 Td (Odberatel: Jan Novak, ICO 35763469) Tj ET',
      `BT /F0 12 Tf 50 760 Td <${hex(fi)}${cids.map(hex).join('')}> Tj ET`
    ].join('\n')
    doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, res, content))
    await writeFile(input, doc.saveToBuffer('compress').asUint8Array())

    const [res2] = await processFiles([input], OPTS, null, {}, noop)
    expect(res2.error).toBeUndefined()
    expect(res2.warnings.join(' ')).not.toContain('náhradný režim')
    const buf = new Uint8Array(await readFile(res2.outputs[0]))
    const text = flat(pdfText(buf))
    expect(text).toBe('AB Odberatel: [OSOBA_1], ICO [ICO_1] finan')
    // The Type 3 glyphs are still drawn (as paths): the page is not blank where they were.
    const pix = mupdf.Document.openDocument(buf, 'application/pdf').loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray)
    const px = pix.getPixels()
    const w = pix.getWidth()
    let dark = 0
    for (let y = 30; y < 42; y++) for (let x = 50; x < 66; x++) if (px[y * w + x] < 128) dark++
    expect(dark).toBeGreaterThan(50)
  })

  it('removes embedded attachments (e.g. ISDOC invoice XML) and reports it', async () => {
    const input = join(dir, 'faktura-isdoc.pdf')
    const doc = makeTextPdfDoc(PDF_LINES)
    const xml = '<Invoice><Name>Jan Novak</Name><ID>35763469</ID></Invoice>'
    const spec = doc.addEmbeddedFile('invoice.isdoc', 'application/xml', new TextEncoder().encode(xml), new Date(), new Date())
    // Register it in the catalog's name tree (addEmbeddedFile alone only creates the file object).
    const names = doc.newArray()
    names.push(doc.newString('invoice.isdoc'))
    names.push(spec)
    const tree = doc.newDictionary()
    tree.put('Names', names)
    const catNames = doc.newDictionary()
    catNames.put('EmbeddedFiles', tree)
    doc.getTrailer().get('Root').put('Names', catNames)
    await writeFile(input, doc.saveToBuffer('compress').asUint8Array())
    const src = mupdf.Document.openDocument(new Uint8Array(await readFile(input)), 'application/pdf').asPDF()!
    expect(Object.keys(src.getEmbeddedFiles())).toEqual(['invoice.isdoc'])
    const [res] = await processFiles([input], OPTS, null, {}, noop)
    expect(res.error).toBeUndefined()
    const out = mupdf.Document.openDocument(new Uint8Array(await readFile(res.outputs[0])), 'application/pdf').asPDF()!
    expect(Object.keys(out.getEmbeddedFiles())).toEqual([])
    const raw = Buffer.from(out.saveToBuffer('decompress').asUint8Array()).toString('latin1')
    expect(raw).not.toContain('<Invoice>')
    expect(res.warnings.join(' ')).toContain('invoice.isdoc')
  })

  it.skipIf(!hasTess)('OCRs scanned pages and redacts the image pixels', async () => {
    const input = join(dir, 'sken.pdf')
    await makeScannedPdf(input)
    const engine = await createOcr(tessdata)
    try {
      const [res] = await processFiles([input], OPTS, null, { ocr: async () => engine.ocr }, noop)
      expect(res.error).toBeUndefined()
      expect(res.ocrPages).toBe(1)
      const md = await readFile(res.outputs[1], 'utf8')
      expect(md).toContain('(OCR)')
      expect(md).not.toContain('35763469')
      expect(md).toMatch(/\[ICO_1\]/)
      expect(md).toMatch(/\[IBAN_1\]/)
      // The PDF gets an invisible OCR text layer in reading order, placeholders inline
      const layer = flat(pdfText(new Uint8Array(await readFile(res.outputs[0]))))
      expect(layer).toMatch(/Faktura c\. 2024015 Odberatel: \[OSOBA_1\]/)
      expect(layer).toMatch(/ICO: \[ICO_1\]/)
      expect(layer).not.toContain('35763469')
      // Re-OCR the output: the redacted values must be gone from the image itself
      const out = mupdf.Document.openDocument(new Uint8Array(await readFile(res.outputs[0])), 'application/pdf')
      const pix = out.loadPage(0).toPixmap(mupdf.Matrix.scale(300 / 72, 300 / 72), mupdf.ColorSpace.DeviceRGB, false)
      const words = await engine.ocr(pix.asPNG())
      const again = words.map((w) => w.text).join(' ')
      expect(again).not.toContain('35763469')
      expect(again).not.toMatch(/Novak/)
      expect(again).toContain('2024015')
    } finally {
      await engine.dispose()
    }
  })
})
