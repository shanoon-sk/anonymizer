import type { Entity, EntityType } from './types'
import type { NerFn } from './pipeline'
import { fold } from './text'
import { GENERIC_LOCATIONS, LEADING_STOPWORDS, PRODUCT_BRANDS, PUBLIC_BODY } from './recognizers/names'

export const NER_MODEL_ID = 'Xenova/bert-base-multilingual-cased-ner-hrl'

interface TokenPrediction {
  entity: string
  score: number
  index: number
  word: string
}

type TokenClassifier = ((text: string) => Promise<TokenPrediction[]>) & {
  tokenizer: { tokenize(text: string): string[] }
}

const LABEL_MAP: Record<string, { type: EntityType; weight: number }> = {
  PER: { type: 'OSOBA', weight: 0.95 },
  ORG: { type: 'FIRMA', weight: 0.85 },
  LOC: { type: 'ADRESA', weight: 0.72 }
}

/** Max characters per inference chunk (keeps us well below the model's 512-token limit). */
const CHUNK_CHARS = 900

/** Split text into chunks at line/sentence boundaries. Returns [start, end] pairs. */
export function chunkText(text: string, max = CHUNK_CHARS): [number, number][] {
  const out: [number, number][] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + max)
    if (end < text.length) {
      const window = text.slice(start, end)
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('; '))
      if (cut > max * 0.4) end = start + cut + 1
      else {
        const sp = window.lastIndexOf(' ')
        if (sp > max * 0.4) end = start + sp + 1
      }
    }
    out.push([start, end])
    start = end
  }
  return out
}

/** Map WordPiece tokens back to character offsets by scanning the text left to right. */
function alignTokens(text: string, tokens: string[]): ([number, number] | null)[] {
  const res: ([number, number] | null)[] = []
  let cursor = 0
  for (const tok of tokens) {
    const piece = tok.startsWith('##') ? tok.slice(2) : tok
    if (!piece || tok === '[UNK]') {
      res.push(null)
      continue
    }
    let i = text.indexOf(piece, cursor)
    if (i === -1 || i - cursor > 50) {
      // Tokenizer normalisation may differ (e.g. unicode forms) – try a folded match.
      const f = fold(text).indexOf(fold(piece), cursor)
      i = f !== -1 && f - cursor <= 50 ? f : -1
    }
    if (i === -1) {
      res.push(null)
      continue
    }
    res.push([i, i + piece.length])
    cursor = i + piece.length
  }
  return res
}

function extendToWord(text: string, start: number, end: number): [number, number] {
  while (start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1])) start--
  while (end < text.length && /[\p{L}\p{N}]/u.test(text[end])) end++
  return [start, end]
}

export async function nerOnChunk(classifier: TokenClassifier, text: string): Promise<Entity[]> {
  const preds = await classifier(text)
  if (!preds.length) return []
  const tokens = classifier.tokenizer.tokenize(text)
  const offsets = alignTokens(text, tokens)

  const out: Entity[] = []
  let cur: { label: string; start: number; end: number; scores: number[]; lastIndex: number } | null = null
  const flush = () => {
    if (!cur) return
    const map = LABEL_MAP[cur.label]
    if (map) {
      const [s, e] = extendToWord(text, cur.start, cur.end)
      const value = text.slice(s, e).trim()
      const avg = cur.scores.reduce((a, b) => a + b, 0) / cur.scores.length
      const f = fold(value)
      const reject =
        value.length < 2 ||
        !/\p{Lu}/u.test(value) ||
        LEADING_STOPWORDS.has(f) ||
        (map.type === 'ADRESA' && GENERIC_LOCATIONS.has(f)) ||
        (map.type === 'FIRMA' && PUBLIC_BODY.test(f)) ||
        (map.type === 'FIRMA' && PRODUCT_BRANDS.has(f)) ||
        // Short acronyms are almost always labels in accounting docs (IBAN, DPH, IČO, EUR, SR…)
        (map.type !== 'OSOBA' && /^[\p{Lu}\d.]{1,5}$/u.test(value)) ||
        // A single-word organisation needs high confidence
        (map.type === 'FIRMA' && !/\s/.test(value) && avg < 0.8)
      if (!reject) out.push({ type: map.type, start: s, end: e, score: avg * map.weight, text: text.slice(s, e), source: 'ner' })
    }
    cur = null
  }

  for (const p of preds) {
    const off = offsets[p.index - 1] // index 0 is [CLS]
    if (!off) continue
    const [bio, label] = p.entity.includes('-') ? (p.entity.split('-') as [string, string]) : ['I', p.entity]
    const isSubword = p.word.startsWith('##')
    const continues =
      cur && cur.label === label && (bio === 'I' || isSubword) && p.index === cur.lastIndex + 1
    if (continues && cur) {
      cur.end = off[1]
      cur.scores.push(p.score)
      cur.lastIndex = p.index
    } else {
      flush()
      cur = { label, start: off[0], end: off[1], scores: [p.score], lastIndex: p.index }
    }
  }
  flush()
  return out
}

/** Loads the bundled NER model (fully offline) and returns a NerFn for the pipeline. */
export async function createNer(modelRoot: string): Promise<NerFn> {
  const { pipeline, env } = await import('@huggingface/transformers')
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = modelRoot.endsWith('/') ? modelRoot : modelRoot + '/'
  env.useBrowserCache = false
  env.useFSCache = false
  const classifier = (await pipeline('token-classification', NER_MODEL_ID, { dtype: 'q8' })) as unknown as TokenClassifier

  return async (text: string) => {
    const out: Entity[] = []
    for (const [s, e] of chunkText(text)) {
      const chunk = text.slice(s, e)
      if (!/\p{Lu}/u.test(chunk)) continue
      for (const ent of await nerOnChunk(classifier, chunk)) {
        out.push({ ...ent, start: ent.start + s, end: ent.end + s })
      }
    }
    return out
  }
}
