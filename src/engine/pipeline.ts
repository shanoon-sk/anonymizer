import type { AnonymizeOptions, EntityType } from '../shared/entities'
import type { Entity, Recognizer, ResolvedEntity, Segment, SegmentResult } from './types'
import { PATTERN_RECOGNIZERS } from './recognizers/patterns'
import { type KnownValue, knownValuesRecognizer } from './recognizers/known'
import { mergeEntities } from './merge'
import { PlaceholderRegistry } from './placeholder'
import { applyEntities } from './rewrite'
import { stemToken } from './normalize'

/** Async entity source, e.g. the offline NER model. Receives plain text, returns spans in it. */
export type NerFn = (text: string) => Promise<Entity[]>

export interface DetectOptions extends Pick<AnonymizeOptions, 'types' | 'customTerms'> {
  ner?: NerFn
}

const LEGAL_FORM_TAIL = /,?\s*(spol\.\s*s\s*r\.\s*o\.?|s\.\s*r\.\s*o\.?|a\.\s*s\.?|k\.\s*s\.?|v\.\s*o\.\s*s\.?|n\.\s*o\.?|družstvo|GmbH|AG|Ltd\.?|LLC|Inc\.?|SE)$/iu

/** Types whose values are worth re-matching across the whole batch (consistency pass). */
const PROPAGATE: EntityType[] = [
  'OSOBA', 'FIRMA', 'RODNE_CISLO', 'ICO', 'DIC', 'IC_DPH', 'IBAN', 'UCET', 'EMAIL', 'TELEFON', 'ADRESA', 'DOKLAD', 'SPZ', 'VIN', 'KARTA', 'BIC', 'ZMLUVA', 'FAKTURA', 'SYMBOL'
]

function runRecognizers(recognizers: Recognizer[], text: string, enabled: Set<EntityType>): Entity[] {
  const out: Entity[] = []
  for (const r of recognizers) {
    if (!r.types.some((t) => enabled.has(t))) continue
    for (const e of r.find(text)) if (enabled.has(e.type)) out.push(e)
  }
  return out
}

/** Detect entities in one segment (regex + optional NER), offsets relative to `seg.text`. */
export async function detectSegment(
  seg: Segment,
  enabled: Set<EntityType>,
  extra: Recognizer[],
  ner?: NerFn
): Promise<Entity[]> {
  const text = seg.text
  if (!text.trim()) return []
  if (seg.forceType && enabled.has(seg.forceType)) {
    const lead = text.length - text.trimStart().length
    const trail = text.trimEnd().length
    return [{ type: seg.forceType, start: lead, end: trail, score: 1, text: text.slice(lead, trail), source: 'column' }]
  }
  // Prepend context (e.g. column header) so context-dependent recognizers can see it.
  const prefix = seg.context ? seg.context.trim() + ': ' : ''
  const full = prefix + text
  let found = runRecognizers([...PATTERN_RECOGNIZERS, ...extra], full, enabled)
  if (ner && /\p{Lu}/u.test(text) && text.trim().length > 2) {
    const nerHits = await ner(full)
    found = found.concat(nerHits.filter((e) => enabled.has(e.type)))
  }
  const shift = prefix.length
  return found
    .filter((e) => e.start >= shift)
    .map((e) => ({ ...e, start: e.start - shift, end: e.end - shift }))
}

export interface BatchProgress {
  phase: 'detect' | 'resolve'
  done: number
  total: number
}

/**
 * Anonymize a batch of documents, each given as a list of text segments.
 * Pass 1 detects entities per segment; pass 2 re-scans every segment for values found anywhere
 * in the batch (so a name recognised once is hidden everywhere, incl. inflected forms);
 * finally placeholders are assigned consistently in reading order.
 */
