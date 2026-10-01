import type { NextFunction, Request, Response } from 'express'
import type { RequestWithId } from './request-id'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function originProtection(
  allowedOrigin: string,
  production: boolean,
) {
  const allowed = new URL(allowedOrigin).origin

  return (
    request: Request & RequestWithId,
    response: Response,
    next: NextFunction,
  ) => {
    if (
      SAFE_METHODS.has(request.method) ||
      (
        request.method === 'POST' &&
        request.path === '/api/v1/payments/mercado-pago/webhook'
      )
    ) {
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

    try {
      if (!source || new URL(source).origin !== allowed) {
        response.status(403).json({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Origem da requisição não permitida',
          requestId: request.requestId ?? null,
          timestamp: new Date().toISOString(),
          path: request.originalUrl,
        })
        return
      }
    } catch {
      response.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Origem da requisição não permitida',
        requestId: request.requestId ?? null,
        timestamp: new Date().toISOString(),
        path: request.originalUrl,
      })
      return
    }

    next()
  }
}
