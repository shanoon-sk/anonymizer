import type { ResolvedEntity } from './types'

/** Replace entity spans (sorted, non-overlapping) with their placeholders. */
export function applyEntities(text: string, entities: ResolvedEntity[]): string {
  let out = ''
  let pos = 0
  for (const e of entities) {
    out += text.slice(pos, e.start) + e.placeholder
    pos = e.end
  }
  return out + text.slice(pos)
}

/**
 * Same as applyEntities, but the text is split into pieces (e.g. Word runs with different formatting).
 * The placeholder goes into the piece where the entity starts; its remaining characters are removed
 * from the following pieces, so formatting of unaffected text is preserved.
 */
export function applyEntitiesToPieces(pieces: string[], entities: ResolvedEntity[]): string[] {
  if (!entities.length) return pieces.slice()
  const out: string[] = []
  let offset = 0
  let ei = 0
  for (const piece of pieces) {
    const pStart = offset
    const pEnd = offset + piece.length
    let res = ''
    let pos = pStart
    while (pos < pEnd) {
      while (ei < entities.length && entities[ei].end <= pos) ei++
      const e = entities[ei]
      if (!e || e.start >= pEnd) {
        res += piece.slice(pos - pStart)
        pos = pEnd
        break
      }
      if (e.start > pos) {
        res += piece.slice(pos - pStart, e.start - pStart)
        pos = e.start
      }
      // pos is inside entity e
      if (pos === e.start) res += e.placeholder
      pos = Math.min(e.end, pEnd)
    }
    out.push(res)
    offset = pEnd
  }
  return out
}
