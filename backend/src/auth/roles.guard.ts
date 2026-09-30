import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { UserRole } from '@prisma/client'
import { ROLES_KEY } from './roles.decorator'
import type { AuthenticatedRequest } from './jwt-auth.guard'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!roles?.length) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    return roles.includes(request.user.role)
  }
}
