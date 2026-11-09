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
  const emit = (pieces: Piece[], show: (t: MuPDF.Text) => void) => {
    for (const p of pieces) 'text' in p ? show(p.text) : draw(p.overlay)
  }
  // Clip operations must stay balanced with popClip: always forward one (possibly empty) text.
  const keptOnly = (text: MuPDF.Text, ctm: MuPDF.Matrix) => {
    const t = new mupdf.Text()
    for (const p of splitText(mupdf, text, ctm, overlays, anchors))
      if ('text' in p) p.text.walk({ showGlyph: (f, m, g, u, w) => t.showGlyph(f, m, g, u, w) })
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
      emit(splitText(mupdf, text, ctm, overlays, anchors), (t) => out.fillText(t, ctm, cs, color, alpha)),
    strokeText: (...[text, stroke, ctm, cs, color, alpha]: Parameters<D['strokeText']>) =>
      emit(splitText(mupdf, text, ctm, overlays, anchors), (t) => out.strokeText(t, stroke, ctm, cs, color, alpha)),
    ignoreText: (...[text, ctm]: Parameters<D['ignoreText']>) =>
      emit(splitText(mupdf, text, ctm, overlays, anchors), (t) => out.ignoreText(t, ctm)),
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
  page.runPageContents(dev, id)
  // Boxes whose glyphs were never seen in a fill (e.g. only used as a clip) are still covered.
  overlays.forEach((_, k) => draw(k))
  dev.close()
  writer.endPage()
  writer.close()

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
