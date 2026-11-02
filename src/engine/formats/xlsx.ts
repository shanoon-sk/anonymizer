import type { EntityType } from '../types'
import type { DocumentAdapter } from './adapter'
import { fold } from '../text'
import {
  addRelTargets,
  CHART_SCAN,
  decodeXml,
  DRAWING_SCAN,
  encodeXml,
  OoxmlPackage,
  paragraphEdits,
  paragraphText,
  scanParagraphs,
  type ScanConfig
} from './ooxml'

const SST_SCAN: ScanConfig = { textTags: ['t'], paraEnd: ['</si>'] }
const INLINE_SCAN: ScanConfig = { textTags: ['t'], paraEnd: ['</is>'] }
const COMMENT_SCAN: ScanConfig = { textTags: ['t'], paraEnd: ['</comment>'] }

/** Column header → data type. Order matters (more specific first). Matched on folded header text. */
const HEADER_RULES: [RegExp, EntityType][] = [
  [/rodne cislo|^r\.? ?c\.?$|birth number/, 'RODNE_CISLO'],
  [/datum narodenia|dat\.? ?nar|date of birth|^narodeny|^narodena/, 'DATUM_NAR'],
  [/ic ?dph|vat/, 'IC_DPH'],
  [/(?:^dic\b)|(?:danove identifikacne)/, 'DIC'],
  [/(?:^ico\b)|(?:identifikacne cislo)|(?:company id)/, 'ICO'],
  [/iban/, 'IBAN'],
  [/bic|swift/, 'BIC'],
  [/cislo uctu|bankovy ucet|bankove spojenie|account number/, 'UCET'],
  [/e-?mail/, 'EMAIL'],
  [/telef|^tel\.?$|mobil|phone/, 'TELEFON'],
  [/^psc$|postove smerovacie|zip/, 'PSC'],
  [/adresa|ulica|bydlisko|^sidlo|trvaly pobyt|address|street/, 'ADRESA'],
  [/cislo op|obciansky|cislo pasu|cislo dokladu|passport/, 'DOKLAD'],
  [/^ecv|^spz|evidencne cislo vozidla/, 'SPZ'],
  [/obchodne meno|nazov firmy|nazov spolocnosti|^firma|^spolocnost|^odberatel|^dodavatel|^partner|company/, 'FIRMA'],
  [/meno|priezvisko|zamestnan|^osoba|^klient|^name|full name|surname|employee/, 'OSOBA']
]

export function headerType(header: string): EntityType | undefined {
  const h = fold(header).trim().replace(/\s+/g, ' ')
  if (!h || h.length > 40) return undefined
  return HEADER_RULES.find(([re]) => re.test(h))?.[1]
}

function colOf(ref: string): string {
  return ref.replace(/\d+$/, '')
}
function rowOf(ref: string): number {
  return parseInt(ref.replace(/^[A-Z]+/, ''), 10)
}

interface Cell {
  start: number
  end: number
  ref: string
  attrs: string
  type: string
  inner: string
  innerStart: number
}

function parseCells(xml: string): Cell[] {
  const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  const cells: Cell[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const attrs = m[1]
    const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]
    if (!ref || m[2] === undefined) continue
    const type = /\bt="([^"]*)"/.exec(attrs)?.[1] ?? 'n'
    cells.push({ start: m.index, end: m.index + m[0].length, ref, attrs, type, inner: m[2], innerStart: m.index + m[0].indexOf('>') + 1 })
  }
  return cells
}

const vOf = (inner: string) => /<v>([^<]*)<\/v>/.exec(inner)?.[1]

/** Rebuild a cell as an inline string with the given text, keeping its style and position. */
function inlineCell(c: Cell, text: string): string {
  const attrs = c.attrs.replace(/\s+t="[^"]*"/, '')
  return `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${encodeXml(text)}</t></is></c>`
}

