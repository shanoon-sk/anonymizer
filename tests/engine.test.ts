import { describe, expect, it } from 'vitest'
import { anonymizeBatch, anonymizeText } from '../src/engine/pipeline'
import { DEFAULT_SELECTED, ENTITY_TYPES } from '../src/shared/entities'
import { isValidIban, isValidIco, isValidRodneCislo, isValidSkIcDph, luhn } from '../src/engine/validators'
import { applyEntitiesToPieces } from '../src/engine/rewrite'
import { fold } from '../src/engine/text'

const ALL = { types: [...ENTITY_TYPES], customTerms: [] as string[] }
const DEF = { types: DEFAULT_SELECTED, customTerms: [] as string[] }

async function out(text: string, opts = DEF) {
  return (await anonymizeText(text, opts)).output
}

describe('validators', () => {
  it('rodné číslo', () => {
    expect(isValidRodneCislo('850101/0001')).toBe(true)
    expect(isValidRodneCislo('925615/0002')).toBe(true) // woman (+50 month)
    expect(isValidRodneCislo('850101/0002')).toBe(false)
    expect(isValidRodneCislo('851301/0001')).toBe(false) // month 13
    expect(isValidRodneCislo('450101/123')).toBe(true) // 9-digit before 1954
    expect(isValidRodneCislo('650101/123')).toBe(false)
  })
  it('IČO', () => {
    expect(isValidIco('35763469')).toBe(true)
    expect(isValidIco('00151742')).toBe(true)
    expect(isValidIco('12345678')).toBe(false)
  })
  it('IČ DPH, IBAN, Luhn', () => {
    expect(isValidSkIcDph('2020100005')).toBe(true)
    expect(isValidIban('SK31 1200 0000 1987 4263 7541')).toBe(true)
    expect(isValidIban('SK31 1200 0000 1987 4263 7542')).toBe(false)
    expect(luhn('4111 1111 1111 1111')).toBe(true)
    expect(luhn('4111 1111 1111 1112')).toBe(false)
  })
})

describe('fold', () => {
  it('is length preserving', () => {
    for (const s of ['Číslo účtu', 'Ľubomír Ťažký', 'čislo', 'İstanbul', '😀 ok']) expect(fold(s).length).toBe(s.length)
    expect(fold('Číslo Účtu')).toBe('cislo uctu')
  })
})

describe('recognizers', () => {
  it('identifiers on an invoice header', async () => {
    const t = 'Dodávateľ: Alfa Beta s.r.o., IČO: 35763469, DIČ: 2020100005, IČ DPH: SK2020100005'
    expect(await out(t)).toBe('Dodávateľ: [FIRMA_1], IČO: [ICO_1], DIČ: [DIC_1], IČ DPH: [IC_DPH_1]')
  })

  it('bank details', async () => {
    const t = 'IBAN: SK31 1200 0000 1987 4263 7541, SWIFT: TATRSKBX, č. ú. 19-123456789/0200, VS: 2024001'
    expect(await out(t)).toBe('IBAN: [IBAN_1], SWIFT: [BIC_1], č. ú. [UCET_1], VS: [SYMBOL_1]')
  })

  it('IBAN followed by other text is not over-matched', async () => {
    expect(await out('účet SK3112000000198742637541 BANKA')).toBe('účet [IBAN_1] BANKA')
  })

  it('personal data', async () => {
    const t = 'Zamestnanec Ing. Ján Novák, rodné číslo 850101/0001, nar. 1. 1. 1985, OP: EA123456'
    expect(await out(t)).toBe('Zamestnanec [OSOBA_1], rodné číslo [RODNE_CISLO_1], nar. [DATUM_NAR_1], OP: [DOKLAD_1]')
  })

  it('contact data', async () => {
    const t = 'Kontakt: jan.novak@firma.sk, tel. +421 905 123 456, mobil 0905 654 321, web www.firma.sk'
    expect(await out(t)).toBe('Kontakt: [EMAIL_1], tel. [TELEFON_1], mobil [TELEFON_2], web [URL_1]')
  })

  it('addresses', async () => {
    expect(await out('Sídlo: Hlavná 12, 811 01 Bratislava')).toBe('Sídlo: [ADRESA_1]')
    expect(await out('bytom Štúrova 5/A, Košice')).toBe('bytom [ADRESA_1], Košice')
    expect(await out('PSČ: 04001')).toBe('PSČ: [PSC_1]')
  })

  it('license plates and cards', async () => {
    expect(await out('vozidlo EČV BA123AB, karta 4111 1111 1111 1111')).toBe('vozidlo EČV [SPZ_1], karta [KARTA_1]')
  })

  it('amounts only when enabled', async () => {
    const t = 'Spolu k úhrade 1 250,50 €'
    expect(await out(t)).toBe(t)
    expect(await out(t, ALL)).toBe('Spolu k úhrade [SUMA_1]')
  })

  it('does not flag ordinary numbers and words', async () => {
    const t = 'Faktúra č. 2024015, strana 2 z 3, dátum vystavenia 15. 3. 2024, množstvo 12 ks, účet 518001'
    expect(await out(t)).toBe(t)
  })

  it('respects disabled types', async () => {
    const t = 'E-mail: jan@firma.sk, IČO: 35763469'
    expect(await out(t, { types: ['ICO'], customTerms: [] })).toBe('E-mail: jan@firma.sk, IČO: [ICO_1]')
  })
})

describe('consistency', () => {
  it('same value → same placeholder, inflected names included', async () => {
    const t = 'Ján Novák podpísal zmluvu. Jána Nováka sme kontaktovali, Novák súhlasil. Mária Kováčová nesúhlasila.'
    expect(await out(t)).toBe('[OSOBA_1] podpísal zmluvu. [OSOBA_1] sme kontaktovali, [OSOBA_1] súhlasil. [OSOBA_2] nesúhlasila.')
  })

  it('values detected in one document are hidden in others', async () => {
    const res = await anonymizeBatch(
      [[{ text: 'Odberateľ: Gama Delta s.r.o.' }], [{ text: 'Platba od Gama Delta prijatá.' }, { text: 'IČO 35763469' }]],
      DEF
    )
    expect(res[0][0].output).toBe('Odberateľ: [FIRMA_1]')
    expect(res[1][0].output).toBe('Platba od [FIRMA_1] prijatá.')
    expect(res[1][1].output).toBe('IČO [ICO_1]')
  })

  it('custom terms', async () => {
    const r = await anonymizeText('Projekt Zelený Dom pre klienta', { types: DEFAULT_SELECTED, customTerms: ['zelený dom'] })
    expect(r.output).toBe('Projekt [VLASTNE_1] pre klienta')
  })

  it('column context and forced types (spreadsheets)', async () => {
    const res = await anonymizeBatch([[{ text: '35763469', context: 'IČO' }, { text: 'Peter Malý', forceType: 'OSOBA' }]], DEF)
    expect(res[0].map((r) => r.output)).toEqual(['[ICO_1]', '[OSOBA_1]'])
  })
})

describe('applyEntitiesToPieces', () => {
  it('keeps run boundaries', () => {
    const pieces = ['Pán Ján ', 'Nov', 'ák prišiel']
    const ents = [{ type: 'OSOBA' as const, start: 4, end: 13, score: 1, text: 'Ján Novák', source: 't', placeholder: '[OSOBA_1]' }]
    expect(applyEntitiesToPieces(pieces, ents)).toEqual(['Pán [OSOBA_1]', '', ' prišiel'])
  })
})
