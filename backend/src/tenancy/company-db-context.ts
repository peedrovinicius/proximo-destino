import { ForbiddenException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { VerifiedCompanyScope } from './company-scope.service'

type AppliedCompanyContext = {
  companyId: string | null
  userId: string | null
  sessionId: string | null
}

/**
 * Install transaction-local database context only from a scope that has already
 * been revalidated against the persisted session/membership.
 *
 * Never call this from request body/query/header values. PostgreSQL set_config
 * uses is_local=true, so the values disappear automatically at transaction end.
 */
export async function applyCompanyDbContext(
  tx: Prisma.TransactionClient,
  scope: VerifiedCompanyScope,
) {
  const [applied] = await tx.$queryRaw<AppliedCompanyContext[]>`
    SELECT
      set_config('app.company_id', ${scope.companyId}, true) AS "companyId",
      set_config('app.user_id', ${scope.userId}, true) AS "userId",
      set_config('app.session_id', ${scope.sessionId}, true) AS "sessionId"
  `
  if (!applied || applied.companyId !== scope.companyId ||
    applied.userId !== scope.userId || applied.sessionId !== scope.sessionId) {
    throw new ForbiddenException('Contexto da empresa não pôde ser estabelecido')
  }
}
