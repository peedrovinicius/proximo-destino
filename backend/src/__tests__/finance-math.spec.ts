import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildInstallmentSchedule } from '../commercial/finance-math'

describe('buildInstallmentSchedule', () => {
  it('preserva o total com entrada e parcelas', () => {
    const rows = buildInstallmentSchedule(
      10_000,
      1_000,
      3,
      new Date('2026-10-15T12:00:00.000Z'),
      new Date('2026-09-30T12:00:00.000Z'),
    )

    assert.deepEqual(rows.map((row) => row.amountCents), [
      1_000,
      3_000,
      3_000,
      3_000,
    ])
    assert.equal(
      rows.reduce((sum, row) => sum + row.amountCents, 0),
      10_000,
    )
  })

  it('distribui centavos sem perder valor', () => {
    const rows = buildInstallmentSchedule(
      10_001,
      0,
      3,
      new Date('2026-10-10T12:00:00.000Z'),
    )

    assert.deepEqual(rows.map((row) => row.amountCents), [
      3_334,
      3_334,
      3_333,
    ])
    assert.equal(
      rows.reduce((sum, row) => sum + row.amountCents, 0),
      10_001,
    )
  })

  it('mantém vencimento no fim do mês sem pular fevereiro', () => {
    const rows = buildInstallmentSchedule(
      30_000,
      0,
      3,
      new Date('2027-01-31T12:00:00.000Z'),
    )

    assert.deepEqual(
      rows.map((row) => row.dueDate.toISOString().slice(0, 10)),
      ['2027-01-31', '2027-02-28', '2027-03-31'],
    )
  })

  it('rejeita entrada igual ao total', () => {
    assert.throws(
      () =>
        buildInstallmentSchedule(
          10_000,
          10_000,
          3,
          new Date('2026-10-10T12:00:00.000Z'),
        ),
      RangeError,
    )
  })
})
