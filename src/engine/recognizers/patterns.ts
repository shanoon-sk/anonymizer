import type { Entity, EntityType, Recognizer } from '../types'
import { digitsOnly, escapeRegExp, fold, hasContext, LO, UP, WB, WE } from '../text'
import {
  BANK_CODES,
  isValidDomesticAccount,
  isValidIban,
  isValidIco,
  isValidRodneCislo,
  isValidSkDic,
  isValidSkIcDph,
  luhn
} from '../validators'
import { FIRST_NAMES, LEADING_STOPWORDS, POST_TITLES, TITLES } from './names'

type Emit = (start: number, end: number, score: number, type?: EntityType) => void

/** Small helper: run `re` over text and let `fn` decide what to emit for each match. */
function recognizer(
  name: string,
  type: EntityType,
  re: RegExp,
  fn: (m: RegExpExecArray, text: string, emit: Emit) => void
): Recognizer {
  return {
    name,
    types: [type],
    find(text) {
      const out: Entity[] = []
      const emit: Emit = (start, end, score, t = type) => {
        if (end > start) out.push({ type: t, start, end, score, text: text.slice(start, end), source: name })
      }
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        if (m[0].length === 0) {
          re.lastIndex++
          continue
        }
        fn(m, text, emit)
      }
      return out
    }
  }
}

/** Start/end of capture group `g` (requires the `d` flag), falling back to the whole match. */
function span(m: RegExpExecArray, g = 0): [number, number] {
  const idx = (m as RegExpExecArray & { indices?: [number, number][] }).indices?.[g]
  return idx ? [idx[0], idx[1]] : [m.index, m.index + m[0].length]
}

const ctx = (text: string, s: number, e: number, words: string[], before = 40, after = 0) =>
  hasContext(text, s, e, words, before, after)

// ─── Identifiers ────────────────────────────────────────────────────────────

const RC_CTX = ['rc', 'r.c.', 'rodne cislo', 'rodneho cisla', 'rodnym cislom', 'rod. c.', 'rod.c.', 'birth number']
const rodneCislo = recognizer(
  'rodne-cislo',
  'RODNE_CISLO',
  /(?<![\d/])(\d{6})\s?(\/)?\s?(\d{3,4})(?![\d/])/g,
  (m, text, emit) => {
    const [s, e] = span(m)
    if (!isValidRodneCislo(m[1] + m[3])) return
    const c = ctx(text, s, e, RC_CTX)
    const slash = !!m[2]
    if (!slash && m[0].includes(' ') && !c) return
    emit(s, e, c ? 0.97 : slash ? 0.9 : 0.55)
  }
)

/** Text right before a number that marks it as a document/contract number ("č.", "číslo", "no."). */
const DOC_NUMBER_BEFORE = /(?:^|[^\p{L}])(?:c|cis|cislo|no|nr|num)\.?\s*:?\s*$/u

const ICO_CTX = ['ico', 'ic', 'ico:', 'identifikacne cislo', 'identifikacne cislo organizacie', 'company id']
const ico = recognizer('ico', 'ICO', /(?<![\d/.,-])(\d{2}\s?\d{3}\s?\d{3})(?![\d/]|[,.]\d)/g, (m, text, emit) => {
  const [s, e] = span(m)
  if (!isValidIco(m[1])) return
  const c = ctx(text, s, e, ICO_CTX, 25)
  if (!c && /\s/.test(m[1])) return
  // "faktúra č. 30260001", "zmluva číslo …": a document number that happens to pass the IČO checksum
  if (!c && DOC_NUMBER_BEFORE.test(fold(text.slice(Math.max(0, s - 12), s)))) return
  emit(s, e, c ? 0.95 : 0.55)
})

/** Trade register number of a sole trader ("Číslo živnostenského registra: 560-25788"). */
const zivnostRegister = recognizer(
  'zivnostensky-register',
  'ICO',
  /(?:živnostensk\p{L}*\s+registr\p{L}*|(?<![\p{L}])ŽR)[^\d\n]{0,20}?(\d{3}-\d{3,8}|\d{6,12})(?![\d])/dgiu,
  (m, _text, emit) => {
    const [s, e] = span(m, 1)
    emit(s, e, 0.92)
  }
)

