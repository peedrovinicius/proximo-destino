import type { PrismaClient } from '@prisma/client'

export type DatabaseSecurityState = {
  superuser: boolean
  bypassRls: boolean
  auditTableExists: boolean
  canAssumeAuditOwner: boolean
  canReadAudit: boolean
  canInsertAudit: boolean
  canUpdateAudit: boolean
  canDeleteAudit: boolean
  canTruncateAudit: boolean
}

// Only booleans leave this query: never connection strings, role names or rows.
export async function readDatabaseSecurityState(client: Pick<PrismaClient, '$queryRaw'>) {
  const [state] = await client.$queryRaw<DatabaseSecurityState[]>`
    SELECT
      r.rolsuper AS "superuser",
      r.rolbypassrls AS "bypassRls",
      (c.oid IS NOT NULL) AS "auditTableExists",
      COALESCE(pg_has_role(current_user, c.relowner, 'MEMBER'), false) AS "canAssumeAuditOwner",
      COALESCE(has_table_privilege(current_user, c.oid, 'SELECT'), false) AS "canReadAudit",
      COALESCE(has_table_privilege(current_user, c.oid, 'INSERT'), false) AS "canInsertAudit",
      COALESCE(has_table_privilege(current_user, c.oid, 'UPDATE'), false) AS "canUpdateAudit",
      COALESCE(has_table_privilege(current_user, c.oid, 'DELETE'), false) AS "canDeleteAudit",
      COALESCE(has_table_privilege(current_user, c.oid, 'TRUNCATE'), false) AS "canTruncateAudit"
    FROM pg_roles r
    LEFT JOIN pg_class c ON c.oid = to_regclass('public."AuthAuditEvent"')
    WHERE r.rolname = current_user
  `
  if (!state) throw new Error('Database privilege check unavailable')
  return state
}

export function restrictedAuditWriter(state: DatabaseSecurityState) {
  return state.auditTableExists && state.canReadAudit && state.canInsertAudit &&
    !state.superuser && !state.bypassRls && !state.canAssumeAuditOwner &&
    !state.canUpdateAudit && !state.canDeleteAudit && !state.canTruncateAudit
}
