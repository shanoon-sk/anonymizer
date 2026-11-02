import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNer, NER_MODEL_ID } from '../src/engine/ner'
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