const DIC_CTX = ['dic', 'dic:', 'danove identifikacne cislo', 'tax id']
const dic = recognizer('dic', 'DIC', /(?<![\d/A-Z])(\d{10})(?![\d/])/g, (m, text, emit) => {
  const [s, e] = span(m)
  if (!isValidSkDic(m[1])) return
  const c = ctx(text, s, e, DIC_CTX, 25)
  // "IČ DPH: SK2020…" is handled by the IČ DPH recognizer; skip if directly prefixed by a country code.
  if (/[A-Z]{2}\s?$/.test(text.slice(Math.max(0, s - 3), s))) return
  emit(s, e, c ? 0.95 : 0.5)
})

const VAT_CTX = ['ic dph', 'icdph', 'dic', 'vat', 'vat id', 'ust-idnr', 'dph']
const EU_VAT_PREFIX = 'AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI'
const icDph = recognizer(
  'ic-dph',
  'IC_DPH',
  new RegExp(`${WB}(SK|${EU_VAT_PREFIX})\\s?(U?[0-9A-Z]{8,12})${WE}`, 'gu'),
  (m, text, emit) => {
    const [s, e] = span(m)
    const country = m[1]
    const body = m[2]
    if (country === 'SK') {
      if (body.length === 10 && /^\d+$/.test(body) && isValidSkIcDph(body)) emit(s, e, 0.97)
      return
    }
    if (digitsOnly(body).length < 8) return
    emit(s, e, ctx(text, s, e, VAT_CTX, 30) ? 0.92 : 0.6)
  }
)

const DOKLAD_CTX = [
  'op', 'c. op', 'c.op', 'cislo op', 'obciansky preukaz', 'obcianskeho preukazu', 'obcianskym preukazom',
  'pas', 'cestovny pas', 'cislo pasu', 'cestovneho pasu', 'doklad', 'cislo dokladu totoznosti', 'preukaz',
  'vodicsky preukaz', 'passport', 'id card'
]
const doklad = recognizer('doklad', 'DOKLAD', new RegExp(`${WB}([A-Z]{1,2}\\s?\\d{6,7})${WE}`, 'gu'), (m, text, emit) => {
  const [s, e] = span(m)
  if (/^SK/.test(m[1]) && digitsOnly(m[1]).length > 6) return // likely IČ DPH fragment
  const c = ctx(text, s, e, DOKLAD_CTX, 35)
  const opLike = /^[A-Z]{2}\d{6}$/.test(m[1])
  if (c) emit(s, e, 0.92)
  else if (opLike) emit(s, e, 0.55)
})

// ─── Finance ────────────────────────────────────────────────────────────────

const iban = recognizer(
  'iban',
  'IBAN',
  new RegExp(`${WB}[A-Z]{2}\\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?${WE}`, 'gu'),
  (m, _text, emit) => {
    // The greedy pattern may swallow a following token – shrink until the checksum matches.
    const raw = m[0]
    for (let len = raw.length; len >= 15; len--) {
      if (raw[len - 1] === ' ') continue
      const cand = raw.slice(0, len)
      if (len < raw.length && /[A-Z0-9]/.test(raw[len]) && raw[len - 1] !== ' ' && raw[len] !== ' ') continue
      if (isValidIban(cand)) {
        emit(m.index, m.index + len, 0.99)
        return
      }
    }
  }
)

const BIC_CTX = ['bic', 'swift', 'bic/swift', 'swift/bic', 'swift kod', 'bic kod']
const bic = recognizer('bic', 'BIC', new RegExp(`${WB}([A-Z]{4}([A-Z]{2})[A-Z0-9]{2}(?:[A-Z0-9]{3})?)${WE}`, 'gu'), (m, text, emit) => {
  const [s, e] = span(m)
  if (ctx(text, s, e, BIC_CTX, 25)) emit(s, e, 0.95)
  else if (['SK', 'CZ', 'AT', 'DE', 'HU', 'PL'].includes(m[2]) && /[0-9X]/.test(m[1].slice(6))) emit(s, e, 0.55)
})

