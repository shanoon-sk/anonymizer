import type * as MuPDF from 'mupdf'
import type { ResolvedEntity, SegmentResult } from '../types'
import type { DocumentAdapter } from './adapter'
import { BOX_RGB, INK_RGB, labelGeometry, type Overlay, rewritePageInOrder } from './pdf-inorder'

/** A word recognised by OCR, in pixel coordinates of the rendered page image. */
export interface OcrWord {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
  line: number
}
export type OcrFn = (png: Uint8Array) => Promise<OcrWord[]>

type Rect = [number, number, number, number]
type Quad = [number, number, number, number, number, number, number, number]

interface PageText {
  text: string
  /** One entry per UTF-16 unit of `text` – bounding quad (page space) or null for synthetic separators. */
  quads: (Quad | null)[]
  /** Line id per UTF-16 unit, used to split multi-line entities into one rect per line. */
  lines: number[]
  ocr: boolean
}

const OCR_DPI = 300
/** A page with less extractable text than this (but with images) is treated as scanned. */
const MIN_TEXT_CHARS = 25

let mupdfPromise: Promise<typeof MuPDF> | null = null
const loadMupdf = () => (mupdfPromise ??= import('mupdf'))

function extractPageText(mupdf: typeof MuPDF, page: MuPDF.PDFPage): PageText & { hasImages: boolean } {
  const st = page.toStructuredText('preserve-whitespace,preserve-images')
  let text = ''
  const quads: (Quad | null)[] = []
  const lines: number[] = []
  let line = 0
  let hasImages = false
  const push = (s: string, q: Quad | null) => {
    for (let i = 0; i < s.length; i++) {
      quads.push(q)
      lines.push(line)
    }
    text += s
  }
  st.walk({
    onImageBlock() {
      hasImages = true
    },
    beginLine() {
      line++
    },
    onChar(c, _origin, _font, _size, quad) {
      push(c, quad as unknown as Quad)
    },
    endLine() {
      push('\n', null)
    },
    endTextBlock() {
      push('\n', null)
    }
  })
  void mupdf
  return { text, quads, lines, ocr: false, hasImages }
}

async function ocrPageText(mupdf: typeof MuPDF, page: MuPDF.PDFPage, ocr: OcrFn): Promise<PageText> {
  const scale = OCR_DPI / 72
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
  const png = pix.asPNG()
  const words = await ocr(png)
  let text = ''
  const quads: (Quad | null)[] = []
  const lines: number[] = []
  let prevLine = -1
  for (const w of words) {
    if (!w.text.trim()) continue
    if (prevLine !== -1) {
      const sep = w.line !== prevLine ? '\n' : ' '
      text += sep
      quads.push(null)
      lines.push(prevLine)
    }
    const { x0, y0, x1, y1 } = w.bbox
    const r: Rect = [x0 / scale, y0 / scale, x1 / scale, y1 / scale]
    // Approximate per-character boxes by splitting the word box evenly
    const n = w.text.length
    for (let i = 0; i < n; i++) {
      const cx0 = r[0] + ((r[2] - r[0]) * i) / n
      const cx1 = r[0] + ((r[2] - r[0]) * (i + 1)) / n
      quads.push([cx0, r[1], cx1, r[1], cx0, r[3], cx1, r[3]])
      lines.push(w.line)
    }
    text += w.text
    prevLine = w.line
  }
  return { text, quads, lines, ocr: true }
}

/** One rectangle per text line covered by the entity, in reading order. */
function entityRects(pt: PageText, e: ResolvedEntity): { line: number; rect: Rect }[] {
  const byLine = new Map<number, Rect>()
  for (let i = e.start; i < e.end; i++) {
    const q = pt.quads[i]
    if (!q) continue
    const xs = [q[0], q[2], q[4], q[6]]
    const ys = [q[1], q[3], q[5], q[7]]
    const r: Rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    const cur = byLine.get(pt.lines[i])
    byLine.set(pt.lines[i], cur ? [Math.min(cur[0], r[0]), Math.min(cur[1], r[1]), Math.max(cur[2], r[2]), Math.max(cur[3], r[3])] : r)
  }
  return [...byLine.entries()].map(([line, rect]) => ({ line, rect }))
}

const pdfString = (s: string) => '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')'
const n = (x: number) => (Math.round(x * 100) / 100).toString()

