import type { Entity, EntityType, Recognizer } from '../types'
import { escapeRegExp, fold, WB, WE } from '../text'
import { stemToken } from '../normalize'

export interface KnownValue {
  type: EntityType
  value: string
  score?: number
}

const INFLECTABLE: EntityType[] = ['OSOBA', 'FIRMA', 'ADRESA', 'VLASTNE']

/** Build a folded-text regex for a value. Names get a loose suffix so Slovak inflections match too. */
function valuePattern(kv: KnownValue): string | null {
  const tokens = fold(kv.value.trim()).split(/\s+/).filter(Boolean)
  if (!tokens.length) return null
  const parts = tokens.map((t) => {
    if (INFLECTABLE.includes(kv.type) && /^\p{L}+$/u.test(t)) {
      const stem = stemToken(t)
      if (stem.length >= 4) return `${escapeRegExp(stem)}\\p{L}{0,4}`
    }
    // Digits: allow flexible spacing ("12 345 678" == "12345678")
    if (/^[\d\s]+$/.test(t)) return t.split('').map(escapeRegExp).join('\\s?')
    return escapeRegExp(t)
  })
  return `${WB}${parts.join('[\\s\\u00a0]+')}${WE}`
}

/**
 * Exact (folded, inflection-tolerant) matches of values we already know are sensitive:
 * user-provided custom terms, values from typed spreadsheet columns, and everything detected
 * anywhere else in the batch (so a name found once is hidden everywhere).
 */
export function knownValuesRecognizer(values: KnownValue[], name = 'known'): Recognizer | null {
  const uniq = new Map<string, KnownValue>()
  for (const v of values) {
    const val = v.value.trim()
    if (val.length < 2) continue
    const key = v.type + '\u0000' + fold(val)
    if (!uniq.has(key)) uniq.set(key, { ...v, value: val })
  }
  if (!uniq.size) return null
  const list = [...uniq.values()].sort((a, b) => b.value.length - a.value.length)
  const patterns = list.map(valuePattern)
  // One combined regex with a named group per value would be huge; group values by type instead.
  const byType = new Map<EntityType, { re: RegExp; score: number }[]>()
  list.forEach((kv, i) => {
    const p = patterns[i]
    if (!p) return
    const arr = byType.get(kv.type) ?? []
    arr.push({ re: new RegExp(p, 'gu'), score: kv.score ?? 0.9 })
    byType.set(kv.type, arr)
  })
  // Combine per type into chunks of alternations for speed.
  const compiled: { type: EntityType; re: RegExp; score: number }[] = []
  for (const [type, arr] of byType) {
    for (let i = 0; i < arr.length; i += 200) {
      const chunk = arr.slice(i, i + 200)
      const src = chunk.map((c) => `(?:${c.re.source})`).join('|')
      compiled.push({ type, re: new RegExp(src, 'gu'), score: Math.min(...chunk.map((c) => c.score)) })
    }
  }
  return {
    name,
    types: [...byType.keys()],
    find(text) {
      const folded = fold(text)
      const out: Entity[] = []
      for (const { type, re, score } of compiled) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(folded))) {
          if (!m[0].length) {
            re.lastIndex++
            continue
          }
          out.push({
            type,
            start: m.index,
            end: m.index + m[0].length,
            score,
            text: text.slice(m.index, m.index + m[0].length),
            source: name
          })
        }
      }
      return out
    }
  }
}
