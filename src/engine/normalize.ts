import type { EntityType } from './types'
import { digitsOnly, fold } from './text'

// Slovak declension endings, longest first. Stripping them maps "Nováka", "Novákovi", "Novákom" → "novak".
const SUFFIXES = ['ovia', 'ovi', 'ymi', 'ich', 'ych', 'ami', 'om', 'ou', 'ej', 'ho', 'mu', 'ym', 'a', 'u', 'e', 'i', 'y', 'o']

export function stemToken(token: string): string {
  const t = fold(token)
  for (const s of SUFFIXES) {
    if (t.endsWith(s) && t.length - s.length >= 3) return t.slice(0, -s.length)
  }
  return t
}

const NUMERIC_TYPES: EntityType[] = ['RODNE_CISLO', 'ICO', 'DIC', 'KARTA', 'TELEFON', 'PSC', 'SYMBOL', 'UCET']
const TITLE_RE = /\b(ing|mgr|bc|judr|mudr|mddr|mvdr|phdr|rndr|paeddr|pharmdr|thdr|dr|doc|prof|phd|csc|drsc|mba|arch|art|dis)\b\.?/g

const LEGAL_TOKENS = new Set(['sro', 'as', 'ks', 'vos', 'no', 'sp', 'gmbh', 'ag', 'ltd', 'llc', 'inc', 'se', 'druzstvo', 'spol'])

/** Canonical key for an entity value, so the same real-world value always gets the same placeholder. */
export function canonicalKey(type: EntityType, value: string): string {
  if (NUMERIC_TYPES.includes(type)) {
    let d = digitsOnly(value)
    if (type === 'TELEFON') d = d.replace(/^(00)?421/, '0').replace(/^(00)?420/, '0')
    return d
  }
  if (type === 'IBAN' || type === 'IC_DPH' || type === 'BIC' || type === 'SPZ' || type === 'DOKLAD')
    return value.replace(/[\s-]/g, '').toUpperCase()
  if (type === 'EMAIL' || type === 'URL')
    return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
  let f = fold(value)
  if (type === 'OSOBA') f = f.replace(TITLE_RE, ' ')
  if (type === 'FIRMA') f = f.replace(/[,.]/g, ' ').replace(/\bspol\s+s\s+r\s+o\b/g, 'sro').replace(/\bs\s*r\s*o\b/g, 'sro').replace(/\ba\s*s\b/g, 'as')
  let tokens = f.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (type === 'FIRMA') {
    const bare = tokens.filter((t) => !LEGAL_TOKENS.has(t))
    if (bare.length) tokens = bare
  }
  if (type === 'OSOBA' || type === 'FIRMA' || type === 'ADRESA' || type === 'VLASTNE') return tokens.map(stemToken).join(' ')
  return tokens.join(' ')
}
