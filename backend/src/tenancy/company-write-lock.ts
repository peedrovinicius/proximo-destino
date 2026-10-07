import { ForbiddenException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { VerifiedCompanyScope } from './company-scope.service'
import { applyCompanyDbContext } from './company-db-context'

async function revalidateCompanyAccess(tx: Prisma.TransactionClient, scope: VerifiedCompanyScope, write: boolean) {
  let authorized = false

  if (write) {
    const [result] = await tx.$queryRaw<Array<{ allowed: boolean }>>`
      SELECT public.company_write_authorized(
        ${scope.companyId}, ${scope.userId}, ${scope.sessionId}, ${scope.role}
      ) AS allowed
    `
    authorized = result?.allowed === true
  } else {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT c."id" FROM "Company" c
      JOIN "AuthSession" s ON s."companyId" = c."id"
      JOIN "User" u ON u."id" = s."userId"
      JOIN "CompanyMembership" m ON m."companyId" = c."id" AND m."userId" = u."id"
      WHERE c."id" = ${scope.companyId} AND c."status" = 'ACTIVE'
        AND s."id" = ${scope.sessionId} AND s."userId" = ${scope.userId} AND s."revokedAt" IS NULL
        AND s."expiresAt" > clock_timestamp() AND u."isActive" = true AND u."companyManaged" = true
        AND u."role"::text = ${scope.role} AND u."role"::text IN ('ADMIN','AGENT','FINANCE')
        AND m."isActive" = true AND m."role"::text = ${scope.role}
    `
    authorized = rows.length === 1
  }

  if (!authorized) throw new ForbiddenException('Sessão sem acesso ativo à empresa')
  await applyCompanyDbContext(tx, scope)
}

/** Revalidate and hold authorization until commit without runtime UPDATE grants. */
export function lockCompanyWrite(tx: Prisma.TransactionClient, scope: VerifiedCompanyScope) {
  return revalidateCompanyAccess(tx, scope, true)
}

/** Revalidate a repeatable-read snapshot and install transaction-local tenant context. */
export function lockCompanyRead(tx: Prisma.TransactionClient, scope: VerifiedCompanyScope) {
  return revalidateCompanyAccess(tx, scope, false)
}
