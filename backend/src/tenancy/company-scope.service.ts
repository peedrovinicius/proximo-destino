import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export type VerifiedCompanyScope = Readonly<{
  companyId: string
  userId: string
  sessionId: string
  role: 'ADMIN' | 'AGENT' | 'FINANCE'
}>

/** Server-only resolver for explicitly scoped operational endpoints.
 * The company comes from the persisted session, never a body/header/JWT claim.
 */
@Injectable()
export class CompanyScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveSession(userId: string, sessionId: string): Promise<VerifiedCompanyScope> {
    if (!userId?.trim() || !sessionId?.trim()) throw this.denied()
    const session = await this.prisma.authSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true, userId: true, companyId: true,
        user: { select: { role: true, isActive: true, companyManaged: true } },
        company: { select: {
          id: true, status: true,
          memberships: { where: { userId, isActive: true }, select: { role: true } },
        } },
      },
    })
    if (!session || !session.companyId || !session.user.isActive || !session.user.companyManaged ||
      session.company?.status !== 'ACTIVE' || session.company.id !== session.companyId) throw this.denied()
    const role = session.user.role
    if (role !== 'ADMIN' && role !== 'AGENT' && role !== 'FINANCE') throw this.denied()
    // Prevent stale global privileges or a revoked/changed membership from silently
    // granting a different role while legacy permissions still use User.role.
    // Reject legacy identities even if an old/forged session and membership
    // appear valid. RLS and lockCompanyRead already demand this marker too.
    const membership = session.company.memberships
    if (membership.length !== 1 || membership[0].role !== role) throw this.denied()
    return Object.freeze({ companyId: session.companyId, userId: session.userId,
      sessionId: session.id, role })
  }

  private denied() { return new ForbiddenException('Sessão sem acesso ativo à empresa') }
}
