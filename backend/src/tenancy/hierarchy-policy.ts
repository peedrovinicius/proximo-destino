/** Foundation only: not wired to routes until persistence and tenant scoping exist.
 * Actor fields must come from a verified session and current database records,
 * never from request body, URL, or a JWT claim alone.
 */
export type HierarchyActor =
  | { level: 'CREATOR'; userId: string; active: boolean; mfaVerified: boolean }
  | { level: 'COMPANY'; userId: string; active: boolean; companyId: string;
      companyActive: boolean; membershipActive: boolean; role: 'ADMIN' | 'AGENT' | 'FINANCE' }
  | { level: 'CLIENT'; userId: string; active: boolean; companyId: string;
      companyActive: boolean; clientId: string }

export type HierarchyAction = 'MANAGE_COMPANIES' | 'MANAGE_TEAM' |
  'MANAGE_INTEGRATIONS' | 'MANAGE_OPERATIONS' | 'MANAGE_FINANCE' |
  'VIEW_OWN_RESERVATION' | 'EDIT_OWN_PROFILE'

export type HierarchyResource = { companyId?: string; clientId?: string }

export function hierarchyAllows(
  actor: HierarchyActor | null | undefined,
  action: HierarchyAction,
  resource: HierarchyResource = {},
): boolean {
  if (!actor?.active || !actor.userId?.trim()) return false
  if (actor.level === 'CREATOR') {
    // Platform administration does not implicitly grant access to client data.
    return actor.mfaVerified === true && action === 'MANAGE_COMPANIES'
  }
  if (!actor.companyActive || !actor.companyId?.trim() ||
      !resource.companyId?.trim() || actor.companyId !== resource.companyId) return false
  if (actor.level === 'COMPANY') {
    if (!actor.membershipActive) return false
    if (action === 'MANAGE_TEAM' || action === 'MANAGE_INTEGRATIONS') return actor.role === 'ADMIN'
    if (action === 'MANAGE_OPERATIONS') return actor.role === 'ADMIN' || actor.role === 'AGENT'
    if (action === 'MANAGE_FINANCE') return actor.role === 'ADMIN' || actor.role === 'FINANCE'
    return false
  }
  if (actor.level === 'CLIENT') {
    return !!actor.clientId?.trim() && resource.clientId === actor.clientId &&
      (action === 'VIEW_OWN_RESERVATION' || action === 'EDIT_OWN_PROFILE')
  }
  return false
}
