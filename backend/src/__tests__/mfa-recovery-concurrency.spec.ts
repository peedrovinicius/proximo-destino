import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ConfigService } from '@nestjs/config'
import * as argon2 from 'argon2'
import { createCipheriv } from 'node:crypto'
import { MfaService } from '../auth/mfa.service'
import { PrismaService } from '../prisma/prisma.service'

async function fixture() {
  const key = Buffer.alloc(32, 7)
  const iv = Buffer.alloc(12, 9)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update('JBSWY3DPEHPK3PXP', 'utf8'), cipher.final(),
  ])
  const secret = [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString('base64url')).join('.')
  const code = 'ABCD-EFGH-JKLM'
  const codeHash = await argon2.hash(code)
  let usedAt: Date | null = null
  let readers = 0
  let release!: () => void
  const bothRead = new Promise<void>((resolve) => { release = resolve })
  const prisma = {
    user: { findUnique: async () => ({ mfaEnabled: true, mfaSecretEncrypted: secret }) },
    mfaRecoveryCode: {
      findMany: async () => {
        const candidates = usedAt ? [] : [{ id: 'recovery-id', codeHash }]
        readers += 1
        if (readers === 2) release()
        await bothRead
        return candidates
      },
      updateMany: async ({ where, data }: {
        where: { id: string; userId: string; usedAt: null }; data: { usedAt: Date }
      }) => {
        assert.deepEqual(where, { id: 'recovery-id', userId: 'user-id', usedAt: null })
        if (usedAt) return { count: 0 }
        usedAt = data.usedAt
        return { count: 1 }
      },
    },
  }
  const service = new MfaService(prisma as unknown as PrismaService,
    new ConfigService({ MFA_ENCRYPTION_KEY: key.toString('base64') }))
  return { service, code, used: () => usedAt }
}

describe('consumo único de recuperação MFA', () => {
  it('aceita apenas uma solicitação quando ambas leem o mesmo código disponível', async () => {
    const { service, code, used } = await fixture()
    const results = await Promise.all([
      service.verify('user-id', code), service.verify('user-id', code.toLowerCase()),
    ])
    assert.deepEqual(results.sort(), [false, true])
    assert.ok(used() instanceof Date)
    assert.equal(await service.verify('user-id', code), false)
  })

  it('não consome código de recuperação após duas tentativas inválidas', async () => {
    const { service, used } = await fixture()
    const results = await Promise.all([
      service.verify('user-id', 'INVALID-CODE'), service.verify('user-id', 'OTHER-CODE'),
    ])
    assert.deepEqual(results, [false, false])
    assert.equal(used(), null)
  })
})
