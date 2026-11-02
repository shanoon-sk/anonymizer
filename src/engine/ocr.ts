import type { OcrFn, OcrWord } from './formats/pdf'

/**
 * Offline OCR via tesseract.js (Slovak + English). Language data comes from the bundled tessdata
 * directory; nothing is downloaded or cached on disk.
 */
export async function createOcr(tessdataDir: string): Promise<{ ocr: OcrFn; dispose: () => Promise<void> }> {
  const { createWorker } = await import('tesseract.js')
  // langPath points at the bundled, uncompressed traineddata files; caching is disabled so
  // tesseract.js never writes anything to disk or downloads data.
  const worker = await createWorker(['slk', 'eng'], 1, {
    langPath: tessdataDir,
    cacheMethod: 'none',
    gzip: false
  })
  await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' })

  const ocr: OcrFn = async (png) => {
    const { data } = await worker.recognize(Buffer.from(png), {}, { blocks: true, text: false })
    const words: OcrWord[] = []
    let line = 0
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines) {
          line++
          for (const w of l.words) if (w.text.trim()) words.push({ text: w.text, bbox: w.bbox, line })
        }
    return words
  }
  return { ocr, dispose: async () => void (await worker.terminate()) }
}
