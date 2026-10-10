import { UserRole } from '@prisma/client'

export type AccessTokenPayload = {
  authVersion?: number
  sub: string
  email: string
  role: UserRole
  sid: string
  type: 'access'
}

export type RefreshTokenPayload = {
  authVersion?: number
  sub: string
  sid: string
  type: 'refresh'
  jti: string
}

export type MfaChallengePayload = {
  authVersion?: number
  sub: string
  mode: 'setup' | 'verify'
  type: 'mfa_challenge'
}

export type AuthenticatedUser = {
  companyId?: string | null
  requiresCompanyScope?: boolean
  id: string
  email: string
  role: UserRole
  sessionId: string
}

export type RequestContext = {
  ip?: string
  userAgent?: string
}
