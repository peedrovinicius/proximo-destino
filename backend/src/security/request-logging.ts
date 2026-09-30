import { Logger } from '@nestjs/common'
import type { NextFunction, Response } from 'express'
import type { RequestWithId } from './request-id'

const logger = new Logger('HttpRequest')

export function requestLoggingMiddleware(
  request: RequestWithId,
  response: Response,
  next: NextFunction,
) {
  const startedAt = process.hrtime.bigint()

  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000

    logger.log(
      JSON.stringify({
        requestId: request.requestId ?? null,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
      }),
    )
  })

  next()
}
