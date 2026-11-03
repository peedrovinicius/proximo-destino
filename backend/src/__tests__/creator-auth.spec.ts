import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { UserRole } from '@prisma/client'
import * as argon2 from 'argon2'
import { AuthService } from '../auth/auth.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { MfaService } from '../auth/mfa.service'
import type { SessionService } from '../auth/session.service'
import type { AuditService } from '../auth/audit.service'

describe('creator authentication separation', () => {
  const password = 'Synthetic-creator-password-2026'
  function service(role: UserRole, mfaEnabled = false, enabled = true, passwordHash = '') {
    return new AuthService({ user: {
      findUnique: async () => ({ id: 'synthetic-creator', email: 'creator@example.invalid', role,
        isActive: true, lockedUntil: null, mfaEnabled, passwordHash }),
      updateMany: async () => ({ count: 1 }),
    } } as unknown as PrismaService, new JwtService(), new ConfigService({
      COMPANY_FOUNDATION_ENABLED: enabled ? 'true' : 'false', JWT_MFA_SECRET: 'synthetic-creator-mfa-only-for-tests',
    }), {} as MfaService, {} as SessionService, { record: async () => {} } as unknown as AuditService)
  }
  it('creator cannot log into the company administrative portal', async () => {
    await assert.rejects(service(UserRole.CREATOR).loginAdmin('creator@example.invalid', password, {}), { status: 403 })
  })
  for (const role of [UserRole.ADMIN, UserRole.AGENT, UserRole.FINANCE, UserRole.CLIENT]) {
    it(`${role} cannot log into the creator portal`, async () => {
      await assert.rejects(service(role).loginCreator('creator@example.invalid', password, {}), { status: 403 })
    })
  }
  it('creator login fails closed while feature is disabled', async () => {
    await assert.rejects(service(UserRole.CREATOR, false, false).loginCreator('creator@example.invalid', password, {}), { status: 403 })
  })
  it('password alone never grants a creator access token, enrolled or not', async () => {
    const hash = await argon2.hash(password)
    for (const enrolled of [false, true]) {
      const result = await service(UserRole.CREATOR, enrolled, true, hash).loginCreator('creator@example.invalid', password, {})
      assert.equal(result.status, enrolled ? 'mfa_required' : 'mfa_setup_required')
      assert.equal('accessToken' in result, false)
    }
  })
})
