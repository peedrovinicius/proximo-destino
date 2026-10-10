import type { PublicSeatMap, PublicTrip } from './publicApi'

const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')
export type CompanyPublicTrip = Pick<PublicTrip, 'id' | 'title' | 'origin' | 'destination' | 'departureDate' | 'returnDate' | 'priceCents' | 'summary' | 'imageUrl' | 'capacity'>
export type PublicCompany = { slug: string; tradeName: string }
export type CompanyCatalog = { company: PublicCompany; trips: CompanyPublicTrip[]; limit: number; hasMore: boolean; readOnly: true }

async function read<T>(slug: string, suffix: string, signal: AbortSignal): Promise<T> {
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug)) throw new Error('Empresa indisponível.')
  const response = await fetch(`${API_BASE}/public/companies/${encodeURIComponent(slug)}/trips${suffix}`, {
    method: 'GET', credentials: 'omit', cache: 'no-store', signal,
  })
  if (!response.ok) throw new Error(response.status === 404 ? 'Empresa ou viagem indisponível.' : 'Não foi possível atualizar esta consulta. Tente novamente.')
  return response.json() as Promise<T>
}
export function fetchCompanyCatalog(slug: string, filters: { origin: string; destination: string; departureDate: string }, signal: AbortSignal) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value.trim()) query.set(key, value.trim())
  return read<CompanyCatalog>(slug, query.size ? `?${query}` : '', signal)
}
export function fetchCompanyTrip(slug: string, id: string, signal: AbortSignal) {
  return read<{ company: PublicCompany; trip: CompanyPublicTrip; readOnly: true }>(slug, `/${encodeURIComponent(id)}`, signal)
}
export function fetchCompanySeats(slug: string, id: string, signal: AbortSignal) {
  return read<Partial<PublicSeatMap> & { enabled: boolean; readOnly: true }>(slug, `/${encodeURIComponent(id)}/seats`, signal)
}
