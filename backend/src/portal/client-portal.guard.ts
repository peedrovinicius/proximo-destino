import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'

export type ClientPortalRequest = Request & {
  portal: {
    clientId: string
    reservationId: string
  }
}

@Injectable()
export class ClientPortalGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ClientPortalRequest>()
    const authorization = request.headers.authorization

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Acesso não autorizado')
    }

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string
        rid: string
        type: string
      }>(authorization.slice(7).trim(), {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      })

      if (payload.type !== 'client_portal' || !payload.sub || !payload.rid) {
        throw new Error('invalid')
      }

      request.portal = {
        clientId: payload.sub,
        reservationId: payload.rid,
      }
      return true
    } catch {
      throw new UnauthorizedException('Acesso expirado ou inválido')
    }
  }
}
