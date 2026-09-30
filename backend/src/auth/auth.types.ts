import { UserRole } from '@prisma/client'

export type AccessTokenPayload = {
  sub: string
  email: string
  role: UserRole
  sid: string
  type: 'access'
}

export type RefreshTokenPayload = {
  sub: string
  sid: string
  type: 'refresh'
  jti: string
}

export type MfaChallengePayload = {
  sub: string
  mode: 'setup' | 'verify'
  type: 'mfa_challenge'
}

export type AuthenticatedUser = {
  id: string
  email: string
  role: UserRole
  sessionId: string
}

export type RequestContext = {
  ip?: string
  userAgent?: string
}
