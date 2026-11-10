import type * as MuPDF from 'mupdf'

// Writes anonymized PDF pages so that placeholders sit in the content stream exactly where the removed
// values were. Text extractors used by LLM tools (pdf.js, PyMuPDF, pdfminer…) read text in stream order,
// so "Obchodné meno [OSOBA_1]" stays together instead of all placeholders piling up at the page end.

type Mupdf = typeof MuPDF
export type Rect = [number, number, number, number]

/** A box to cover on the page (MuPDF page space, y down). Only the first box of an entity carries a label. */
export interface Overlay {
  rect: Rect
  label: string
}

export const BOX_RGB: [number, number, number] = [0.9, 0.95, 0.94]
export const INK_RGB: [number, number, number] = [0.06, 0.46, 0.43]

/** Font size and baseline origin that fit `label` into `rect` (page space). */
export function labelGeometry(rect: Rect, label: string, widthAt1: (s: string) => number) {
  const [x0, y0, x1, y1] = rect
  const w = x1 - x0
  const h = y1 - y0
  const size = Math.max(3.5, Math.min(h * 0.78, (w - 1) / widthAt1(label)))
  return { size, x: x0 + 0.5, y: y0 + h / 2 + size * 0.35 }
}

/**
 * Text matrix for a label. With an anchor (the replaced glyph's rendering matrix) the label continues the
 * original line – same origin, direction and size, shrunk only to fit the original value's length.
 */
function labelMatrix(rect: Rect, label: string, widthAt1: (s: string) => number, anchor?: MuPDF.Matrix): MuPDF.Matrix {
  if (!anchor) {
    const g = labelGeometry(rect, label, widthAt1)
    return [g.size, 0, 0, -g.size, g.x, g.y]
  }
  const sx = Math.hypot(anchor[0], anchor[1])
  const sy = Math.hypot(anchor[2], anchor[3])
  if (!sx || !sy) return labelMatrix(rect, label, widthAt1)
  const [ux, uy] = [anchor[0] / sx, anchor[1] / sx]
  const [vx, vy] = [anchor[2] / sy, anchor[3] / sy]
  const along = Math.abs(ux) >= Math.abs(uy) ? rect[2] - rect[0] : rect[3] - rect[1]
  const size = Math.max(3.5, Math.min(sx, (along - 1) / widthAt1(label)))
  return [ux * size, uy * size, vx * size, vy * size, anchor[4], anchor[5]]
}

const apply = (m: MuPDF.Matrix, x: number, y: number): [number, number] => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]
const inside = (p: [number, number], r: Rect) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]

type Piece = { text: MuPDF.Text } | { overlay: number }

/**
 * Split a text object into runs of kept glyphs and the overlays that replace removed glyphs, in order.
 * A glyph is removed when its centre lies in an overlay box (the boxes come from the very same glyphs).
 */
function splitText(
  mupdf: Mupdf,
  text: MuPDF.Text,
  ctm: MuPDF.Matrix,
  overlays: Overlay[],
  anchors: Map<number, MuPDF.Matrix>
): Piece[] {
  const pieces: Piece[] = []
  let cur: MuPDF.Text | null = null
  let last = -1
  text.walk({
    showGlyph(font, trm, gid, uni, wmode) {
      // gid < 0: extra characters of a ligature – they follow the decision for the glyph they belong to.
      let k = last
      if (gid >= 0) {
        const adv = font.advanceGlyph(gid, wmode)
        const m = mupdf.Matrix.concat(trm, ctm)
        k = overlays.findIndex((o) => inside(wmode ? apply(m, 0.5, -adv / 2) : apply(m, adv / 2, 0.3), o.rect))
        last = k
      }
      if (k < 0) {
        ;(cur ??= new mupdf.Text()).showGlyph(font, trm, gid, uni, wmode)
        return
      }
      // The first removed glyph of a box anchors its label: same baseline, direction and size.
      if (gid >= 0 && !anchors.has(k)) anchors.set(k, mupdf.Matrix.concat(trm, ctm))
      if (cur) {
        pieces.push({ text: cur })
        cur = null
      }
      const prev = pieces[pieces.length - 1]
      if (!prev || !('overlay' in prev) || prev.overlay !== k) pieces.push({ overlay: k })
    }
  })
  if (cur) pieces.push({ text: cur })
  return pieces
}

