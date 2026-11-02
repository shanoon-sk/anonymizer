import type { EntityType } from './types'
import { canonicalKey } from './normalize'

/**
 * Assigns stable numbered placeholders ([OSOBA_1], [IBAN_2]…) within one batch.
 * Lives only in memory for the duration of a job – never persisted.
 */
export class PlaceholderRegistry {
  private map = new Map<string, string>()
  private counters = new Map<EntityType, number>()
  /** For people: surname-only mentions reuse the full-name placeholder ("Novák" ↔ "Ján Novák"). */
  private personTokens = new Map<string, string>()

  get(type: EntityType, value: string): string {
    const key = canonicalKey(type, value) || value
    const full = `${type}\u0000${key}`
    const hit = this.map.get(full)
    if (hit) return hit

    if (type === 'OSOBA') {
      const tokens = key.split(' ')
      const last = tokens[tokens.length - 1]
      if (tokens.length === 1) {
        const p = this.personTokens.get(last)
        if (p) {
          this.map.set(full, p)
          return p
        }
      } else if (last && last.length >= 3) {
        // Same surname with an already-seen single-token mention → reuse it
        const p = this.map.get(`OSOBA\u0000${last}`)
        if (p) {
          this.map.set(full, p)
          return p
        }
      }
    }

    const n = (this.counters.get(type) ?? 0) + 1
    this.counters.set(type, n)
    const ph = `[${type}_${n}]`
    this.map.set(full, ph)
    if (type === 'OSOBA') {
      const tokens = key.split(' ')
      const last = tokens[tokens.length - 1]
      if (tokens.length > 1 && last.length >= 3 && !this.personTokens.has(last)) this.personTokens.set(last, ph)
    }
    return ph
  }

  clear(): void {
    this.map.clear()
    this.counters.clear()
    this.personTokens.clear()
  }
}
