import { ForbiddenException } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function originProtection(
  allowedOrigin: string,
  production: boolean,
) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(request.method)) {
      next()
      return
    }

    const origin = request.get('origin')
    const referer = request.get('referer')

    if (!origin && !referer && !production) {
      next()
      return
    }

    const source = origin ?? referer
    if (!source) {
      next(new ForbiddenException('Origem da requisição não permitida'))
      return
    }

    try {
      const sourceOrigin = new URL(source).origin
      if (sourceOrigin !== new URL(allowedOrigin).origin) {
        next(new ForbiddenException('Origem da requisição não permitida'))
        return
      }
    } catch {
      next(new ForbiddenException('Origem da requisição não permitida'))
      return
    }

    next()
  }
}
