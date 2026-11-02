import { type Entity, SCORE_THRESHOLD } from './types'

/**
 * Resolve overlapping detections into a clean, non-overlapping, sorted list.
 * 1. Drop low-confidence spans.
 * 2. Greedily keep the best span among overlapping ones (score, then length); a slightly weaker
 *    span that fully contains its competitors wins (full address vs. the PSČ inside it).
 */
export function mergeEntities(entities: Entity[], _text: string, threshold = SCORE_THRESHOLD): Entity[] {
  const strong = entities.filter((e) => e.score >= threshold && e.end > e.start)

  const unioned = strong.map((e) => ({ ...e }))

  // Cross-type greedy selection
  unioned.sort((a, b) => b.score - a.score || b.end - b.start - (a.end - a.start) || a.start - b.start)
  const chosen: Entity[] = []
  for (const e of unioned) {
    const conflicts = chosen.filter((c) => e.start < c.end && c.start < e.end)
    if (!conflicts.length) {
      chosen.push(e)
      continue
    }
    // A slightly weaker span that fully contains all conflicts wins
    // (e.g. full address "Hlavná 5, 811 01 Bratislava" vs. the PSČ inside it).
    const containsAll = conflicts.every((c) => e.start <= c.start && e.end >= c.end && e.end - e.start > c.end - c.start)
    const best = Math.max(...conflicts.map((c) => c.score))
    if (containsAll && e.score >= best - 0.2) {
      for (const c of conflicts) chosen.splice(chosen.indexOf(c), 1)
      chosen.push(e)
    }
  }
  return chosen.sort((a, b) => a.start - b.start)
}
