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

describe('regressions from real documents', () => {
  it('a person on the line above a company stays a separate person', async () => {
    const t = 'Obchodné meno \nMgr. Oliver Dendis \nReactivity s. r. o. \n'
    expect(await out(t)).toBe('Obchodné meno \n[OSOBA_1] \n[FIRMA_1] \n')
  })

  it('a company name wrapped onto the next line is still one company', async () => {
    expect(await out('so spoločnosťou Gama\nDelta s. r. o. dňa')).toBe('so spoločnosťou [FIRMA_1] dňa')
  })

  it('two addresses in adjacent table cells are kept apart', async () => {
    const t = 'Bulíkova 2679/3, 851 04 \nBratislava-Petržalka \n\nBudatínska 3230/16A, 851 06 Bratislava - \nmestská časť Petržalka \n'
    const o = await out(t)
    expect(o).toContain('[ADRESA_1]')
    expect(o).toContain('[ADRESA_2]')
    for (const leak of ['Bulíkova', '2679', 'Budatínska', '3230', '16A', 'Petržalka']) expect(o).not.toContain(leak)
  })

  it('a month/year date is not a bank account', async () => {
    const t = 'prvé prihlásenie 12/2020, rok výroby 2019 – 2021'
    expect(await out(t)).toBe(t)
  })

  it('an account number without context needs a valid checksum', async () => {
    // 2000145399/0800 is a valid CZ account (mod 11); 2000145398/0800 is not.
    expect(await out('platba na 19-2000145399/0800 prijatá')).toBe('platba na [UCET_1] prijatá')
    expect(await out('referencia 2000145398/0800 prijatá')).toBe('referencia 2000145398/0800 prijatá')
  })

  it('a document number is not an IČO', async () => {
    const t = 'Zálohová faktúra č. 30260001 zo dňa 01. 09. 2026'
    expect(await out(t)).toBe(t)
  })

  it('a common noun the NER model tags as an organisation is not hidden anywhere ("Strana 6 z 6")', async () => {
    // The real model tagged the page footer "Strana" as ORG (0.85); propagation then hid every "strany"/"stranami".
    const ner = async (text: string) =>
      [...text.matchAll(/Strana/g)].map((m) => ({
        type: 'FIRMA' as const, start: m.index, end: m.index + 6, score: 0.85, text: 'Strana', source: 'ner'
      }))
    const res = await anonymizeBatch(
      [[{ text: 'Obidve strany sú daňovníkmi.\nStrana 1 z 2' }, { text: 'Medzi nezávislými stranami.\nStrana 2 z 2' }]],
      { ...DEF, ner }
    )
    expect(res[0].map((r) => r.output)).toEqual(['Obidve strany sú daňovníkmi.\nStrana 1 z 2', 'Medzi nezávislými stranami.\nStrana 2 z 2'])
  })

  it('vehicle identification number (VIN)', async () => {
    expect(await out('VIN \nYV1UZK2VCM1754437 \n')).toBe('VIN \n[VIN_1] \n')
    expect(await out('podvozok WVWZZZ1KZ6W612345, farba sivá')).toBe('podvozok [VIN_1], farba sivá')
    // 17 characters, but only letters: not a VIN
    expect(await out('ABCDEFGHJKLMNPRST')).toBe('ABCDEFGHJKLMNPRST')
  })
})

describe('regressions from a SuperFaktura invoice', () => {
  it('"1 ks 748,00 €" is a quantity and a price, not a constant symbol', async () => {
    const t = 'Použitý tablet Apple iPad Air 1 ks 569,00 € 23% 699,87 €\nKS: 0308, SS 1234'
    expect(await out(t)).toBe('Použitý tablet Apple iPad Air 1 ks 569,00 € 23% 699,87 €\nKS: [SYMBOL_1], SS [SYMBOL_2]')
  })

  it('the variable symbol is hidden wherever the same number appears', async () => {
    const t = 'Faktúra 2026008\nVariabilný symbol: 2026008'
    expect(await out(t)).toBe('Faktúra [SYMBOL_1]\nVariabilný symbol: [SYMBOL_1]')
  })

  it('a trade register number is not split into a postcode', async () => {
    const t = 'Okresný úrad Bratislava, Číslo živnostenského registra: 560-25788\nBulíkova 3\n85104 Bratislava'
    expect(await out(t)).toBe('Okresný úrad Bratislava, Číslo živnostenského registra: [ICO_1]\n[ADRESA_1]')
  })

  it('a city district split over two lines stays in the address', async () => {
    const t = 'Bulíkova 3\n85104 Bratislava - mestská časť\nPetržalka\nSlovensko'
    expect(await out(t)).toBe('[ADRESA_1]\nSlovensko')
  })

  it('a word ending in a legal-form abbreviation is not a company ("MAG", "BASE")', async () => {
    const t = 'Použitá kancelárska stolička MAG GMV0021, model BASE 2'
    expect(await out(t)).toBe(t)
    expect(await out('dodávateľ Alfa AG, Beta GmbH')).toBe('dodávateľ [FIRMA_1], [FIRMA_2]')
  })
})

describe('contract and invoice numbers', () => {
  const DOCS = { types: [...DEFAULT_SELECTED, 'ZMLUVA' as const, 'FAKTURA' as const], customTerms: [] as string[] }

  it('are off by default', async () => {
    const t = 'Zmluva o finančnom prenájme č. 9006978, zálohová faktúra č. 30260001'
    expect(await out(t)).toBe(t)
  })

  it('contract numbers, also in tables and when repeated without "č."', async () => {
    const t = 'Číslo zmluvy \n9006978 \nZmluva o finančnom prenájme č. 9006978 so spoločnosťou\nk zmluve č. 9006978 a k zmluve č. ZM/2024/015'
    expect(await out(t, DOCS)).toBe(
      'Číslo zmluvy \n[ZMLUVA_1] \nZmluva o finančnom prenájme č. [ZMLUVA_1] so spoločnosťou\nk zmluve č. [ZMLUVA_1] a k zmluve č. [ZMLUVA_2]'
    )
  })

  it('invoice and tax document numbers', async () => {
    const t =
      'Zálohová faktúra č. 30260001 zo dňa 01. 09. 2026. Faktúra – daňový doklad k prijatej platbe č. 2026006: preddavok. ' +
      'Vyúčtovacia faktúra za odplatu za postúpenie č. 2026007 zo dňa 14.10.2026, dobropis č. FV-2024-001.'
    expect(await out(t, DOCS)).toBe(
      'Zálohová faktúra č. [FAKTURA_1] zo dňa 01. 09. 2026. Faktúra – daňový doklad k prijatej platbe č. [FAKTURA_2]: preddavok. ' +
        'Vyúčtovacia faktúra za odplatu za postúpenie č. [FAKTURA_3] zo dňa 14.10.2026, dobropis č. [FAKTURA_4].'
    )
  })

  it('leaves law numbers, instalments and other numbered references alone', async () => {
    const t =
      'podľa § 17 ods. 5 zákona č. 595/2003 Z. z. o dani z príjmov; zo zmluvy vyplývajú splátky č. 29 – 48, ' +
      'posledná splátka č. 28; Ponuka č. 3; vyhláška č. 123/2024 Z. z.'
    expect(await out(t, DOCS)).toBe(t)
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
