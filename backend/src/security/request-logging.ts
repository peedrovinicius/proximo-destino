import { Logger } from '@nestjs/common'
import type { NextFunction, Response } from 'express'
import type { RequestWithId } from './request-id'

const logger = new Logger('HttpRequest')
const SLOW_REQUEST_MS = 1_000

export function requestLoggingMiddleware(
  request: RequestWithId,
  response: Response,
  next: NextFunction,
) {
  const startedAt = process.hrtime.bigint()

  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    const payload = JSON.stringify({
      requestId: request.requestId ?? null,
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
      slow: durationMs >= SLOW_REQUEST_MS,
    })

    if (response.statusCode >= 500) {
      logger.error(payload)
      return
    }

    if (durationMs >= SLOW_REQUEST_MS) {
      logger.warn(payload)
      return
    }

    logger.log(payload)
  })

  next()
}
