import type { PublicCompany } from './companyPublicApi'
const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')
export type CompanyPortalData = { company: PublicCompany; readOnly: true; reservation: {
  status: string; passengerCount: number; seats: number[];
  trip: { title: string; origin: string; destination: string; departureDate: string; returnDate: string | null }
} }
export class CompanyPortalError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 ? 'Acesso inválido ou expirado. Entre novamente com os dados da reserva.' :
      status === 404 ? 'Acesso da empresa indisponível.' : status === 429 ? 'Muitas tentativas. Aguarde antes de tentar novamente.' :
      'Não foi possível concluir a consulta. Tente novamente.')
  }
}
async function request<T>(slug: string, path: string, signal: AbortSignal, token?: string, input?: object, method = 'GET'): Promise<T> {
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug)) throw new CompanyPortalError(404)
  const response = await fetch(`${API_BASE}/public/companies/${encodeURIComponent(slug)}/client/${path}`, {
    method, signal, credentials: 'omit', cache: 'no-store', headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}),
    }, ...(input ? { body: JSON.stringify(input) } : {}),
  })
  if (!response.ok) throw new CompanyPortalError(response.status)
  return response.json() as Promise<T>
}
export const loginCompanyClient = (slug: string, input: { reservationId: string; email: string; code: string }, signal: AbortSignal) =>
  request<{ accessToken: string; expiresAt: string; readOnly: true }>(slug, 'login', signal, undefined, input, 'POST')
export const readCompanyPortal = (slug: string, token: string, signal: AbortSignal) => request<CompanyPortalData>(slug, 'portal', signal, token)
export const logoutCompanyClient = (slug: string, token: string, signal: AbortSignal) => request<{ loggedOut: true }>(slug, 'logout', signal, token, undefined, 'POST')
