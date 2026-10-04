const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')

type AdminUser = {
  id: string
  email: string
  role: 'ADMIN' | 'AGENT' | 'FINANCE' | 'CREATOR'
}

export type AuthenticatedResult = {
  status: 'authenticated'
  accessToken: string
  user: AdminUser
  recoveryCodes?: string[]
}

export type AdminLoginResult =
  | AuthenticatedResult
  | {
      status: 'mfa_required' | 'mfa_setup_required'
      challengeToken: string
    }

export type MfaSetupResult = {
  manualKey: string
  otpauthUrl: string
  qrDataUrl: string
}

async function parseError(response: Response) {
  try {
    const body = await response.json() as { message?: string | string[] }
    if (Array.isArray(body.message)) return body.message.join(' ')
    if (typeof body.message === 'string') return body.message
  } catch {
    // resposta sem JSON
  }
  return 'Não foi possível concluir a autenticação.'
}

export async function loginAdmin(email: string, password: string): Promise<AdminLoginResult> {
  const response = await fetch(`${API_BASE}/auth/admin/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<AdminLoginResult>
}

export async function loginCreator(email: string, password: string): Promise<AdminLoginResult> {
  const response = await fetch(`${API_BASE}/auth/creator/login`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<AdminLoginResult>
}

export async function setupMfa(challengeToken: string): Promise<MfaSetupResult> {
  const response = await fetch(`${API_BASE}/auth/mfa/setup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken }),
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<MfaSetupResult>
}

export async function verifyMfaSetup(
  challengeToken: string,
  code: string,
): Promise<AuthenticatedResult> {
  const response = await fetch(`${API_BASE}/auth/mfa/setup/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken, code }),
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<AuthenticatedResult>
}

export async function verifyMfa(
  challengeToken: string,
  code: string,
): Promise<AuthenticatedResult> {
  const response = await fetch(`${API_BASE}/auth/mfa/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken, code }),
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<AuthenticatedResult>
}

export async function refreshAdminSession(): Promise<AuthenticatedResult> {
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<AuthenticatedResult>
}

export async function logoutAdmin(accessToken: string) {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
