import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BUS_TEMPLATES,
  describeBus,
  listBusTemplates,
  resolveBusTemplate,
} from '../trips/bus-templates'

describe('catálogo de modelos de ônibus', () => {
  it('mantém modelos fixos com lotação e disposição consistentes', () => {
    const leito = resolveBusTemplate('LEITO_34', 46, 'TWO_BY_TWO')
    assert.equal(leito.capacity, 34)
    assert.equal(leito.seatLayout, 'TWO_BY_ONE')
    assert.equal(leito.busTemplate, 'LEITO_34')

    const executivo = resolveBusTemplate('EXECUTIVO_46')
    assert.equal(executivo.capacity, 46)
    assert.equal(executivo.seatLayout, 'TWO_BY_TWO')
  })

  it('oferece os modelos fixos e a opção personalizada', () => {
    const catalog = listBusTemplates()
    assert.equal(catalog.length, BUS_TEMPLATES.length + 1)
    assert.equal(catalog.at(-1)?.key, 'CUSTOM')
  })

  it('exige lotação válida no modelo personalizado', () => {
    assert.throws(
      () => resolveBusTemplate('CUSTOM', 0, 'TWO_BY_TWO'),
      /lotação entre 1 e 80/,
    )
    assert.throws(
      () => resolveBusTemplate('CUSTOM', 81, 'TWO_BY_TWO'),
      /lotação entre 1 e 80/,
    )
  })

  it('aceita personalizado 2+1 e descreve corretamente', () => {
    const custom = resolveBusTemplate('CUSTOM', 37, 'TWO_BY_ONE')
    assert.equal(custom.capacity, 37)
    assert.equal(custom.seatLayout, 'TWO_BY_ONE')
    assert.equal(describeBus('CUSTOM', 37), 'Personalizado · 37 lugares')
  })

  it('rejeita chaves inexistentes', () => {
    assert.throws(
      () => resolveBusTemplate('MODELO_INEXISTENTE'),
      /Modelo de ônibus inválido/,
    )
  })
})