const UCET_CTX = ['ucet', 'uctu', 'c.u.', 'c. u.', 'cislo uctu', 'bankove spojenie', 'bankovy ucet', 'account']
const ucet = recognizer('ucet', 'UCET', /(?<![\d-])((?:\d{1,6}-)?\d{2,10})\/(\d{4})(?!\d)/g, (m, text, emit) => {
  const [s, e] = span(m)
  const c = ctx(text, s, e, UCET_CTX, 40)
  const known = BANK_CODES.has(m[2])
  // Without "účet" nearby, require the mandatory SK/CZ mod-11 checksum ("12/2020" is a date, not an account).
  if (known && (c || isValidDomesticAccount(m[1]))) emit(s, e, c ? 0.95 : 0.8)
  else if (c) emit(s, e, 0.7)
})

const KARTA_CTX = ['karta', 'karty', 'kartou', 'card', 'visa', 'mastercard', 'cislo karty']
const karta = recognizer('karta', 'KARTA', /(?<![\d-])([3-6]\d{3}(?:[ -]?\d){9,15})(?![\d-])/g, (m, text, emit) => {
  const [s, e] = span(m)
  if (!luhn(m[1])) return
  emit(s, e, ctx(text, s, e, KARTA_CTX, 40) ? 0.95 : 0.6)
})

const symbol = recognizer(
  'symbol',
  'SYMBOL',
  /(?:(?<![\p{L}])(?:VS|KS|SS|V\.S\.|K\.S\.)|variabiln\p{L}*\s+symbol\p{L}*|kon[sš]tantn\p{L}*\s+symbol\p{L}*|[sš]pecifick\p{L}*\s+symbol\p{L}*)\s*[:.=]?\s*(\d{1,10})(?!\d)/dgiu,
  (m, text, emit) => {
    // Abbreviations count only in capitals: "1 ks 748,00 €" is a quantity in pieces, not a constant symbol.
    if (/^(?:vs|ks|ss|v\.s|k\.s)/.test(m[0]) || /^[,.]\d/.test(text.slice(m.index + m[0].length))) return
    const [s, e] = span(m, 1)
    emit(s, e, 0.92)
  }
)

const CURRENCY = '(?:€|EUR|eur|Eur|Kč|CZK|USD|\\$|£|GBP|Sk)'
const AMOUNT = '\\d{1,3}(?:[ \\u00a0.]\\d{3})*(?:,\\d{1,2})?|\\d+(?:[,.]\\d{1,2})?'
const suma = recognizer(
  'suma',
  'SUMA',
  new RegExp(`(?<![\\d.,])(?:${CURRENCY}\\s?(?:${AMOUNT})|(?:${AMOUNT})\\s?${CURRENCY})${WE}`, 'gu'),
  (m, _text, emit) => emit(m.index, m.index + m[0].length, 0.85)
)

// ─── Contact ────────────────────────────────────────────────────────────────

