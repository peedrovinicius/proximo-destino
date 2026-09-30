const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')

type AdminUser = {
  id: string
  email: string
  role: 'ADMIN' | 'AGENT' | 'FINANCE'
}

export type AdminLoginResult = {
  accessToken: string
  user: AdminUser
}

export async function loginAdmin(email: string, password: string): Promise<AdminLoginResult> {
  const response = await fetch(`${API_BASE}/auth/admin/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    throw new Error('Não foi possível autenticar. Confira suas credenciais.')
  }

  return response.json() as Promise<AdminLoginResult>
}

export async function logoutAdmin(accessToken: string) {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
