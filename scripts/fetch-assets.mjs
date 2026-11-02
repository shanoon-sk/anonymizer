// Downloads offline assets (NER model, OCR language data, brand logo) into ./resources.
// Run once at dev setup / in CI before packaging: `npm run fetch-assets`.
// The packaged app never touches the network – everything is shipped in resources/.
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')

const NER_MODEL = 'Xenova/bert-base-multilingual-cased-ner-hrl'
const HF = `https://huggingface.co/${NER_MODEL}/resolve/main`

const assets = [
  ...['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'].map(
    (f) => ({ url: `${HF}/${f}`, out: `models/${NER_MODEL}/${f}` })
  ),
  { url: 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/slk.traineddata', out: 'tessdata/slk.traineddata' },
  { url: 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata', out: 'tessdata/eng.traineddata' },
  { url: 'https://shanoon.sk/icon.svg', out: 'brand/icon.svg' }
]

for (const { url, out } of assets) {
  const dest = join(root, out)
  try {
    if ((await stat(dest)).size > 0) {
      console.log(`✓ ${out} (cached)`)
      continue
    }
  } catch {}
  process.stdout.write(`↓ ${out} … `)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  await mkdir(dirname(dest), { recursive: true })
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`)
}