export async function loadPdf(buf: Uint8Array, opts: { ocr?: OcrFn; onOcrPage?: (i: number, total: number) => void }): Promise<DocumentAdapter> {
  const mupdf = await loadMupdf()
  const base = mupdf.Document.openDocument(buf, 'application/pdf')
  if (base.needsPassword()) throw new Error('PDF je chránený heslom. Odstráňte heslo a skúste znova.')
  const doc = base.asPDF()
  if (!doc) throw new Error('Súbor nie je platný PDF dokument.')

  const pageAt = (i: number) => doc.loadPage(i) as MuPDF.PDFPage
  const warnings: string[] = []
  const count = doc.countPages()
  const pages: PageText[] = []
  let ocrPages = 0
  const scanned: number[] = []

  for (let i = 0; i < count; i++) {
    const page = pageAt(i)
    const t = extractPageText(mupdf, page)
    if (t.text.replace(/\s/g, '').length < MIN_TEXT_CHARS && t.hasImages) scanned.push(i)
    pages.push(t)
  }
  if (scanned.length) {
    if (opts.ocr) {
      for (const [k, i] of scanned.entries()) {
        opts.onOcrPage?.(k, scanned.length)
        pages[i] = await ocrPageText(mupdf, pageAt(i), opts.ocr)
        ocrPages++
      }
    } else {
      warnings.push(`${scanned.length} naskenovaných strán nebolo možné prečítať (OCR je vypnuté).`)
    }
  }

  // Form fields (filled tax forms etc.)
  const widgetSegs: { page: number; index: number; value: string }[] = []
  for (let i = 0; i < count; i++) {
    pageAt(i).getWidgets().forEach((w: MuPDF.PDFWidget, index: number) => {
      const v = w.getFieldType() === 'text' ? w.getValue() : ''
      if (v && v.trim()) widgetSegs.push({ page: i, index, value: v })
    })
  }

  const segments = [...pages.map((p) => ({ text: p.text })), ...widgetSegs.map((w) => ({ text: w.value }))]

  return {
    segments,
    outputExt: 'pdf',
    ocrPages,
    warnings,
    toText(results: SegmentResult[]) {
      return pages
        .map((p, i) => {
          const body = results[i].output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
          return `## Strana ${i + 1}${p.ocr ? ' (OCR)' : ''}\n\n${body}`
        })
        .join('\n\n')
    },
    async write(results: SegmentResult[]) {
      const font = new mupdf.Font('Helvetica')
      let fontRef: MuPDF.PDFObject | undefined
      let unicodeFontRef: MuPDF.PDFObject | undefined
      const widthAt1 = (s: string) => [...s].reduce((w, ch) => w + font.advanceGlyph(font.encodeCharacter(ch)), 0)
      /** Glyph ids for the Identity-H encoded Unicode font (ToUnicode makes it extractable). */
      const unicodeHex = (s: string) => [...s].map((ch) => font.encodeCharacter(ch.codePointAt(0)!).toString(16).padStart(4, '0')).join('')

      for (let i = 0; i < count; i++) {
        const ents = results[i].entities
        const page = pageAt(i)
        let removedAnnots = 0

        // Annotations may carry sensitive text (comments, links to mailto:…) – drop the risky ones.
        const values = ents.map((e) => e.text.toLowerCase())
        for (const a of page.getAnnotations()) {
          const type = a.getType()
          if (['Text', 'FreeText', 'Popup', 'FileAttachment', 'Sound', 'Stamp', 'Ink'].includes(type)) {
            const contents = (a.hasRect() ? a.getContents() : '') || ''
            if (contents || type !== 'Popup') {
              page.deleteAnnotation(a)
              removedAnnots++
            }
          }
        }
        for (const l of page.getLinks()) {
          const uri = l.getURI().toLowerCase()
          if (uri.startsWith('mailto:') || uri.startsWith('tel:') || values.some((v) => v && uri.includes(v))) page.deleteLink(l)
        }
        if (removedAnnots) warnings.push(`Strana ${i + 1}: odstránených ${removedAnnots} poznámok/anotácií.`)

        if (!ents.length) continue
        const pt = pages[i]
        const overlays: Overlay[] = []
        /** Character index → overlay covering it (drives the OCR text layer). */
        const ownerAt = new Map<number, number>()
        for (const e of ents) {
          const byLine = new Map<number, number>()
          entityRects(pt, e).forEach(({ line, rect: r }, k) => {
            const pad = 0.5
            byLine.set(line, overlays.length)
            overlays.push({ rect: [r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad], label: k === 0 ? e.placeholder : '' })
          })
          for (let c = e.start; c < e.end; c++) {
            const k = byLine.get(pt.lines[c])
            if (k !== undefined && pt.quads[c]) ownerAt.set(c, k)
          }
        }
        const redact = (textMethod: number) => {
          for (const o of overlays) page.createAnnotation('Redact').setRect(o.rect)
          page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_NONE, textMethod)
        }

        if (!pt.ocr) {
          // Pixels of images under the boxes first; then re-record the text with placeholders in stream order.
          redact(mupdf.PDFPage.REDACT_TEXT_NONE)
          if (rewritePageInOrder(mupdf, doc, i, overlays, font)) continue
          warnings.push(`Strana ${i + 1}: značky sú v texte PDF na konci strany (náhradný režim).`)
        }

        // Scanned pages (and the fallback): remove text with MuPDF's redaction and append boxes + labels.
        // Scanned pages also get an invisible OCR text layer in reading order with the labels inline,
        // so LLM tools read the page as text instead of a few stray placeholders.
        redact(mupdf.PDFPage.REDACT_TEXT_REMOVE)
        const inv = mupdf.Matrix.invert(page.getTransform())
        let cs = `q ${inv.map(n).join(' ')} cm\n`
        const drawn = new Set<number>()
        const box = (k: number) => {
          if (drawn.has(k)) return
          drawn.add(k)
          const { rect, label } = overlays[k]
          const [x0, y0, x1, y1] = rect
          cs += `${BOX_RGB.join(' ')} rg ${n(x0)} ${n(y0)} ${n(x1 - x0)} ${n(y1 - y0)} re f\n`
          if (!label) return
          const g = labelGeometry(rect, label, widthAt1)
          cs += `BT 0 Tr /FAnon ${n(g.size)} Tf ${INK_RGB.join(' ')} rg 1 0 0 -1 ${n(g.x)} ${n(g.y)} Tm ${pdfString(label)} Tj ET\n`
        }
        if (pt.ocr) {
          let runStart = -1
          const flush = (end: number) => {
            if (runStart < 0) return
            const run = pt.text.slice(runStart, end)
            const qs = pt.quads.slice(runStart, end).filter((q): q is Quad => !!q)
            runStart = -1
            if (!run.trim() || !qs.length) return
            const x0 = qs[0][0]
            const x1 = qs[qs.length - 1][2]
            const top = Math.min(...qs.map((q) => q[1]))
            const bottom = Math.max(...qs.map((q) => q[5]))
            const size = Math.max(1, bottom - top)
            const natural = widthAt1(run) * size
            const tz = natural > 0 ? (100 * (x1 - x0)) / natural : 100
            cs += `BT 3 Tr /FAnonU ${n(size)} Tf ${n(tz)} Tz 1 0 0 -1 ${n(x0)} ${n(bottom - size * 0.2)} Tm <${unicodeHex(run)}> Tj ET\n`
          }
          for (let c = 0; c < pt.text.length; c++) {
            const k = ownerAt.get(c)
            if (k !== undefined) {
              flush(c)
              box(k)
            } else if (pt.text[c] === '\n') flush(c)
            else if (runStart < 0) runStart = c
          }
          flush(pt.text.length)
        }
        overlays.forEach((_, k) => box(k))
        cs += 'Q\n'

        const pageObj = page.getObject()
        let res = pageObj.get('Resources')
        if (res.isNull()) {
          res = doc.newDictionary()
          pageObj.put('Resources', res)
        }
        let fonts = res.get('Font')
        if (fonts.isNull()) {
          fonts = doc.newDictionary()
          res.put('Font', fonts)
        }
        fonts.put('FAnon', (fontRef ??= doc.addSimpleFont(font, 'Latin')))
        if (pt.ocr) fonts.put('FAnonU', (unicodeFontRef ??= doc.addFont(font)))
        const contents = pageObj.get('Contents')
        const arr = doc.newArray()
        arr.push(doc.addStream('q\n', {}))
        if (contents.isArray()) contents.forEach((c: MuPDF.PDFObject) => arr.push(c))
        else if (!contents.isNull()) arr.push(contents)
        arr.push(doc.addStream('Q\n' + cs, {}))
        pageObj.put('Contents', arr)
      }

      // Form field values
      const pageWidgets = new Map<number, MuPDF.PDFWidget[]>()
      widgetSegs.forEach((w, k) => {
        const r = results[pages.length + k]
        if (!r.entities.length) return
        const ws = pageWidgets.get(w.page) ?? pageAt(w.page).getWidgets()
        pageWidgets.set(w.page, ws)
        ws[w.index]?.setTextValue(r.output)
      })

      // Metadata (Info dictionary + XMP)
      for (const key of ['Author', 'Title', 'Subject', 'Keywords', 'Creator', 'Producer']) doc.setMetaData(`info:${key}`, '')
      const root = doc.getTrailer().get('Root')
      if (!root.get('Metadata').isNull()) root.delete('Metadata')
      // Attachments (e.g. the ISDOC/ZUGFeRD XML that invoicing tools embed) hold the same data unredacted.
      const attachments = Object.keys(doc.getEmbeddedFiles())
      for (const name of attachments) doc.deleteEmbeddedFile(name)
      // PDF/A-3 also lists them as associated files (/AF) on the catalog and pages.
      root.delete('AF')
      for (let i = 0; i < count; i++) pageAt(i).getObject().delete('AF')
      if (attachments.length)
        warnings.push(`Odstránené vložené prílohy (${attachments.join(', ')}) – obsahovali neanonymizované údaje.`)

      // Full rewrite with garbage collection: removes the original (now unreferenced) content streams.
      // Two passes: MuPDF's object de-duplication (garbage≥3) loses the data of streams created in memory
      // when there are several of them (pages re-recorded in order), so first write them out without it.
      const settled = mupdf.Document.openDocument(doc.saveToBuffer('garbage=2').asUint8Array().slice(), 'application/pdf').asPDF()!
      return settled.saveToBuffer('garbage=4,compress=yes,clean=yes').asUint8Array().slice()
    }
  }
}
