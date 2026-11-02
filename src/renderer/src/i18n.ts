// All user-facing Slovak strings in one place.
import { ENTITY_GROUPS, type EntityType, type ProgressStage } from '../../shared/entities'

export const sk = {
  appName: 'Anonymo',
  by: 'by Shanoon',
  offlineBadge: '100 % offline',
  dropTitle: 'Pretiahnite sem súbory',
  dropSubtitle: 'PDF, Word (.docx) alebo Excel (.xlsx)',
  dropOr: 'alebo',
  pickFiles: 'Vybrať súbory',
  dropActive: 'Pustite súbory sem',
  filesHeading: 'Súbory',
  clearFiles: 'Vymazať zoznam',
  remove: 'Odstrániť',
  whatToHide: 'Čo anonymizovať',
  selectAll: 'Vybrať všetko',
  selectNone: 'Zrušiť výber',
  customTerms: 'Vlastné výrazy',
  customTermsHint: 'Každý výraz na nový riadok – napr. názov klienta alebo projektu. Neukladajú sa.',
  customTermsPlaceholder: 'Zelený Dom\nProjekt Alfa',
  saveTo: 'Uložiť do',
  saveNextTo: 'Vedľa pôvodného súboru',
  change: 'Zmeniť…',
  reset: 'Pôvodné umiestnenie',
  run: 'Anonymizovať',
  running: 'Anonymizujem…',
  runHintNoFiles: 'Najprv pridajte súbory.',
  runHintNoTypes: 'Vyberte aspoň jeden typ údajov.',
  found: (n: number) =>
    n === 0 ? 'Nenašli sa žiadne citlivé údaje' : n === 1 ? 'Skrytý 1 údaj' : n < 5 ? `Skryté ${n} údaje` : `Skrytých ${n} údajov`,
  ocrPages: (n: number) => `${n} ${n === 1 ? 'strana' : n < 5 ? 'strany' : 'strán'} cez OCR`,
  open: 'Otvoriť',
  showInFolder: 'Zobraziť v priečinku',
  reviewNote: 'Pred vložením do AI výsledok vždy rýchlo skontrolujte.',
  privacy: 'Všetko prebieha lokálne na vašom počítači. Žiadne dáta sa neodosielajú ani neukladajú.',
  poweredBy: 'Powered by',
  unsupported: 'Nepodporovaný formát',
  legacyHint: 'Uložte súbor vo formáte .docx / .xlsx a skúste znova.',
  duplicate: 'Súbor už je v zozname.',
  emptyList: 'Zatiaľ žiadne súbory',
  newBatch: 'Nová dávka',
  failed: 'Chyba',
  unexpected: 'Nastala neočakávaná chyba.'
}

export const stageLabel: Record<ProgressStage | 'queued', string> = {
  queued: 'Čaká',
  reading: 'Načítavam',
  ocr: 'Rozpoznávam text (OCR)',
  detecting: 'Hľadám citlivé údaje',
  writing: 'Ukladám',
  done: 'Hotovo',
  error: 'Chyba'
}

const labels = new Map<EntityType, string>(ENTITY_GROUPS.flatMap((g) => g.items.map((i) => [i.type, i.label] as const)))
labels.set('VLASTNE', 'Vlastné výrazy')
export const typeLabel = (t: EntityType) => labels.get(t) ?? t