export async function loadXlsx(buf: Uint8Array): Promise<DocumentAdapter> {
  const pkg = await OoxmlPackage.load(buf)
  if (!pkg.zip.file('xl/workbook.xml')) throw new Error('Súbor nie je platný zošit Excel (.xlsx).')
  const warnings: string[] = []

  await pkg.scrubDocProps()
  // Comment authors / threaded-comment people
  for (const f of pkg.files(/^xl\/comments\d*\.xml$/)) {
    const xml = await pkg.read(f)
    pkg.setXml(f, xml.replace(/(<author>)[^<]*(<\/author>)/g, '$1Anonym$2'))
  }
  await pkg.replaceAttrs(/^xl\/persons\/.*\.xml$/, ['displayName', 'userId'], 'Anonym')

  // Shared strings (texts used by cells)
  const sharedTexts: string[] = []
  if (pkg.zip.file('xl/sharedStrings.xml')) {
    const sst = await pkg.read('xl/sharedStrings.xml')
    // Index each <si> so cells can resolve their text (also empty ones keep indices aligned).
    const siRe = /<si>([\s\S]*?)<\/si>|<si\/>/g
    let m: RegExpExecArray | null
    while ((m = siRe.exec(sst))) {
      const inner = m[1] ?? ''
      // Ignore phonetic runs when resolving the text
      const clean = inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
      sharedTexts.push(decodeXml([...clean.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => x[1]).join('')))
    }
    await pkg.addParagraphs('xl/sharedStrings.xml', SST_SCAN)
  }

  // Sheets
  const sheetNameEdits: { from: string; seg: number }[] = []
  for (const f of pkg.files(/^xl\/worksheets\/sheet\d+\.xml$/)) {
    const xml = await pkg.read(f)
    const cells = parseCells(xml)
    const textOf = (c: Cell): string | undefined => {
      if (c.type === 's') {
        const v = vOf(c.inner)
        return v !== undefined ? sharedTexts[+v] : undefined
      }
      if (c.type === 'inlineStr') return decodeXml([...c.inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => x[1]).join(''))
      const v = vOf(c.inner)
      return v === undefined ? undefined : decodeXml(v)
    }

    // Header row: the first row (within the first 10) that contains a recognised header.
    const headers = new Map<string, string>()
    let headerRow = 0
    const rows = [...new Set(cells.map((c) => rowOf(c.ref)))].sort((a, b) => a - b).slice(0, 10)
    for (const r of rows) {
      const rowCells = cells.filter((c) => rowOf(c.ref) === r && (c.type === 's' || c.type === 'inlineStr' || c.type === 'str'))
      if (rowCells.some((c) => headerType(textOf(c) ?? ''))) {
        headerRow = r
        for (const c of rowCells) headers.set(colOf(c.ref), textOf(c) ?? '')
        break
      }
    }
    if (!headerRow && rows.length) {
      const r = rows[0]
      for (const c of cells.filter((c) => rowOf(c.ref) === r && (c.type === 's' || c.type === 'inlineStr'))) headers.set(colOf(c.ref), textOf(c) ?? '')
    }

    for (const c of cells) {
      const row = rowOf(c.ref)
      const header = headers.get(colOf(c.ref))
      const forced = row > headerRow && headerRow > 0 && header ? headerType(header) : undefined
      const hasFormula = /<f\b/.test(c.inner)
      const text = textOf(c)
      if (text === undefined || !text.trim()) continue
      const context = header && row !== headerRow ? header : undefined

      if (c.type === 's') {
        // The shared string itself is processed separately; typed columns are rewritten inline so
        // the value is hidden here even if the shared text is reused elsewhere.
        if (forced) pkg.addSegment({ text, forceType: forced }, (res) => {
          if (res.output !== text) pkg.addEdit(f, { start: c.start, end: c.end, text: inlineCell(c, res.output) })
        })
        continue
      }
      if (c.type === 'inlineStr') {
        if (forced) {
          pkg.addSegment({ text, forceType: forced }, (res) => {
            if (res.output !== text) pkg.addEdit(f, { start: c.start, end: c.end, text: inlineCell(c, res.output) })
          })
        } else {
          for (const p of scanParagraphs(xml, INLINE_SCAN, c.innerStart, c.end)) {
            const pt = paragraphText(p)
            pkg.addSegment({ text: pt, context }, (res) => paragraphEdits(p, res).forEach((e) => pkg.addEdit(f, e)))
          }
        }
        continue
      }
      if (hasFormula && c.type !== 'str') continue // computed numbers – leave formulas intact
      if (c.type === 'b' || c.type === 'e') continue
      if (c.type === 'n' && !forced) {
        // Plain numbers are only interesting when they look like identifiers (IČO, phone, account…)
        if (!/^\d{6,}$/.test(text)) continue
      }
      pkg.addSegment({ text, context, forceType: forced }, (res) => {
        if (res.output === text) return
        if (c.type === 'str') {
          // Formula with a string result: update the cached value only
          const v = /<v>([^<]*)<\/v>/.exec(c.inner)
          if (v) {
            const s = c.innerStart + v.index + 3
            pkg.addEdit(f, { start: s, end: s + v[1].length, text: encodeXml(res.output) })
          }
        } else {
          pkg.addEdit(f, { start: c.start, end: c.end, text: inlineCell(c, res.output) })
        }
      })
    }

    // Header/footer texts of the sheet (&L&C&R codes stay intact)
    await pkg.addValues(f, /<(?:oddHeader|oddFooter|evenHeader|evenFooter|firstHeader|firstFooter)>([^<]*)</g)
  }

  // Sheet names – Excel forbids [ ] in names, so the placeholder brackets are dropped.
  {
    const wb = await pkg.read('xl/workbook.xml')
    const re = /<sheet\b[^>]*?\sname="([^"]*)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(wb))) {
      const name = decodeXml(m[1])
      const seg = pkg.segments.length
      pkg.addSegment({ text: name }, null)
      sheetNameEdits.push({ from: name, seg })
    }
  }

  // Comments, threaded comments, drawings (text boxes), charts, pivot caches
  for (const f of pkg.files(/^xl\/comments\d*\.xml$/)) await pkg.addParagraphs(f, COMMENT_SCAN)
  for (const f of pkg.files(/^xl\/threadedComments\/.*\.xml$/)) await pkg.addValues(f, /<text>([^<]*)<\/text>/g)
  for (const f of pkg.files(/^xl\/drawings\/.*\.xml$/)) await pkg.addParagraphs(f, DRAWING_SCAN)
  for (const f of pkg.files(/^xl\/charts\/.*\.xml$/)) {
    await pkg.addParagraphs(f, CHART_SCAN)
    await pkg.addParagraphs(f, DRAWING_SCAN)
  }
  for (const f of pkg.files(/^xl\/pivotCache\/.*\.xml$/)) await pkg.addValues(f, /<s\b[^>]*?\sv="([^"]*)"/g)
  if (pkg.files(/^xl\/externalLinks\//).length) warnings.push('Zošit obsahuje externé prepojenia – skontrolujte ich ručne.')
  await addRelTargets(pkg)

  return {
    segments: pkg.segments,
    outputExt: 'xlsx',
    warnings,
    async write(results) {
      // Rename sheets + references in formulas / defined names
      const renames: [string, string][] = []
      for (const { from, seg } of sheetNameEdits) {
        const r = results[seg]
        if (!r.entities.length) continue
        const to = r.output.replace(/[[\]:*?/\\]/g, '').slice(0, 31) || 'Hárok'
        if (to !== from) renames.push([from, to])
      }
      if (!renames.length) return pkg.write(results)
      return pkg.write(results, (file, xml) => {
        if (file === 'xl/workbook.xml') {
          for (const [from, to] of renames) {
            xml = xml.replace(new RegExp(`(<sheet\\b[^>]*?\\sname=")${escapeRe(encodeXml(from))}(")`), `$1${encodeXml(to)}$2`)
          }
        }
        if (file === 'docProps/app.xml') {
          for (const [from, to] of renames) xml = xml.split(`<vt:lpstr>${encodeXml(from)}</vt:lpstr>`).join(`<vt:lpstr>${encodeXml(to)}</vt:lpstr>`)
          return xml
        }
        return /^xl\/(workbook|worksheets\/|charts\/|pivotCache\/)/.test(file) ? renameRefs(xml, renames) : xml
      })
    }
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Rewrite sheet references inside formulas: 'Old Name'!A1 / OldName!A1 → 'New'!A1 */
function renameRefs(xml: string, renames: [string, string][]): string {
  return xml.replace(/<(f|c:f|definedName)(\b[^>]*)>([^<]*)<\/\1>/g, (all, tag: string, attrs: string, body: string) => {
    let b = decodeXml(body)
    for (const [from, to] of renames) {
      const quotedFrom = `'${from.replace(/'/g, "''")}'!`
      const quotedTo = `'${to.replace(/'/g, "''")}'!`
      b = b.split(quotedFrom).join(quotedTo)
      if (/^[\p{L}_][\p{L}\d_.]*$/u.test(from)) b = b.replace(new RegExp(`(?<![\\p{L}\\d_.'])${escapeRe(from)}!`, 'gu'), quotedTo)
    }
    const enc = encodeXml(b)
    return enc === body ? all : `<${tag}${attrs}>${enc}</${tag}>`
  })
}