const email = recognizer(
  'email',
  'EMAIL',
  /(?<![\p{L}\d._%+-])[\p{L}\d][\p{L}\d._%+-]*@[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.\p{L}{2,}/gu,
  (m, _text, emit) => emit(m.index, m.index + m[0].length, 0.97)
)

const TEL_CTX = ['tel', 'tel.', 'telefon', 'telefonne cislo', 'mobil', 'mob.', 'mob', 'kontakt', 'fax', 'phone', 't.c.']
const telefon = recognizer(
  'telefon',
  'TELEFON',
  /(?<![\d+\/])(?:(?:\+|00)\s?(\d{1,3})(?:[\s./-]?\(?\d{1,4}\)?){2,5}|0\d{1,3}(?:[\s/-]?\d{2,3}){2,4}|9\d{2}\s?\d{3}\s?\d{3})(?![\d\/])/g,
  (m, text, emit) => {
    const s = m.index
    const e = s + m[0].length
    const d = digitsOnly(m[0])
    const c = ctx(text, s, e, TEL_CTX, 30)
    if (m[0].startsWith('+') || m[0].startsWith('00')) {
      if (d.length >= 9 && d.length <= 15) emit(s, e, c ? 0.97 : 0.85)
      return
    }
    if (/^9/.test(m[0])) {
      if (c && d.length === 9) emit(s, e, 0.9)
      return
    }
    // Domestic: mobile 09xx xxx xxx (10 digits), landline 0xx… (9–10 digits)
    if (d.length < 9 || d.length > 10) return
    if (/^09\d{8}$/.test(d)) emit(s, e, c ? 0.95 : 0.8)
    else if (/[\s/-]/.test(m[0]) || c) emit(s, e, c ? 0.9 : 0.6)
  }
)

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'()\[\]{}]+|(?<![\p{L}\d@.-])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:sk|cz|com|eu|org|net|info|biz|io|de|at|hu|pl)(?:\/[^\s<>"']*)?(?![\p{L}\d@-])/giu
const url = recognizer('url', 'URL', URL_RE, (m, text, emit) => {
  let e = m.index + m[0].length
  while (e > m.index && /[.,;:!?)]/.test(text[e - 1])) e--
  const val = text.slice(m.index, e)
  const explicit = /^(https?:\/\/|www\.)/i.test(val)
  // Avoid "s.r.o", "a.s" and similar abbreviations – bare domains need at least 2 chars before the TLD.
  if (!explicit && !/^[a-z0-9-]{2,}\./i.test(val)) return
  emit(m.index, e, explicit ? 0.9 : 0.65)
})

const PSC_CTX = ['psc', 'psc:', 'postove smerovacie cislo', 'zip']
/** Horizontal whitespace, and a gap of whitespace containing at most one line break (never a blank line). */
const HS = '[ \\t\\u00a0]'
const GAP = `(?:${HS}+\\n?|\\n)${HS}*`
const CITY = `${UP}${LO}+(?:(?:${HS}+|${HS}?-${HS}?)${UP}${LO}+){0,2}(?:${HS}+\\d{1,2}(?!\\d))?(?:${HS}*-${GAP}mestsk${LO}+${GAP}${LO}+${GAP}${UP}${LO}+(?:${HS}+${UP}${LO}+)?)?`
const psc = recognizer(
  'psc',
  'PSC',
  new RegExp(`(?<![\\d,./-])(\\d{3}\\s?\\d{2})(?![\\d,./-])`, 'gu'),
  (m, text, emit) => {
    const [s, e] = span(m, 1)
    const followedByCity = new RegExp(`^${HS}+${UP}${LO}`, 'u').test(text.slice(e, e + 4))
    const c = ctx(text, s, e, PSC_CTX, 20)
    if (c) emit(s, e, 0.9)
    else if (followedByCity && /\s/.test(m[1])) emit(s, e, 0.75)
    else if (followedByCity) emit(s, e, 0.55)
  }
)

