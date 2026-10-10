import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PrismaService } from '../prisma/prisma.service'
import {
  decryptSensitive,
  encryptSensitive,
  hashSensitive,
  maskSensitiveDocument,
} from '../security/sensitive-data'

describe('controles críticos de segurança', () => {
  it('criptografa dados pessoais com AES-GCM e usa hash estável para busca', () => {
    const value = '12345678901'
    const first = encryptSensitive(value)
    const second = encryptSensitive(value)

    assert.ok(first)
    assert.ok(second)
    assert.notEqual(first, value)
    assert.notEqual(second, value)
    assert.notEqual(first, second)
    assert.equal(decryptSensitive(first), value)
    assert.equal(decryptSensitive(second), value)
    assert.equal(hashSensitive(value), hashSensitive(value))
    assert.notEqual(hashSensitive(value), hashSensitive('10987654321'))
    assert.equal(maskSensitiveDocument(value)?.endsWith('8901'), true)
    assert.equal(maskSensitiveDocument(value)?.includes('1234567'), false)
  })

  it('mantém RLS e política deny-by-default nas tabelas sensíveis', async () => {
    const prisma = new PrismaService()
    await prisma.$connect()

    try {
      const rows = await prisma.$queryRaw<
        Array<{
          tableName: string
          enabled: boolean
          policyCount: number
        }>
      >`
        SELECT
          c.relname AS "tableName",
          c.relrowsecurity AS "enabled",
          (
            SELECT COUNT(*)::int
            FROM pg_policy p
            WHERE p.polrelid = c.oid
          ) AS "policyCount"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE
          n.nspname = current_schema()
          AND c.relname IN (
            'Client',
            'Companion',
            'Trip',
            'Reservation',
            'ReservationPassenger',
            'SeatAssignment',
            'PurchaseOrder',
            'Quote',
            'QuoteItem',
            'ReservationService',
            'FinancePlan',
            'Installment',
            'TravelDocument',
            'ManualPayment',
            'ClientCreditTransaction'
          )
      `

      assert.equal(rows.length, 15)
      for (const row of rows) {
        assert.equal(
          row.enabled,
          true,
          `RLS não está ativo em ${row.tableName}`,
        )
        assert.ok(
          row.policyCount >= 1,
          `Nenhuma política RLS encontrada em ${row.tableName}`,
        )
      }
    } finally {
      await prisma.$disconnect()
    }
  })
})
