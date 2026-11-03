import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { UserRole } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard'

@Injectable()
export class CreatorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext) {
    if (this.config.get<string>('COMPANY_FOUNDATION_ENABLED') !== 'true') {
      throw new ForbiddenException('Cadastro de empresas ainda não habilitado')
    }
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (!user || user.role !== UserRole.CREATOR) throw new ForbiddenException('Acesso exclusivo do Criador')
    const current = await this.prisma.user.findUnique({
      where: { id: user.id }, select: { role: true, isActive: true, mfaEnabled: true, mfaEnrolledAt: true },
    })
    if (!current?.isActive || current.role !== UserRole.CREATOR || !current.mfaEnabled || !current.mfaEnrolledAt) {
      throw new ForbiddenException('Criador ativo com MFA obrigatório')
    }
    // A session issued before MFA enrollment is not sufficient for platform access.
    const session = await this.prisma.authSession.findFirst({ where: {
      id: user.sessionId, userId: user.id, revokedAt: null,
      expiresAt: { gt: new Date() }, createdAt: { gte: current.mfaEnrolledAt },
    }, select: { id: true } })
    if (!session) throw new ForbiddenException('Autentique novamente com MFA')
    return true
  }
}