const ADDR_CTX = [
  'adresa', 'adresou', 'adresy', 'sidlo', 'so sidlom', 'sidlom', 'bydlisko', 'bytom', 'trvaly pobyt', 'trvalym pobytom',
  'trvale bytom', 'miesto podnikania', 'prechodny pobyt', 'ulica', 'ul.', 'korespondencna adresa', 'dorucovacia adresa',
  'address', 'byt', 'bytom v', 'miesto dodania'
]
const STREET_WORD = `(?:ul\\.${HS}*)?(?:\\d{1,2}\\.${HS}*)?${UP}[\\p{L}'’.-]*(?:${HS}+(?:${UP}[\\p{L}'’.-]*|${LO}{1,3}\\.?|[\\p{L}]+(?:ská|cká|ova|ná|ého|ej)))?(?:${HS}+${UP}[\\p{L}'’.-]*){0,2}`
const HOUSE_NO = '\\d{1,5}[a-zA-Z]?(?:\\s?\\/\\s?(?:\\d{1,5}[a-zA-Z]?|[a-zA-Z]))?(?![\\d,.]\\d)'
const ADDR_RE = new RegExp(
  `(?<![\\p{L}\\d])(${STREET_WORD})${HS}+(${HOUSE_NO})(?:(${HS}*,${GAP}|${GAP})(\\d{3}${HS}?\\d{2})${GAP}(${CITY}))?`,
  'dgu'
)
const STREET_ENDINGS = /(ská|cká|ova|ová|ná|ia|ého|ej|cesta|ulica|námestie|nám\.|nábrežie|trieda|sady|alej|park|rad|vrch|hora|dolina)$/iu
const addrTrimStop = (s: string) => LEADING_STOPWORDS.has(fold(s.replace(/[:.,]$/, '')))
const adresa = recognizer('adresa', 'ADRESA', ADDR_RE, (m, text, emit) => {
  let [s, e] = span(m)
  let street = m[1]
  // Trim leading label words ("Sídlo Hlavná 5" → "Hlavná 5")
  const words = street.split(/\s+/)
  while (words.length > 1 && addrTrimStop(words[0])) {
    const w = words.shift()!
    s = text.indexOf(words[0], s + w.length)
  }
  street = words.join(' ')
  const hasTail = !!m[4]
  const c = ctx(text, s, e, ADDR_CTX, 40)
  const lastWord = street.split(/\s+/).pop() ?? ''
  const streetLike = STREET_ENDINGS.test(lastWord) || /^ul\./i.test(street) || /^\d{1,2}\./.test(street)
  if (FIRST_NAMES.includes(words[0]) && !hasTail && !c) return
  if (hasTail) emit(s, e, 0.92)
  else if (c && streetLike) emit(s, e, 0.9)
  else if (c) emit(s, e, 0.7)
  else if (streetLike) emit(s, e, 0.62)
})
/** "811 01 Bratislava" without a street. */
const pscCity = recognizer(
  'psc-mesto',
  'ADRESA',
  new RegExp(`(?<![\\d,.])(\\d{3}${HS}\\d{2})${GAP}(${CITY})`, 'gu'),
  (m, _text, emit) => emit(m.index, m.index + m[0].length, 0.75)
)

const SK_DISTRICTS = new Set(
  'BA BB BJ BL BN BR BS BT BY CA DK DS DT GA GL HC HE HI IL KA KE KK KM KN KS LC LE LM LV MA MI ML MT MY NI NM NO NR NZ PB PD PE PK PN PO PP PT PU RA RK RS RV SA SB SC SE SI SK SL SN SO SP SV TN TO TR TS TT TV VK VT ZA ZC ZH ZI ZM ZV'.split(
    ' '
  )
)
const SPZ_CTX = ['ecv', 'spz', 'evidencne cislo', 'vozidlo', 'vozidla', 'auto', 'evc', 'ec vozidla']
const spz = recognizer('spz', 'SPZ', new RegExp(`${WB}([A-Z]{2})[ -]?(\\d{3})[ -]?([A-Z]{2})${WE}`, 'gu'), (m, text, emit) => {
  const s = m.index
  const e = s + m[0].length
  const c = ctx(text, s, e, SPZ_CTX, 40)
  if (c) emit(s, e, 0.95)
  else if (SK_DISTRICTS.has(m[1])) emit(s, e, 0.65)
})

const VIN_CTX = ['vin', 'vin:', 'cislo podvozku', 'podvozok', 'podvozku', 'identifikacne cislo vozidla', 'vozidlo', 'vozidla']
/** Vehicle identification number: 17 characters, no I/O/Q, mixing letters and digits. */
const vin = recognizer('vin', 'VIN', new RegExp(`${WB}([A-HJ-NPR-Z0-9]{17})${WE}`, 'gu'), (m, text, emit) => {
  const [s, e] = span(m)
  const v = m[1]
  const digits = v.replace(/\D/g, '').length
  if (digits < 3 || digits > 14) return
  if (ctx(text, s, e, VIN_CTX, 40)) emit(s, e, 0.95)
  // Most manufacturers end the VIN with a numeric serial; letters up front (WMI) – distinctive enough alone.
  else if (/^[A-Z]{2}/.test(v) && /\d{4}$/.test(v)) emit(s, e, 0.8)
})

