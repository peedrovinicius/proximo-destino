import { ForbiddenException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { VerifiedCompanyScope } from './company-scope.service'
import { applyCompanyDbContext } from './company-db-context'

async function revalidateCompanyAccess(tx: Prisma.TransactionClient, scope: VerifiedCompanyScope, write: boolean) {
  const authorized = write
    ? await tx.$queryRaw<{ id: string }[]>`
      SELECT c."id" FROM "Company" c
      JOIN "AuthSession" s ON s."companyId" = c."id"
      JOIN "User" u ON u."id" = s."userId"
      JOIN "CompanyMembership" m ON m."companyId" = c."id" AND m."userId" = u."id"
      WHERE c."id" = ${scope.companyId} AND c."status" = 'ACTIVE'
        AND s."id" = ${scope.sessionId} AND s."userId" = ${scope.userId} AND s."revokedAt" IS NULL
        AND s."expiresAt" > clock_timestamp() AND u."isActive" = true AND m."isActive" = true
        AND u."role"::text = ${scope.role} AND m."role"::text = ${scope.role}
      FOR UPDATE OF c FOR SHARE OF s, u, m`
    : await tx.$queryRaw<{ id: string }[]>`
      SELECT c."id" FROM "Company" c
      JOIN "AuthSession" s ON s."companyId" = c."id"
      JOIN "User" u ON u."id" = s."userId"
      JOIN "CompanyMembership" m ON m."companyId" = c."id" AND m."userId" = u."id"
      WHERE c."id" = ${scope.companyId} AND c."status" = 'ACTIVE'
        AND s."id" = ${scope.sessionId} AND s."userId" = ${scope.userId} AND s."revokedAt" IS NULL
        AND s."expiresAt" > clock_timestamp() AND u."isActive" = true AND m."isActive" = true
        AND u."role"::text = ${scope.role} AND m."role"::text = ${scope.role}
      FOR SHARE OF c, s, u, m`
  if (!authorized.length) throw new ForbiddenException('Sessão sem acesso ativo à empresa')
  await applyCompanyDbContext(tx, scope)
}

/** Revalidate and hold authorization until commit. Serialize writes per company. */
export function lockCompanyWrite(tx: Prisma.TransactionClient, scope: VerifiedCompanyScope) {
  return revalidateCompanyAccess(tx, scope, true)
}

/** Revalidate a read snapshot and install transaction-local tenant context. */
export function lockCompanyRead(tx: Prisma.TransactionClient, scope: VerifiedCompanyScope) {
  return revalidateCompanyAccess(tx, scope, false)
}
