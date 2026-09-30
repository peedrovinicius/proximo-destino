import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import { AuthService } from './auth.service'
import type { AuthenticatedUser } from './auth.types'

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const authorization = request.headers.authorization

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente')
    }

    const token = authorization.slice(7).trim()
    request.user = await this.auth.verifyAccessToken(token)
    return true
  }
}
