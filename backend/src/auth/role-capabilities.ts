import { UserRole } from '@prisma/client'

export const STAFF_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.AGENT,
  UserRole.FINANCE,
]

export const OPERATIONS_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.AGENT,
]

export const FINANCE_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.FINANCE,
]

export const ADMIN_ONLY_ROLES: UserRole[] = [UserRole.ADMIN]
