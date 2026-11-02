// Processing runs in an Electron utility process so heavy work (NER model, OCR, PDF rendering)
// never blocks the UI. It only receives file paths and options, and only writes the output files.
import type { WorkerRequest, WorkerResponse } from '../shared/ipc'
import { processFiles } from '../engine/processor'
import { createNer } from '../engine/ner'
import { createOcr } from '../engine/ocr'
import type { NerFn } from '../engine/pipeline'
import type { OcrFn } from '../engine/formats/pdf'

// Belt and braces: this process has no reason to use the network.
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('blob:')) {
    throw new Error(`Network access blocked: ${url.slice(0, 40)}`)
  }
  return realFetch(input, init)
}) as typeof fetch

const modelRoot = process.env.ANON_MODELS_DIR!
const tessdataDir = process.env.ANON_TESSDATA_DIR!

let nerPromise: Promise<NerFn> | null = null
let ocrPromise: Promise<OcrFn> | null = null

const engines = {
  ner: () => (nerPromise ??= createNer(modelRoot)),
  ocr: () => (ocrPromise ??= createOcr(tessdataDir).then((o) => o.ocr))
}

const send = (msg: WorkerResponse) => process.parentPort.postMessage(msg)

process.parentPort.on('message', async (e) => {
  const msg = e.data as WorkerRequest
  if (msg.kind !== 'process') return
  try {
    const results = await processFiles(msg.inputs, msg.options, msg.outDir, engines, (event) =>
      send({ kind: 'progress', id: msg.id, event })
    )
    send({ kind: 'result', id: msg.id, results })
  } catch (err) {
    send({ kind: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
  }
})

// Warm up the NER model in the background so the first run is fast.
setTimeout(() => {
  engines.ner().catch(() => {
    nerPromise = null
  })
}, 500)
