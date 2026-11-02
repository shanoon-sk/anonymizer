import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
