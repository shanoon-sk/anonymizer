import { digitsOnly } from './text'

/** Slovak/Czech birth number (rodné číslo): YYMMDD/XXX(X). */
export function isValidRodneCislo(raw: string): boolean {
  const d = digitsOnly(raw)
  if (d.length !== 9 && d.length !== 10) return false
  const yy = +d.slice(0, 2)
  let mm = +d.slice(2, 4)
  const dd = +d.slice(4, 6)
  if (mm > 70) mm -= 70 // women, extended series (since 2004)
  else if (mm > 50) mm -= 50 // women
  else if (mm > 20) mm -= 20 // men, extended series
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false
  if (d.length === 9) return yy < 54 // 9-digit numbers were issued until 1953
  const n = BigInt(d)
  if (n % 11n === 0n) return true
  // Historical exception: first 9 digits mod 11 == 10 and check digit 0
  return BigInt(d.slice(0, 9)) % 11n === 10n && d[9] === '0'
}

/** IČO – 8 digits, weighted mod 11. */
export function isValidIco(raw: string): boolean {
  const d = digitsOnly(raw)
  if (d.length !== 8 || /^0+$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 7; i++) sum += +d[i] * (8 - i)
  const check = (11 - (sum % 11)) % 10
  return check === +d[7]
}

/** Slovak DIČ / IČ DPH numeric part: 10 digits, divisible by 11, first digit non-zero. */
export function isValidSkDic(raw: string): boolean {
  const d = digitsOnly(raw)
  if (d.length !== 10 || d[0] === '0') return false
  return BigInt(d) % 11n === 0n
}

/** Stricter rule for IČ DPH (third digit is 2,3,4,7,8,9). */
export function isValidSkIcDph(raw: string): boolean {
  const d = digitsOnly(raw)
  return isValidSkDic(d) && '234789'.includes(d[2])
}

const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LI: 21,
  LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24,
  PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TN: 24, TR: 26,
  UA: 29, VG: 24, XK: 20
}

export function isValidIban(raw: string): boolean {
  const s = raw.replace(/[\s-]/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false
  const len = IBAN_LENGTHS[s.slice(0, 2)]
  if (len ? s.length !== len : s.length < 15 || s.length > 34) return false
  const rearranged = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of rearranged) {
    const v = ch >= 'A' ? (ch.charCodeAt(0) - 55).toString() : ch
    for (const c of v) rem = (rem * 10 + +c) % 97
  }
  return rem === 1
}

export function luhn(raw: string): boolean {
  const d = digitsOnly(raw)
  if (d.length < 13 || d.length > 19) return false
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let n = +d[d.length - 1 - i]
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return sum % 10 === 0
}

/** Bank codes of Slovak and Czech banks (domestic account format "prefix-number/code"). */
export const BANK_CODES = new Set(
  (
    // SK
    '0200 0720 0900 1100 1111 3000 3100 5200 5600 5900 6500 7300 7500 7930 8050 8100 8120 8130 8160 8170 8180 8191 8320 8330 8360 8370 8400 8410 8420 8430 9952 ' +
    // CZ
    '0100 0300 0600 0710 0800 2010 2020 2060 2070 2100 2200 2220 2250 2260 2600 2700 3030 3050 3060 3500 4000 4300 5500 5800 6000 6100 6200 6210 6300 6363 6700 6800 7910 7950 7960 7970 7990 8030 8040 8060 8090 8150 8190 8198 8199 8200 8220 8250 8255 8265 8270 8280 8293 8299 8500'
  ).split(' ')
)