/** Characters (by overlay) that remain inside each overlay box on a page. */
function textInsideOverlays(page: MuPDF.Page, overlays: Overlay[]): string[] {
  const found = overlays.map(() => '')
  page.toStructuredText('preserve-whitespace').walk({
    onChar(c, _origin, _font, _size, quad) {
      const q = quad as unknown as number[]
      const p: [number, number] = [(q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4]
      overlays.forEach((o, k) => {
        if (inside(p, o.rect)) found[k] += c
      })
    }
  })
  return found
}

const num = (x: number) => (Math.round(x * 1000) / 1000).toString()

const fallbackFonts = new Map<string, MuPDF.Font>()

/**
 * Ligatures ("fi", "ti") as their separate letters. MuPDF's PDF writer derives ToUnicode from the font's own
 * cmap, where a ligature glyph has no entry – extractors then read "�nančnom" instead of "finančnom".
 * Letters missing from a font subset are taken from a similar standard font.
 */
function splitLigatures(mupdf: Mupdf, text: MuPDF.Text, t3: Type3Painter): MuPDF.Text {
  type G = { font: MuPDF.Font; trm: MuPDF.Matrix; gid: number; uni: number; wmode: number; extra: number[] }
  const glyphs: G[] = []
  text.walk({
    showGlyph(font, trm, gid, uni, wmode) {
      const prev = glyphs[glyphs.length - 1]
      if (gid < 0 && prev && prev.font === font) prev.extra.push(uni)
      else glyphs.push({ font, trm, gid, uni, wmode, extra: [] })
    }
  })
  if (!glyphs.some((g) => g.extra.length)) return text
  const out = new mupdf.Text()
  for (const g of glyphs) {
    if (!g.extra.length || g.wmode || t3.isType3(g.font)) {
      out.showGlyph(g.font, g.trm, g.gid, g.uni, g.wmode)
      for (const u of g.extra) out.showGlyph(g.font, g.trm, -1, u, g.wmode)
      continue
    }
    let x = 0
    for (const u of [g.uni, ...g.extra]) {
      let font = g.font
      let gid = font.encodeCharacter(u)
      if (gid <= 0) {
        const name = `${font.isSerif() ? 'Times' : 'Helvetica'}${font.isBold() ? '-Bold' : ''}`
        if (!fallbackFonts.has(name)) fallbackFonts.set(name, new mupdf.Font(name))
        font = fallbackFonts.get(name)!
        gid = font.encodeCharacter(u)
      }
      const [a, b, c, d, e, f] = g.trm
      out.showGlyph(font, [a, b, c, d, e + x * a, f + x * b], gid, u, 0)
      x += font.advanceGlyph(gid, 0)
    }
  }
  return out
}

/**
 * MuPDF's PDF writer cannot write text in Type 3 fonts (Chrome/Skia uses them for fonts it cannot embed,
 * e.g. variable fonts). Such glyphs are re-drawn from their own glyph procedures as vector paths, and an
 * invisible copy of their characters keeps the text readable for text extractors.
 */
class Type3Painter {
  private fonts = new Map<string, MuPDF.PDFObject>()
  private scratch: MuPDF.PDFDocument
  private glyphs = new Map<string, MuPDF.PDFPage | null>()
  private static readonly UNIT: MuPDF.Matrix = [1, 0, 0, -1, 0, 1] // transform of a 1×1 MediaBox page

  constructor(
    private mupdf: Mupdf,
    page: MuPDF.PDFPage,
    private labelFont: MuPDF.Font
  ) {
    this.scratch = new mupdf.PDFDocument()
    const seen = new Set<string>()
    const collect = (res: MuPDF.PDFObject) => {
      if (!res.isDictionary()) return
      res.get('Font').forEach((f: MuPDF.PDFObject) => {
        const d = f.resolve()
        if (d.get('Subtype').asName() !== 'Type3') return
        if (f.isIndirect()) this.fonts.set(`Type3 (${f.asIndirect()} 0 R)`, d)
        const name = d.get('Name')
        if (name.isName()) this.fonts.set(name.asName(), d)
      })
      res.get('XObject').forEach((x: MuPDF.PDFObject) => {
        const key = x.isIndirect() ? String(x.asIndirect()) : ''
        if (key && seen.has(key)) return
        seen.add(key)
        collect(x.resolve().get('Resources'))
      })
    }
    collect(page.getObject().get('Resources'))
    this.pageResources = page.getObject().get('Resources')
  }
  private pageResources: MuPDF.PDFObject

  isType3(font: MuPDF.Font) {
    return this.fonts.has(font.getName()) || font.getName().startsWith('Type3')
  }

  /** Text without its Type 3 glyphs, the Type 3 glyphs painted (in order) through `out`. */
  fillText(out: MuPDF.Device, text: MuPDF.Text, ctm: MuPDF.Matrix, cs: MuPDF.ColorSpace, color: MuPDF.Color, alpha: number) {
    const { mupdf } = this
    let normal: MuPDF.Text | null = null
    let hidden: MuPDF.Text | null = null
    const flushNormal = () => {
      if (normal) out.fillText(normal, ctm, cs, color, alpha)
      normal = null
    }
    const flushHidden = () => {
      if (hidden) out.fillText(hidden, ctm, mupdf.ColorSpace.DeviceRGB, [0, 0, 0], 0)
      hidden = null
    }
    text.walk({
      showGlyph: (font, trm, gid, uni, wmode) => {
        if (!this.isType3(font)) {
          flushHidden()
          ;(normal ??= new mupdf.Text()).showGlyph(font, trm, gid, uni, wmode)
          return
        }
        flushNormal()
        if (gid >= 0) this.paint(out, font, trm, gid, ctm, cs, color, alpha)
        if (uni > 0) {
          const lg = this.labelFont.encodeCharacter(uni)
          ;(hidden ??= new mupdf.Text()).showGlyph(this.labelFont, trm, lg, uni, wmode)
        }
      }
    })
    flushNormal()
    flushHidden()
  }

  /** Text without its Type 3 glyphs (for invisible text and clips). Null if it had any. */
  withoutType3(text: MuPDF.Text): { text: MuPDF.Text; dropped: boolean } {
    const t = new this.mupdf.Text()
    let dropped = false
    text.walk({
      showGlyph: (font, trm, gid, uni, wmode) => {
        if (this.isType3(font)) dropped = true
        else t.showGlyph(font, trm, gid, uni, wmode)
      }
    })
    return { text: t, dropped }
  }

  private paint(
    out: MuPDF.Device,
    font: MuPDF.Font,
    trm: MuPDF.Matrix,
    gid: number,
    ctm: MuPDF.Matrix,
    cs: MuPDF.ColorSpace,
    color: MuPDF.Color,
    alpha: number
  ) {
    const dict = this.fonts.get(font.getName())
    if (!dict) throw new Error(`Type 3 font not found: ${font.getName()}`)
    const key = `${font.getName()}|${gid}|${cs.getNumberOfComponents()}:${color.join(',')}|${alpha}`
    let glyph = this.glyphs.get(key)
    if (glyph === undefined) {
      glyph = this.makeGlyph(dict, gid, cs, color, alpha)
      this.glyphs.set(key, glyph)
    }
    if (!glyph) return
    const fm = dict.get('FontMatrix')
    const fontMatrix: MuPDF.Matrix = fm.isArray()
      ? [0, 1, 2, 3, 4, 5].map((i) => fm.get(i).asNumber()) as unknown as MuPDF.Matrix
      : [0.001, 0, 0, 0.001, 0, 0]
    const { Matrix } = this.mupdf
    const m = Matrix.concat(Matrix.concat(fontMatrix, trm), ctm)
    glyph.runPageContents(out, Matrix.concat(Matrix.invert(Type3Painter.UNIT), m))
  }

  /** A scratch page whose content is the glyph procedure, in the text's colour. Null for an empty glyph. */
  private makeGlyph(dict: MuPDF.PDFObject, code: number, cs: MuPDF.ColorSpace, color: MuPDF.Color, alpha: number) {
    // MuPDF loads Type 3 fonts with glyph id = character code (0–255).
    let name: string | null = null
    const diffs = dict.get('Encoding').get('Differences')
    if (diffs.isArray()) {
      let c = 0
      for (let i = 0; i < diffs.length; i++) {
        const v = diffs.get(i)
        if (v.isNumber()) c = v.asNumber()
        else if (v.isName()) {
          if (c === code) name = v.asName()
          c++
        }
      }
    }
    const proc = name ? dict.get('CharProcs').get(name) : null
    if (!proc || !proc.isStream()) return null
    const body = proc.readStream().asString().replace(/^\s*(?:[-+.\d]+\s+){2,6}d[01]\b/, '')
    const n = cs.getNumberOfComponents()
    const c = color.map(num).join(' ')
    const setColor = n === 1 ? `${c} g ${c} G` : n === 3 ? `${c} rg ${c} RG` : n === 4 ? `${c} k ${c} K` : ''
    const s = this.scratch
    const fontRes = dict.get('Resources')
    const res = s.graftObject(fontRes.isDictionary() ? fontRes : this.pageResources.isDictionary() ? this.pageResources : s.newDictionary())
    let gs = ''
    if (alpha < 1) {
      const ext = s.newDictionary()
      ext.put('ca', alpha)
      ext.put('CA', alpha)
      const all = res.get('ExtGState').isDictionary() ? res.get('ExtGState') : s.newDictionary()
      all.put('AnonT3Alpha', s.addObject(ext))
      res.put('ExtGState', all)
      gs = '/AnonT3Alpha gs'
    }
    const pageObj = s.addPage([0, 0, 1, 1], 0, res, `q ${gs} ${setColor}\n${body}\nQ`)
    s.insertPage(-1, pageObj)
    return s.loadPage(s.countPages() - 1) as MuPDF.PDFPage
  }
}

/**
 * Re-record the page's content through a filtering device: glyphs inside overlay boxes are dropped and the
 * box + placeholder are drawn at that exact point of the stream. The recorded content replaces the page's
 * content as a Form XObject (annotations, form fields and links stay untouched).
 *
 * Returns false – leaving the page exactly as it was – if any original character is still found inside a box.
 */
export function rewritePageInOrder(
  mupdf: Mupdf,
  doc: MuPDF.PDFDocument,
  pageIndex: number,
  overlays: Overlay[],
  labelFont: MuPDF.Font
): boolean {
  const page = doc.loadPage(pageIndex) as MuPDF.PDFPage
  const anchors = new Map<number, MuPDF.Matrix>()
  const widthAt1 = (s: string) => [...s].reduce((w, ch) => w + labelFont.advanceGlyph(labelFont.encodeCharacter(ch)), 0)

  const buf = new mupdf.Buffer()
  const writer = new mupdf.DocumentWriter(buf, 'pdf', '')
  const out = writer.beginPage(page.getBounds())
  const rgb = mupdf.ColorSpace.DeviceRGB
  const id = mupdf.Matrix.identity
  const drawn = new Set<number>()
  const draw = (k: number) => {
    if (drawn.has(k)) return
    drawn.add(k)
    const { rect, label } = overlays[k]
    const box = new mupdf.Path()
    box.rect(rect[0], rect[1], rect[2], rect[3])
    out.fillPath(box, false, id, rgb, BOX_RGB, 1)
    if (!label) return
    const t = new mupdf.Text()
    t.showString(labelFont, labelMatrix(rect, label, widthAt1, anchors.get(k)), label)
    out.fillText(t, id, rgb, INK_RGB, 1)
  }
  const t3 = new Type3Painter(mupdf, page, labelFont)
  const emit = (pieces: Piece[], show: (t: MuPDF.Text) => void) => {
    for (const p of pieces) 'text' in p ? show(splitLigatures(mupdf, p.text, t3)) : draw(p.overlay)
  }
  // Clip operations must stay balanced with popClip: always forward one (possibly empty) text.
  const keptOnly = (text: MuPDF.Text, ctm: MuPDF.Matrix) => {
    const t = new mupdf.Text()
    for (const p of splitText(mupdf, text, ctm, overlays, anchors))
      if ('text' in p) splitLigatures(mupdf, p.text, t3).walk({ showGlyph: (f, m, g, u, w) => t.showGlyph(f, m, g, u, w) })
    // A clip by Type 3 glyphs cannot be written; give up on this page (the caller falls back).
    if (t3.withoutType3(t).dropped) throw new Error('clip by Type 3 text')
    return t
  }

  // Forward everything verbatim except text, which is split around the overlay boxes.
  type D = MuPDF.Device
  const callbacks = {
    fillPath: (...a: Parameters<D['fillPath']>) => out.fillPath(...a),
    strokePath: (...a: Parameters<D['strokePath']>) => out.strokePath(...a),
    clipPath: (...a: Parameters<D['clipPath']>) => out.clipPath(...a),
    clipStrokePath: (...a: Parameters<D['clipStrokePath']>) => out.clipStrokePath(...a),
    fillText: (...[text, ctm, cs, color, alpha]: Parameters<D['fillText']>) =>
      emit(splitText(mupdf, text, ctm, overlays, anchors), (t) => t3.fillText(out, t, ctm, cs, color, alpha)),
    strokeText: (...[text, stroke, ctm, cs, color, alpha]: Parameters<D['strokeText']>) =>
      emit(splitText(mupdf, text, ctm, overlays, anchors), (t) => {
        const plain = t3.withoutType3(t)
        if (plain.dropped) t3.fillText(out, t, ctm, cs, color, alpha) // outlined Type 3 text: drawn filled
        else out.strokeText(t, stroke, ctm, cs, color, alpha)
      }),
    ignoreText: (...[text, ctm]: Parameters<D['ignoreText']>) =>
      emit(splitText(mupdf, text, ctm, overlays, anchors), (t) => out.ignoreText(t3.withoutType3(t).text, ctm)),
    clipText: (...[text, ctm]: Parameters<D['clipText']>) => out.clipText(keptOnly(text, ctm), ctm),
    clipStrokeText: (...[text, stroke, ctm]: Parameters<D['clipStrokeText']>) =>
      out.clipStrokeText(keptOnly(text, ctm), stroke, ctm),
    fillShade: (...a: Parameters<D['fillShade']>) => out.fillShade(...a),
    fillImage: (...a: Parameters<D['fillImage']>) => out.fillImage(...a),
    fillImageMask: (...a: Parameters<D['fillImageMask']>) => out.fillImageMask(...a),
    clipImageMask: (...a: Parameters<D['clipImageMask']>) => out.clipImageMask(...a),
    popClip: () => out.popClip(),
    beginMask: (...a: Parameters<D['beginMask']>) => out.beginMask(...a),
    endMask: () => out.endMask(),
    beginGroup: (...a: Parameters<D['beginGroup']>) => out.beginGroup(...a),
    endGroup: () => out.endGroup(),
    beginTile: (...a: Parameters<D['beginTile']>) => out.beginTile(...a),
    endTile: () => out.endTile(),
    beginLayer: (...a: Parameters<D['beginLayer']>) => out.beginLayer(...a),
    endLayer: () => out.endLayer()
  }
  // mupdf's callback interface is not exported; the callbacks above are typed from Device's own methods.
  const dev = new mupdf.Device(callbacks as never)
  try {
    page.runPageContents(dev, id)
    // Boxes whose glyphs were never seen in a fill (e.g. only used as a clip) are still covered.
    overlays.forEach((_, k) => draw(k))
    dev.close()
    writer.endPage()
    writer.close()
  } catch {
    // Content the PDF writer cannot reproduce: the page is left untouched for the caller's fallback.
    return false
  }

  // Graft the recorded page into the original document as a Form XObject.
  const src = mupdf.Document.openDocument(buf.asUint8Array().slice(), 'application/pdf').asPDF()!
  const srcPage = src.findPage(0)
  const contents = srcPage.get('Contents')
  const chunks: Uint8Array[] = []
  const read = (o: MuPDF.PDFObject) => chunks.push(o.readStream().asUint8Array().slice())
  if (contents.isArray()) contents.forEach((o: MuPDF.PDFObject) => read(o))
  else read(contents)
  const form = doc.newDictionary()
  form.put('Type', doc.newName('XObject'))
  form.put('Subtype', doc.newName('Form'))
  form.put('BBox', doc.graftObject(srcPage.get('MediaBox')))
  form.put('Resources', doc.graftObject(srcPage.get('Resources')))
  const group = srcPage.get('Group')
  if (!group.isNull()) form.put('Group', doc.graftObject(group))
  // Create the object first and attach the data with writeStream: a stream made with addStream(bytes, dict)
  // lost its data when the document was saved with garbage collection.
  const formRef = doc.addObject(form)
  formRef.writeStream(concatBytes(chunks))

  // Recorded page user space → MuPDF page space → original page user space (handles Rotate and CropBox).
  const m = mupdf.Matrix.concat((src.loadPage(0) as MuPDF.PDFPage).getTransform(), mupdf.Matrix.invert(page.getTransform()))
  const pageObj = page.getObject()
  const oldContents = pageObj.get('Contents')
  const oldResources = pageObj.get('Resources')
  const xobjects = doc.newDictionary()
  xobjects.put('AnonPage', formRef)
  const res = doc.newDictionary()
  res.put('XObject', xobjects)
  pageObj.put('Resources', res)
  pageObj.put('Contents', doc.addStream(`q ${m.map(num).join(' ')} cm /AnonPage Do Q`, doc.newDictionary()))

  // Leak check on the result: inside every box only (part of) its own placeholder may remain.
  const left = textInsideOverlays(doc.loadPage(pageIndex), overlays)
  const clean = left.every((s, k) => {
    const t = s.replace(/\s/g, '')
    return !t || overlays[k].label.includes(t)
  })
  if (!clean) {
    pageObj.put('Contents', oldContents)
    if (oldResources.isNull()) pageObj.delete('Resources')
    else pageObj.put('Resources', oldResources)
  }
  return clean
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    out[o + p.length] = 0x0a // content streams split across an array are joined with whitespace
    o += p.length + 1
  }
  return out
}