// ─── Contract and invoice numbers ────────────────────────────────────────────

/** Folded keyword → what a following "č. …" numbers. `null` = a numbered thing that is not sensitive. */
const NUMBERED: [RegExp, EntityType | null][] = [
  [/zmluv\p{L}*|dodat\p{L}*/u, 'ZMLUVA'],
  [/faktur\p{L}*|dobropis\p{L}*|doklad\p{L}*|objednav\p{L}*|vyuctovan\p{L}*/u, 'FAKTURA'],
  [/zakon\p{L}*|vyhlas\p{L}*|nariaden\p{L}*|smernic\p{L}*|splatk\p{L}*|bod\p{L}*|ods|odsek\p{L}*|pism|clan\p{L}*|cl|priloh\p{L}*|stran\p{L}*|ponuk\p{L}*|polozk\p{L}*|riadok|riadku|tabulk\p{L}*|uznesen\p{L}*|sp|zn/u, null]
]
const DOC_NUMBER = '(?:[A-Z]{1,4}[-/ ]?)?\\d[\\d/-]*\\d'
/** "zmluva … č. 123", "faktúra za … č. FV-2024-001": the nearest numbered noun before the "č." decides. */
const docNumberAfterMarker = new RegExp(`(?<![\\p{L}])(?:č|c|čís|číslo|no|nr)\\.?\\s*:?\\s*(${DOC_NUMBER})(?![\\d\\p{L}]|[.,]\\d)`, 'dgiu')
/** Table/label form: "Číslo zmluvy: 123", "Číslo faktúry\n2024015". */
const docNumberLabel = new RegExp(
  `(?<![\\p{L}])(?:číslo|č\\.)\\s+(zmluvy|faktúry|dokladu|dobropisu|objednávky)\\s*:?${HS}*\\n?${HS}*(${DOC_NUMBER})(?![\\d\\p{L}]|[.,]\\d)`,
  'dgiu'
)
/** Headings like "Faktúra 2026008", "Dobropis č. 12/2024". */
const docNumberHeading = new RegExp(
  `(?<![\\p{L}])(faktúra|dobropis|zmluva)${HS}+(?:(?:č|číslo)\\.?${HS}*:?${HS}*)?(${DOC_NUMBER})(?![\\d\\p{L}]|[.,]\\d)`,
  'dgiu'
)
const docNumbers: Recognizer = {
  name: 'cislo-dokladu',
  types: ['ZMLUVA', 'FAKTURA'],
  find(text) {
    const out: Entity[] = []
    const push = (s: number, e: number, type: EntityType) => {
      if (digitsOnly(text.slice(s, e)).length >= 3) out.push({ type, start: s, end: e, score: 0.9, text: text.slice(s, e), source: 'cislo-dokladu' })
    }
    for (const m of text.matchAll(docNumberLabel)) {
      const [s, e] = span(m, 2)
      push(s, e, /^zmluv/iu.test(m[1]) ? 'ZMLUVA' : 'FAKTURA')
    }
    for (const m of text.matchAll(docNumberHeading)) {
      const [s, e] = span(m, 2)
      push(s, e, /^zmluv/iu.test(m[1]) ? 'ZMLUVA' : 'FAKTURA')
    }
    for (const m of text.matchAll(docNumberAfterMarker)) {
      const [s, e] = span(m, 1)
      const before = fold(text.slice(Math.max(0, m.index - 70), m.index))
      let best: { at: number; type: EntityType | null } | null = null
      for (const [re, type] of NUMBERED) {
        for (const w of before.matchAll(new RegExp(`(?<![\\p{L}])(?:${re.source})(?![\\p{L}])`, 'gu'))) {
          if (!best || w.index > best.at) best = { at: w.index, type }
        }
      }
      if (best?.type) push(s, e, best.type)
    }
    return out
  }
}

