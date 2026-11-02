/**
 * Lower-case and strip diacritics: "Číslo Účtu" → "cislo uctu".
 * Strictly length-preserving (UTF-16 units), so offsets in folded text map 1:1 to the original.
 */
export function fold(s: string): string {
  let out = ''
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    if (f.length === ch.length) out += f
    else {
      const l = ch.toLowerCase()
      out += l.length === ch.length ? l : ch
    }
  }
  return out
}

/** Unicode-aware word boundaries (JS `\b` only knows ASCII). */
export const WB = '(?<![\\p{L}\\p{N}_])'
export const WE = '(?![\\p{L}\\p{N}_])'

/** Upper-case letter incl. Slovak/Czech diacritics. */
export const UP = '\\p{Lu}'
/** Lower-case letter incl. diacritics. */
export const LO = '\\p{Ll}'

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '')
}

/**
 * True if any of `words` (already folded) appears in the `window` characters before `start`
 * (or after `end` when `after` > 0).
 */
export function hasContext(
  text: string,
  start: number,
  end: number,
  words: string[],
  before = 40,
  after = 0
): boolean {
  if (!words.length) return false
  const pre = fold(text.slice(Math.max(0, start - before), start))
  const post = after ? fold(text.slice(end, end + after)) : ''
  return words.some((w) => containsWord(pre, w) || (post && containsWord(post, w)))
}

function containsWord(hay: string, word: string): boolean {
  let i = hay.indexOf(word)
  while (i !== -1) {
    const b = i === 0 || !/[\p{L}\p{N}]/u.test(hay[i - 1])
    const e = i + word.length >= hay.length || !/[\p{L}\p{N}]/u.test(hay[i + word.length]) || /[.:]$/.test(word)
    if (b && e) return true
    i = hay.indexOf(word, i + 1)
  }
  return false
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
