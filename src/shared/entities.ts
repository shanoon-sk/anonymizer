// Catalog of anonymizable data types. Shared by the engine (detection) and the UI (checkboxes).

export const ENTITY_TYPES = [
  'OSOBA',
  'RODNE_CISLO',
  'DATUM_NAR',
  'DOKLAD',
  'FIRMA',
  'ICO',
  'DIC',
  'IC_DPH',
  'IBAN',
  'BIC',
  'UCET',
  'KARTA',
  'SYMBOL',
  'SUMA',
  'EMAIL',
  'TELEFON',
  'ADRESA',
  'PSC',
  'URL',
  'SPZ',
  'VLASTNE'
] as const

export type EntityType = (typeof ENTITY_TYPES)[number]

export interface EntityGroup {
  id: string
  label: string
  items: { type: EntityType; label: string; hint?: string; defaultOn: boolean }[]
}

export const ENTITY_GROUPS: EntityGroup[] = [
  {
    id: 'osoby',
    label: 'Osoby',
    items: [
      { type: 'OSOBA', label: 'Mená osôb', hint: 'Ján Novák, Ing. Mária Kováčová', defaultOn: true },
      { type: 'RODNE_CISLO', label: 'Rodné číslo', hint: '850101/1234', defaultOn: true },
      { type: 'DATUM_NAR', label: 'Dátum narodenia', hint: 'nar. 1. 1. 1985', defaultOn: true },
      { type: 'DOKLAD', label: 'Číslo OP / pasu', hint: 'EA123456', defaultOn: true }
    ]
  },
  {
    id: 'firmy',
    label: 'Firmy',
    items: [
      { type: 'FIRMA', label: 'Názvy firiem', hint: 'ABC s.r.o.', defaultOn: true },
      { type: 'ICO', label: 'IČO', hint: '12345678', defaultOn: true },
      { type: 'DIC', label: 'DIČ', hint: '2020123456', defaultOn: true },
      { type: 'IC_DPH', label: 'IČ DPH', hint: 'SK2020123456', defaultOn: true }
    ]
  },
  {
    id: 'financie',
    label: 'Financie',
    items: [
      { type: 'IBAN', label: 'IBAN', hint: 'SK31 1200 0000 …', defaultOn: true },
      { type: 'BIC', label: 'BIC / SWIFT', hint: 'TATRSKBX', defaultOn: true },
      { type: 'UCET', label: 'Číslo účtu', hint: '123456789/0200', defaultOn: true },
      { type: 'KARTA', label: 'Platobná karta', hint: '4111 1111 1111 1111', defaultOn: true },
      { type: 'SYMBOL', label: 'Variabilný / konštantný symbol', hint: 'VS: 2024001', defaultOn: true },
      { type: 'SUMA', label: 'Sumy', hint: '1 250,00 €', defaultOn: false }
    ]
  },
  {
    id: 'kontakt',
    label: 'Kontakt a adresa',
    items: [
      { type: 'EMAIL', label: 'E-mail', hint: 'jan@firma.sk', defaultOn: true },
      { type: 'TELEFON', label: 'Telefón', hint: '+421 905 123 456', defaultOn: true },
      { type: 'ADRESA', label: 'Adresa', hint: 'Hlavná 12, Bratislava', defaultOn: true },
      { type: 'PSC', label: 'PSČ', hint: '811 01', defaultOn: true },
      { type: 'URL', label: 'Webová adresa', hint: 'www.firma.sk', defaultOn: true },
      { type: 'SPZ', label: 'EČV (ŠPZ)', hint: 'BA123AB', defaultOn: true }
    ]
  }
]

export const DEFAULT_SELECTED: EntityType[] = ENTITY_GROUPS.flatMap((g) =>
  g.items.filter((i) => i.defaultOn).map((i) => i.type)
)

/** Options sent from the UI to the processing worker. */
export interface AnonymizeOptions {
  types: EntityType[]
  /** Words/phrases the user always wants hidden (one per line in the UI). */
  customTerms: string[]
  /** Also write a .md text version of PDFs (handy for pasting into ChatGPT/Claude). */
  exportText: boolean
  /** Use the offline NER model (names, companies, places). */
  useNer: boolean
}

export interface FileResult {
  input: string
  outputs: string[]
  counts: Partial<Record<EntityType, number>>
  ocrPages: number
  warnings: string[]
  error?: string
}

export type ProgressStage = 'reading' | 'ocr' | 'detecting' | 'writing' | 'done' | 'error'

export interface ProgressEvent {
  input: string
  stage: ProgressStage
  /** 0..1 */
  progress: number
  detail?: string
}
