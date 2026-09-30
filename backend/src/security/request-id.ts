import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'

export type RequestWithId = Request & {
  requestId?: string
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/

export function requestIdMiddleware(
  request: RequestWithId,
  response: Response,
  next: NextFunction,
) {
  const incoming = request.get('x-request-id')
  const requestId =
    incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID()

  request.requestId = requestId
  response.setHeader('x-request-id', requestId)
  next()
}
