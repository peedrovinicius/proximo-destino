-- Acquire authorization locks without granting UPDATE on identity/tenant tables
-- to the restricted API runtime role. The function only returns a boolean and
-- never mutates application data.
CREATE OR REPLACE FUNCTION public.company_write_authorized(
  target_company TEXT,
  target_user TEXT,
  target_session TEXT,
  target_role TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  authorized BOOLEAN := false;
BEGIN
  SELECT true
  INTO authorized
  FROM public."Company" c
  JOIN public."AuthSession" s ON s."companyId" = c."id"
  JOIN public."User" u ON u."id" = s."userId"
  JOIN public."CompanyMembership" m
    ON m."companyId" = c."id" AND m."userId" = u."id"
  WHERE c."id" = target_company
    AND c."status" = 'ACTIVE'
    AND s."id" = target_session
    AND s."userId" = target_user
    AND s."revokedAt" IS NULL
    AND s."expiresAt" > CURRENT_TIMESTAMP
    AND u."isActive" = true
    AND u."companyManaged" = true
    AND u."role"::text = target_role
    AND u."role"::text IN ('ADMIN', 'AGENT', 'FINANCE')
    AND m."isActive" = true
    AND m."role"::text = target_role
  FOR UPDATE OF c
  FOR SHARE OF s, u, m;

  RETURN COALESCE(authorized, false);
END;
$$;

COMMENT ON FUNCTION public.company_write_authorized(TEXT, TEXT, TEXT, TEXT)
IS 'Revalidates and locks company authorization for a write transaction without granting UPDATE on identity tables to the API runtime.';