// ─── Dates of birth ─────────────────────────────────────────────────────────

const MONTHS = 'január|janu[aá]ra|február|febru[aá]ra|marec|marca|apríl|apríla|máj|mája|jún|júna|júl|júla|august|augusta|september|septembra|október|októbra|november|novembra|december|decembra'
const DOB_CTX = [
  'nar.', 'nar', 'narodeny', 'narodena', 'narodeny/a', 'narodenia', 'datum narodenia', 'dat. nar.', 'd.n.',
  'born', 'date of birth', 'dob', 'narozen', 'narozena', 'datum narozeni'
]
const datumNar = recognizer(
  'datum-nar',
  'DATUM_NAR',
  new RegExp(
    `(?<![\\d.])(?:\\d{1,2}\\.\\s?\\d{1,2}\\.\\s?\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{4}|\\d{1,2}\\.\\s?(?:${MONTHS})\\s+\\d{4})(?![\\d])`,
    'giu'
  ),
  (m, text, emit) => {
    const s = m.index
    const e = s + m[0].length
    if (ctx(text, s, e, DOB_CTX, 40)) emit(s, e, 0.93)
  }
)

// ─── Companies ──────────────────────────────────────────────────────────────

const LEGAL_FORM =
  '(?:spol\\.\\s*s\\s*r\\.\\s*o\\.?|s\\.\\s*r\\.\\s*o\\.?|a\\.\\s*s\\.?|k\\.\\s*s\\.?|v\\.\\s*o\\.\\s*s\\.?|n\\.\\s*o\\.?|[sš]\\.\\s*p\\.?|j\\.\\s*s\\.\\s*a\\.?|družstvo|GmbH|AG|Ltd\\.?|LLC|Inc\\.?|SE|s\\.\\s*e\\.|o\\.\\s*z\\.)'
const COMPANY_WORD = `[${'\\p{Lu}'}\\d][\\p{L}\\d&'’+.\\-]*`
const FIRMA_RE = new RegExp(
  // The legal form is a separate word ("Alfa AG"), not the end of one ("MAG", "BASE").
  `(?<![\\p{L}\\d])((?:${COMPANY_WORD}\\s+){0,5}${COMPANY_WORD})(?:,\\s*|\\s+)${LEGAL_FORM}(?![\\p{L}])`,
  'gu'
)
const TITLE_RE = TITLES.map((t) => escapeRegExp(t).replace(/\\\.\s*/g, '\\.\\s*').replace(/ /g, '\\s*')).join('|')
const PERSON_START = new RegExp(`^(?:${TITLE_RE})`, 'u')
const firma = recognizer('firma', 'FIRMA', FIRMA_RE, (m, text, emit) => {
  let s = m.index
  const e = m.index + m[0].length
  // Table cells come out as consecutive lines. When the lines above the company's last line look like
  // a person (title or known first name), they are a separate cell – start the company on the last line.
  const nl = m[1].lastIndexOf('\n')
  if (nl !== -1) {
    const above = m[1].slice(0, nl).trim()
    if (PERSON_START.test(above) || FIRST_NAMES.includes(above.split(/\s+/)[0])) {
      const tail = m[1].slice(nl + 1)
      s = m.index + nl + 1 + (tail.length - tail.trimStart().length)
    }
  }
  const words = text.slice(s, m.index + m[1].length).split(/\s+/).filter(Boolean)
  while (words.length > 1 && LEADING_STOPWORDS.has(fold(words[0].replace(/[:.,]$/, '')))) {
    const w = words.shift()!
    s = text.indexOf(words[0], s + w.length)
  }
  if (words.length === 1 && LEADING_STOPWORDS.has(fold(words[0]))) return
  emit(s, e, 0.9)
})

// ─── People ─────────────────────────────────────────────────────────────────

