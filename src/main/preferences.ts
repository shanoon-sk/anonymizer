import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ENTITY_TYPES, type EntityType } from '../shared/entities'
import type { Preferences } from '../shared/ipc'

// UI preferences only (which types are ticked, output folder).
// Never document content and never the custom terms – those may contain client names.
const file = () => join(app.getPath('userData'), 'preferences.json')

export function loadPreferences(): Preferences | null {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Preferences>
    const types = Array.isArray(raw.types) ? raw.types.filter((t): t is EntityType => (ENTITY_TYPES as readonly string[]).includes(t)) : null
    if (!types) return null
    return {
      types,
      outDir: typeof raw.outDir === 'string' && raw.outDir ? raw.outDir : null
    }
  } catch {
    return null
  }
}

export function savePreferences(p: Preferences): void {
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify({ types: p.types, outDir: p.outDir }, null, 2))
  } catch {
    /* non-critical */
  }
}
