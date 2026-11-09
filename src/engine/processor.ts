import { access, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { AnonymizeOptions, EntityType, FileResult, ProgressEvent } from '../shared/entities'
import type { DocumentAdapter } from './formats/adapter'
import { kindFromName } from './formats/adapter'
import { loadDocx } from './formats/docx'
import { loadXlsx } from './formats/xlsx'
import { loadPdf, type OcrFn } from './formats/pdf'
import { anonymizeBatch, type NerFn } from './pipeline'

export interface Engines {
  ner?: () => Promise<NerFn>
  ocr?: () => Promise<OcrFn>
}

async function uniquePath(p: string): Promise<string> {
  const ext = extname(p)
  const stem = p.slice(0, -ext.length)
  for (let i = 1; ; i++) {
    const cand = i === 1 ? p : `${stem} (${i})${ext}`
    try {
      await access(cand)
    } catch {
      return cand
    }
  }
}

/** Output file name; `stem` is the anonymized input name (without extension). */
export function outputName(stem: string, ext: string): string {
  return `${stem}_anonymizovane.${ext}`
}

/** Characters a placeholder or name must never introduce into a file name. */
const unsafeFileChars = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')

/**
 * Anonymize files as one batch (placeholders are consistent across all of them).
 * Files are read into memory, processed, and only the anonymized result is written to `outDir`
 * (or next to the original when `outDir` is null). Nothing else touches the disk.
 */
export async function processFiles(
  inputs: string[],
  opts: AnonymizeOptions,
  outDir: string | null,
  engines: Engines,
  onProgress: (e: ProgressEvent) => void
): Promise<FileResult[]> {
  const results: FileResult[] = inputs.map((input) => ({ input, outputs: [], counts: {}, ocrPages: 0, warnings: [] }))
  const ner = opts.useNer && engines.ner ? await engines.ner() : undefined
  let ocr: OcrFn | undefined

  const loaded: { idx: number; adapter: DocumentAdapter }[] = []
  for (const [idx, input] of inputs.entries()) {
    onProgress({ input, stage: 'reading', progress: 0 })
    try {
      const kind = kindFromName(input)
      if (!kind) throw new Error('Nepodporovaný formát. Podporované sú PDF, DOCX a XLSX.')
      const buf = new Uint8Array(await readFile(input))
      let adapter: DocumentAdapter
      if (kind === 'docx') adapter = await loadDocx(buf)
      else if (kind === 'xlsx') adapter = await loadXlsx(buf)
      else {
        adapter = await loadPdf(buf, {
          ocr: engines.ocr
            ? async (png) => {
                ocr ??= await engines.ocr!()
                return ocr(png)
              }
            : undefined,
          onOcrPage: (i, total) => onProgress({ input, stage: 'ocr', progress: i / total, detail: `${i + 1}/${total}` })
        })
      }
      loaded.push({ idx, adapter })
      results[idx].ocrPages = adapter.ocrPages ?? 0
      results[idx].warnings.push(...(adapter.warnings ?? []))
    } catch (err) {
      results[idx].error = err instanceof Error ? err.message : String(err)
      onProgress({ input, stage: 'error', progress: 1, detail: results[idx].error })
    }
  }

  if (!loaded.length) return results
  for (const { idx } of loaded) onProgress({ input: inputs[idx], stage: 'detecting', progress: 0 })

  // Map batch progress back to files
  const sizes = loaded.map((l) => l.adapter.segments.length)
  // The file name is anonymized with the same batch (a name in "Zmluva – Novák.pdf" would otherwise leak),
  // as one extra trailing segment per document.
  const stem = (idx: number) => basename(inputs[idx], extname(inputs[idx]))
  // Names in file names are often glued ("fa_MgrJanNovak_2024"): detect on a spaced-out copy.
  const spaced = (idx: number) =>
    stem(idx)
      .replace(/_+/g, ' ')
      .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{L})(\d)|(\d)(\p{L})/gu, (_m, a, b, c, d) => (a ? `${a} ${b}` : `${c} ${d}`))
  const batch = await anonymizeBatch(
    loaded.map((l) => [...l.adapter.segments, { text: spaced(l.idx) }]),
    { types: opts.types, customTerms: opts.customTerms, ner },
    (p) => {
      if (p.phase !== 'detect') return
      let left = p.done
      loaded.forEach((l, k) => {
        const done = Math.max(0, Math.min(sizes[k], left))
        left -= sizes[k]
        if (done > 0) onProgress({ input: inputs[l.idx], stage: 'detecting', progress: sizes[k] ? done / sizes[k] : 1 })
      })
    }
  )

  for (const [k, { idx, adapter }] of loaded.entries()) {
    const input = inputs[idx]
    const res = results[idx]
    onProgress({ input, stage: 'writing', progress: 0.5 })
    try {
      const segResults = batch[k].slice(0, -1)
      // Keep the original file name unless something in it had to be hidden.
      const named = batch[k][batch[k].length - 1]
      const name = unsafeFileChars(named.entities.length ? named.output : stem(idx))
      const counts: Partial<Record<EntityType, number>> = {}
      const seen = new Set<string>()
      for (const r of segResults)
        for (const e of r.entities) {
          // Count distinct values, not mentions
          if (seen.has(e.placeholder)) continue
          seen.add(e.placeholder)
          counts[e.type] = (counts[e.type] ?? 0) + 1
        }
      res.counts = counts
      const dir = outDir ?? dirname(input)
      const out = await uniquePath(join(dir, outputName(name, adapter.outputExt)))
      await writeFile(out, await adapter.write(segResults))
      res.outputs.push(out)
      // Writing can add warnings too (removed attachments, fallbacks) – report them.
      for (const w of adapter.warnings ?? []) if (!res.warnings.includes(w)) res.warnings.push(w)
      if (opts.exportText && adapter.toText) {
        const md = await uniquePath(join(dir, outputName(name, 'md')))
        await writeFile(md, adapter.toText(segResults), 'utf8')
        res.outputs.push(md)
      }
      onProgress({ input, stage: 'done', progress: 1 })
    } catch (err) {
      res.error = err instanceof Error ? err.message : String(err)
      onProgress({ input, stage: 'error', progress: 1, detail: res.error })
    }
  }
  return results
}
