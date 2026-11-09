// Renders the Anonymo mark (resources/brand/icon.svg: Shanoon teal rounded square + Lucide "hat-glasses")
// to PNG app icons and Microsoft Store tiles using sharp (already installed via @huggingface/transformers).
// Run: node scripts/make-icon.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const S = 512
const svg = await readFile('resources/brand/icon.svg', 'utf8')
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

/** Render a w×h PNG with the mark centred, occupying `scale` of the shorter side (transparent around it). */
function render(w, h, scale = 1) {
  const size = Math.min(w, h) * scale
  const s = size / S
  const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<g transform="translate(${(w - size) / 2} ${(h - size) / 2}) scale(${s})">${inner}</g></svg>`
  return sharp(Buffer.from(wrapped)).png().toBuffer()
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
  await writeFile(out, await render(w, h, scale))
  console.log('✓', out, `${w}×${h}`)
}
