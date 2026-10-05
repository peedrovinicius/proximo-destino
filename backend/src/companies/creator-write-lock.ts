import { ForbiddenException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

/** Keep the current creator and MFA session authorized until the write commits. */
export async function lockCreatorWrite(tx: Prisma.TransactionClient, userId: string, sessionId: string) {
  const authorized = await tx.$queryRaw<{ id: string }[]>`
    SELECT u."id" FROM "User" u JOIN "AuthSession" s ON s."userId" = u."id"
    WHERE u."id" = ${userId} AND u."role" = 'CREATOR' AND u."isActive" = true
      AND u."mfaEnabled" = true AND u."mfaEnrolledAt" IS NOT NULL
      AND s."id" = ${sessionId} AND s."revokedAt" IS NULL
      AND s."expiresAt" > clock_timestamp() AND s."createdAt" >= u."mfaEnrolledAt"
    FOR SHARE OF u, s`
  if (!authorized.length) throw new ForbiddenException('Criador sem sessão vigente com MFA')
}
