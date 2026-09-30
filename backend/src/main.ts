import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './security/http-exception.filter'
import { originProtection } from './security/origin-protection'
import { requestIdMiddleware } from './security/request-id'
import { requestLoggingMiddleware } from './security/request-logging'
import { applySecurityHeaders } from './security/security-headers'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const config = app.get(ConfigService)
  const production = config.get<string>('NODE_ENV') === 'production'
  const frontendOrigin = config.getOrThrow<string>('FRONTEND_ORIGIN')

  const expressApp = app.getHttpAdapter().getInstance()
  expressApp.set('trust proxy', 1)

  app.setGlobalPrefix('api/v1')
  applySecurityHeaders(app, config)
  app.use(requestIdMiddleware)
  app.use(requestLoggingMiddleware)
  app.use(originProtection(frontendOrigin, production))
  app.enableCors({
    origin: frontendOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 600,
  })
  app.use(cookieParser())
  app.useGlobalFilters(new HttpExceptionFilter())
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
    }),
  )

  const port = config.get<number>('PORT', 3000)
  await app.listen(port, '0.0.0.0')
}

void bootstrap()
