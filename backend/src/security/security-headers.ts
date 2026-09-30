import type { INestApplication } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import helmet = require('helmet')

export function applySecurityHeaders(
  app: INestApplication,
  config: ConfigService,
) {
  const production = config.get<string>('NODE_ENV') === 'production'

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: production
        ? {
            maxAge: 31_536_000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
    }),
  )

  app.getHttpAdapter().getInstance().disable('x-powered-by')
}
