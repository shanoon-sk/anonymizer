import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNer, NER_MODEL_ID, nerOnChunk } from '../src/engine/ner'
import { anonymizeText } from '../src/engine/pipeline'
import { DEFAULT_SELECTED } from '../src/shared/entities'

const modelRoot = join(__dirname, '..', 'resources', 'models')
const hasModel = existsSync(join(modelRoot, NER_MODEL_ID, 'onnx', 'model_quantized.onnx'))

describe.skipIf(!hasModel)('offline NER', () => {
  it('finds names and companies the regexes miss, with exact offsets', async () => {
    const ner = await createNer(modelRoot)
    const text = 'Stretnutie viedol Branislav Hrušovský. Zmluvu podpísala Kateřina Dvořáková za Slovenskú sporiteľňu.'
    const ents = await ner(text)
    for (const e of ents) expect(text.slice(e.start, e.end)).toBe(e.text)
    const r = await anonymizeText(text, { types: DEFAULT_SELECTED, customTerms: [], ner })
    expect(r.output).not.toContain('Hrušovský')
    expect(r.output).not.toContain('Dvořáková')
  })

  it('public authorities are not anonymized', async () => {
    const ner = await createNer(modelRoot)
    const t = 'Daňový režim: podľa stanoviska Finančnej správy SR sa pri postúpení zmluvy postupuje ako pri kúpe.'
    const r = await anonymizeText(t, { types: DEFAULT_SELECTED, customTerms: [], ner })
    expect(r.output).toBe(t)
  })

  it('well-known product brands on invoice lines stay readable', async () => {
    const ner = await createNer(modelRoot)
    const t = 'Použitý televízor Samsung 65" QE65QN80F 1 ks\nPoužitá tlačiareň Canon PIXMA TS3450 1 ks\nPoužitá nabíjačka Garmin Tactical Recce'
    const r = await anonymizeText(t, { types: DEFAULT_SELECTED, customTerms: [], ner })
    expect(r.output).toBe(t)
  })

  it('does not treat accounting labels as organisations', async () => {
    const ner = await createNer(modelRoot)
    const r = await anonymizeText('Zamestnanec Branislav Hrušovský, IBAN SK31 1200 0000 1987 4263 7541, DPH 23 %, EUR', {
      types: DEFAULT_SELECTED,
      customTerms: [],
      ner
    })
    expect(r.output).toBe('Zamestnanec [OSOBA_1], IBAN [IBAN_1], DPH 23 %, EUR')
  })
})

describe('NER post-processing (fake model, platform independent)', () => {
  /** A classifier that tags the given whitespace-separated words, like the ONNX model does on some platforms. */
  function fakeClassifier(tags: Record<string, string>) {
    const fn = async (text: string) =>
      text.split(' ').flatMap((word, i) => (tags[word] ? [{ entity: tags[word], score: 0.95, index: i + 1, word }] : []))
    return Object.assign(fn, { tokenizer: { tokenize: (text: string) => text.split(' ') } })
  }

  it('drops brand + product line spans ("Garmin Tactical" on Linux CI)', async () => {
    const text = 'Použitá nabíjačka Garmin Tactical Recce'
    const ents = await nerOnChunk(fakeClassifier({ Garmin: 'B-ORG', Tactical: 'I-ORG' }), text)
    expect(ents).toEqual([])
  })

  it('still keeps real organisations', async () => {
    const text = 'Zmluvu podpísala Gama Delta za odberateľa'
    const ents = await nerOnChunk(fakeClassifier({ Gama: 'B-ORG', Delta: 'I-ORG' }), text)
    expect(ents.map((e) => e.text)).toEqual(['Gama Delta'])
  })
})
