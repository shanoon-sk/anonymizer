// Generates Microsoft Store screenshots (1366×768 window @2x) from the real app with fictional demo data.
// Run after `npm run build`: node scripts/store-screenshots.mjs
import { _electron as electron } from 'playwright'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'

const out = join(process.cwd(), 'store', 'screenshots')
const dir = await mkdtemp(join(tmpdir(), 'anon-store-'))

async function docx(name, paragraphs) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  const p = join(dir, name)
  await writeFile(p, await zip.generateAsync({ type: 'uint8array' }))
  return p
}

// Fictional demo data only
const files = [
  await docx('Zmluva o vedení účtovníctva.docx', [
    'Poskytovateľ: Účtovníctvo Plus s.r.o., so sídlom Mlynská 28, 040 01 Košice, IČO: 36631124, DIČ: 2020100005',
    'Objednávateľ: Ing. Martin Kováč, nar. 12.03.1990, r. č. 900312/0005, tel. 0905 123 456, kovac@example.sk',
    'Platby na IBAN SK89 7500 0000 0000 1234 5671, VS: 2024001.'
  ]),
  await docx('Výplatné pásky – november.docx', [
    'Zamestnanec Branislav Hrušovský, IBAN SK31 1200 0000 1987 4263 7541, r. č. 850101/0001.',
    'Zamestnankyňa Mgr. Petra Horváthová, bytom Hlavná 12, 811 01 Bratislava, tel. +421 911 222 333.'
  ]),
  await docx('Faktúry klienta Gama Delta.docx', [
    'Odberateľ: Gama Delta s.r.o., IČO 35763469, IČ DPH SK2020100005, e-mail fakturacia@gamadelta.sk.',
    'Kontaktná osoba: Jana Malá, tel. 02/123 456 78.'
  ])
]

const app = await electron.launch({ args: ['.'], env: { ...process.env, ANON_USER_DATA: await mkdtemp(join(tmpdir(), 'anon-store-prof-')) } })
const win = await app.firstWindow()
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1366, 768))
await win.waitForSelector('text=Anonymizovať')
await win.waitForTimeout(600)
await win.screenshot({ path: join(out, '1-start.png') })

await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p }) }, files)
await win.click('text=Vybrať súbory')
await win.waitForSelector('text=Faktúry klienta Gama Delta.docx')
await win.waitForTimeout(400)
await win.screenshot({ path: join(out, '2-subory.png') })

await win.click('button:has-text("Anonymizovať")')
await win.waitForFunction(() => document.querySelectorAll('main li').length === 3 && [...document.querySelectorAll('main li')].every((li) => /Skryt|Nenašli/.test(li.innerText)), null, { timeout: 120000 })
await win.waitForTimeout(500)
await win.screenshot({ path: join(out, '3-vysledok.png') })
await app.close()
console.log('screenshots →', out)
