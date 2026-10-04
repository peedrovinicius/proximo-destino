import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import { AuthService } from './auth.service'
import type { AuthenticatedUser } from './auth.types'
import { Reflector } from '@nestjs/core'
import { COMPANY_ACCESS } from '../tenancy/company-access.decorator'
import { CompanyScopeService, type VerifiedCompanyScope } from '../tenancy/company-scope.service'

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser
  companyScope?: VerifiedCompanyScope
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector,
    private readonly scopes: CompanyScopeService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const authorization = request.headers.authorization

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente')
    }

    const token = authorization.slice(7).trim()
    request.user = await this.auth.verifyAccessToken(token)
    delete request.companyScope
    if (request.user.companyId || request.user.requiresCompanyScope) {
      const mode = this.reflector.getAllAndOverride<string>(COMPANY_ACCESS, [context.getHandler(), context.getClass()])
      if (mode === 'SELF') return true
      if (mode !== 'SCOPED_READ' || !request.user.companyId) {
        throw new ForbiddenException('Operação ainda não habilitada para empresas')
      }
      request.companyScope = await this.scopes.resolveSession(request.user.id, request.user.sessionId)
    }
    return true
  }
}
