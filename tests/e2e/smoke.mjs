// E2E smoke test: launches the built Electron app, runs a real anonymization through the UI
// bridge, verifies results and that no network request left the app. `npm run build` first.
import { _electron as electron } from 'playwright'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'

const shotsDir = process.argv[2] ?? tmpdir()
const dir = await mkdtemp(join(tmpdir(), 'anon-e2e-'))
const zip = new JSZip()
zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">Zamestnanec Branislav Hrušovský, IBAN SK31 1200 0000 1987 4263 7541, tel. 0905 123 456.</w:t></w:r></w:p></w:body></w:document>')
const input = join(dir, 'test.docx')
await writeFile(input, await zip.generateAsync({ type: 'uint8array' }))

// Pass a packaged executable path via APP_EXE to test an installer build instead of ./out
const app = process.env.APP_EXE
  ? await electron.launch({ executablePath: process.env.APP_EXE, env: { ...process.env, ANON_USER_DATA: join(tmpdir(), 'anon-e2e-profile') } })
  : await electron.launch({ args: ['.'], env: { ...process.env, ANON_USER_DATA: join(tmpdir(), 'anon-e2e-profile') } })
const blocked = []
const win = await app.firstWindow()
win.on('request', (r) => { if (!/^(file|data|blob|devtools):/.test(r.url())) blocked.push(r.url()) })
await win.waitForSelector('text=Anonymizovať')
console.log('title:', await win.title())
await win.screenshot({ path: join(shotsDir, 'ui-empty.png') })

const results = await win.evaluate(async (p) => window.anonymizer.process([p], { types: ['OSOBA', 'IBAN', 'TELEFON'], customTerms: [], useNer: true, exportText: true }, null), input)
console.log('results:', JSON.stringify(results))
const out = await JSZip.loadAsync(await readFile(results[0].outputs[0]))
const xml = await out.file('word/document.xml').async('string')
console.log('output text:', xml.match(/<w:t[^>]*>([^<]*)/)[1])
if (xml.includes('Hrušovský') || xml.includes('SK31')) throw new Error('secret leaked')

// Drive the real UI: stub the native file dialog, pick the file, click "Anonymizovať"
const input2 = join(dir, 'zmluva-klient.docx')
await writeFile(input2, await zip.generateAsync({ type: 'uint8array' }))
await app.evaluate(({ dialog }, paths) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
}, [input2])
await win.click('text=Vybrať súbory')
await win.click('button:has-text("Anonymizovať")')
await win.waitForSelector('text=/Skryt|Chyba|Nenašli/', { timeout: 120000 }).catch(async (e) => { await win.screenshot({ path: join(shotsDir, 'ui-fail.png') }); throw e })
await win.screenshot({ path: join(shotsDir, 'ui-result.png') })
console.log('UI flow OK')
console.log('blocked/external requests:', blocked.length)
if (blocked.length) throw new Error('external requests: ' + blocked.join(', '))
await app.close()