export async function anonymizeBatch(
  docs: Segment[][],
  opts: DetectOptions,
  onProgress?: (p: BatchProgress) => void
): Promise<SegmentResult[][]> {
  const enabled = new Set<EntityType>(opts.types)
  const custom: KnownValue[] = opts.customTerms
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .map((value) => ({ type: 'VLASTNE' as const, value, score: 1 }))
  if (custom.length) enabled.add('VLASTNE')
  const customRec = knownValuesRecognizer(custom, 'custom')
  const extra = customRec ? [customRec] : []

  const total = docs.reduce((n, d) => n + d.length, 0)
  let done = 0

  // Pass 1
  const pass1: Entity[][][] = []
  for (const segs of docs) {
    const res: Entity[][] = []
    for (const seg of segs) {
      res.push(await detectSegment(seg, enabled, extra, opts.ner))
      done++
      if (onProgress && (done % 20 === 0 || done === total)) onProgress({ phase: 'detect', done, total })
    }
    pass1.push(res)
  }

  // A single word the NER model tags as a company/place but that the batch also uses in lower case is a
  // common noun ("Strana 1 z 6" vs. "obidve strany"). Drop it before it is propagated everywhere.
  const commonStems = new Set<string>()
  for (const segs of docs)
    for (const seg of segs) for (const w of seg.text.match(/(?<![\p{L}\d])\p{Ll}\p{L}{2,}/gu) ?? []) commonStems.add(stemToken(w))
  const isCommonNoun = (e: Entity) =>
    e.source === 'ner' && (e.type === 'FIRMA' || e.type === 'ADRESA') && !/\s/.test(e.text.trim()) && commonStems.has(stemToken(e.text.trim()))
  for (const res of pass1) for (let si = 0; si < res.length; si++) res[si] = res[si].filter((e) => !isCommonNoun(e))

  // Collect confident values for the consistency pass
  const known: KnownValue[] = []
  docs.forEach((segs, di) =>
    segs.forEach((seg, si) => {
      const merged = mergeEntities(pass1[di][si], seg.text)
      for (const e of merged) {
        if ((!PROPAGATE.includes(e.type) && e.source !== 'column') || e.score < 0.6) continue
        const v = e.text.trim()
        if (v.length < 3) continue
        // Short document numbers and symbols ("č. 15", "KS 0308") would hide unrelated numbers everywhere.
        if ((e.type === 'ZMLUVA' || e.type === 'FAKTURA' || e.type === 'SYMBOL') && v.replace(/\W/g, '').length < 5) continue
        known.push({ type: e.type, value: v, score: Math.min(0.88, e.score) })
        // Company name without the legal form ("Gama Delta s.r.o." → "Gama Delta")
        if (e.type === 'FIRMA') {
          const bare = v.replace(LEGAL_FORM_TAIL, '').trim()
          if (bare.length >= 4 && bare !== v) known.push({ type: 'FIRMA', value: bare, score: 0.8 })
        }
        // Also hide the surname alone ("Ján Novák" → "Novák") – only for longer surnames.
        if (e.type === 'OSOBA') {
          const parts = v.split(/\s+/)
          const last = parts[parts.length - 1]
          if (parts.length >= 2 && /^\p{Lu}\p{Ll}{3,}/u.test(last)) known.push({ type: 'OSOBA', value: last, score: 0.7 })
        }
      }
    })
  )
  const knownRec = knownValuesRecognizer(known)

  // Pass 2 + placeholders
  const registry = new PlaceholderRegistry()
  const results: SegmentResult[][] = []
  done = 0
  docs.forEach((segs, di) => {
    const docRes: SegmentResult[] = []
    segs.forEach((seg, si) => {
      let ents = pass1[di][si]
      if (knownRec && seg.text.trim()) ents = ents.concat(knownRec.find(seg.text).filter((e) => enabled.has(e.type)))
      const merged = mergeEntities(ents, seg.text)
      const resolved: ResolvedEntity[] = merged.map((e) => ({ ...e, placeholder: registry.get(e.type, e.text) }))
      docRes.push({ entities: resolved, output: applyEntities(seg.text, resolved) })
      done++
    })
    results.push(docRes)
    onProgress?.({ phase: 'resolve', done, total })
  })
  registry.clear()
  return results
}

/** Convenience for tests / simple text: anonymize a single string. */
export async function anonymizeText(text: string, opts: DetectOptions): Promise<SegmentResult> {
  const [[res]] = await anonymizeBatch([[{ text }]], opts)
  return res
}
