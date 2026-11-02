// Renders the Shanoon "SHN" mark (as in resources/brand/icon.svg: teal rounded square, white bold text)
// to PNG app icons and Microsoft Store tiles using MuPDF – no extra tools needed.
// Run: node scripts/make-icon.mjs
import { writeFile, mkdir } from 'node:fs/promises'
import * as mupdf from 'mupdf'

const S = 512
const R = 115
const k = 0.5523 * R
const f = new mupdf.Font('Helvetica-Bold')
const textWidth = [...'SHN'].reduce((w, c) => w + f.advanceGlyph(f.encodeCharacter(c)), 0) * 188 - 6 * 2

/** Content stream drawing the 512×512 mark, in a coordinate system with origin bottom-left. */
const mark = () => {
  const path = [
    `${R} 0 m`, `${S - R} 0 l`, `${S - R + k} 0 ${S} ${R - k} ${S} ${R} c`, `${S} ${S - R} l`,
    `${S} ${S - R + k} ${S - R + k} ${S} ${S - R} ${S} c`, `${R} ${S} l`, `${R - k} ${S} 0 ${S - R + k} 0 ${S - R} c`,
    `0 ${R} l`, `0 ${R - k} ${R - k} 0 ${R} 0 c`, 'h'
  ].join(' ')
  return `0.0588 0.4627 0.4314 rg ${path} f\nBT 1 g /F1 188 Tf -6 Tc ${(S - textWidth) / 2} ${S - 318} Td (SHN) Tj ET`
}

/** Render a w×h PNG with the mark centred, occupying `scale` of the shorter side. */
function render(w, h, scale = 1) {
  const doc = new mupdf.PDFDocument()
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica-Bold'), 'Latin')
  const res = doc.addObject({ Font: { F1: font } })
  const size = Math.min(w, h) * scale
  const s = size / S
  const content = `q ${s} 0 0 ${s} ${(w - size) / 2} ${(h - size) / 2} cm\n${mark()}\nQ`
  doc.insertPage(-1, doc.addPage([0, 0, w, h], 0, res, content))
  return doc.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, true).asPNG()
}

await mkdir('build/appx', { recursive: true })
await mkdir('resources/brand', { recursive: true })
const outputs = [
  // App icons
  ['build/icon.png', 1024, 1024, 1],
  ['resources/brand/icon.png', 256, 256, 1],
  // Microsoft Store / Start menu tiles (electron-builder picks them up from build/appx/)
  ['build/appx/StoreLogo.png', 50, 50, 1],
  ['build/appx/Square44x44Logo.png', 44, 44, 1],
  ['build/appx/Square150x150Logo.png', 150, 150, 0.6],
  ['build/appx/Wide310x150Logo.png', 310, 150, 0.6],
  ['build/appx/SmallTile.png', 71, 71, 0.7],
  ['build/appx/LargeTile.png', 310, 310, 0.6]
]
for (const [out, w, h, scale] of outputs) {
  await writeFile(out, render(w, h, scale))
  console.log('✓', out, `${w}×${h}`)
}
