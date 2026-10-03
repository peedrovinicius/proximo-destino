import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import type { RequestWithId } from './request-id'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    const request = context.getRequest<RequestWithId>()

    const isHttpException = exception instanceof HttpException
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR

    const payload = isHttpException ? exception.getResponse() : null
    const message = this.extractMessage(payload, status)

    if (status >= 500) {
      const detail = exception instanceof Error ? exception.stack ?? exception.message : String(exception)
      this.logger.error(
        `requestId=${request.requestId ?? 'unknown'} method=${request.method} path=${request.path} ${detail}`,
      )
    }

    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      requestId: request.requestId ?? null,
      timestamp: new Date().toISOString(),
      path: request.path,
    })
  }

  private extractMessage(payload: string | object | null, status: number) {
    if (status >= 500) {
      return 'Erro interno do servidor'
    }

    if (typeof payload === 'string') return payload

    if (payload && typeof payload === 'object' && 'message' in payload) {
      const value = (payload as { message?: unknown }).message
      if (Array.isArray(value)) return value
      if (typeof value === 'string') return value
    }

    return 'Não foi possível concluir a requisição'
  }
}