const NAME_WORD = `${UP}${LO}+(?:-${UP}${LO}+)?`
const POST_TITLE_RE = POST_TITLES.map(escapeRegExp).join('|')
const titled = recognizer(
  'osoba-titul',
  'OSOBA',
  new RegExp(
    `(?<![\\p{L}])(?:(?:${TITLE_RE})\\s*){1,3}(${NAME_WORD}(?:${HS}+${NAME_WORD}){0,2})(?:,?${HS}*(?:${POST_TITLE_RE}))*`,
    'gu'
  ),
  (m, _text, emit) => emit(m.index, m.index + m[0].length, 0.93)
)

/** First names incl. common inflected forms: Ján → Jána/Jánovi/Jánom; Mária → Márie/Máriou/Márii. */
function inflectedFirstNames(): string {
  const alts = FIRST_NAMES.map((n) => {
    if (/a$/.test(n)) return `${escapeRegExp(n.slice(0, -1))}(?:a|y|e|u|ou|i|ej)`
    return `${escapeRegExp(n)}(?:a|ovi|om|e|u|ovia|ov)?`
  })
  return alts.sort((a, b) => b.length - a.length).join('|')
}
const FIRST = inflectedFirstNames()
const SURNAME = `${UP}${LO}{1,}(?:ová|ovej|ovou|ou)?(?:-${UP}${LO}+)?`
const firstLast = recognizer(
  'osoba-meno',
  'OSOBA',
  new RegExp(`(?<![\\p{L}])(?:${FIRST})\\s+(?:${FIRST}\\s+)?${SURNAME}(?![\\p{L}])`, 'gu'),
  (m, _text, emit) => emit(m.index, m.index + m[0].length, 0.82)
)
/** Surname-first order: "Novák Ján", common in lists and tables. */
const lastFirst = recognizer(
  'osoba-priezvisko-meno',
  'OSOBA',
  new RegExp(`(?<![\\p{L}])${SURNAME}\\s+(?:${FIRST})(?![\\p{L}])`, 'gu'),
  (m, text, emit) => {
    const first = m[0].split(/\s+/)[0]
    if (LEADING_STOPWORDS.has(fold(first))) return
    // The first word must not itself be a first name (then firstLast handles it).
    if (FIRST_NAMES.includes(first)) return
    // Mostly used in lists/tables: require the pair to start a line, cell or list item.
    const before = text.slice(Math.max(0, m.index - 2), m.index)
    if (m.index > 0 && !/(^|[\n\t;,:•\-–]\s?)$/.test(before)) return
    emit(m.index, m.index + m[0].length, 0.65)
  }
)

const PERSON_CTX = [
  'pan', 'pani', 'p.', 'meno', 'meno a priezvisko', 'priezvisko', 'menom', 'zastupeny', 'zastupena', 'konatel',
  'konatelom', 'zamestnanec', 'zamestnanca', 'zamestnankyna', 'podpis', 'vypracoval', 'vystavil', 'schvalil',
  'prevzal', 'kontaktna osoba', 'splnomocneny', 'majitel', 'spolocnik', 'statutar', 'name', 'mr.', 'mrs.', 'ms.'
]
const contextPerson = recognizer(
  'osoba-kontext',
  'OSOBA',
  new RegExp(`(?<![\\p{L}])(${NAME_WORD}(?:${HS}+${NAME_WORD}){1,2})(?![\\p{L}])`, 'gu'),
  (m, text, emit) => {
    const s = m.index
    const e = s + m[0].length
    if (!ctx(text, s, e, PERSON_CTX, 25)) return
    const first = fold(m[1].split(/\s+/)[0])
    if (LEADING_STOPWORDS.has(first)) return
    emit(s, e, 0.75)
  }
)

export const PATTERN_RECOGNIZERS: Recognizer[] = [
  rodneCislo,
  ico,
  zivnostRegister,
  dic,
  icDph,
  doklad,
  iban,
  bic,
  ucet,
  karta,
  symbol,
  suma,
  email,
  telefon,
  url,
  psc,
  adresa,
  pscCity,
  spz,
  vin,
  docNumbers,
  datumNar,
  firma,
  titled,
  firstLast,
  lastFirst,
  contextPerson
]
