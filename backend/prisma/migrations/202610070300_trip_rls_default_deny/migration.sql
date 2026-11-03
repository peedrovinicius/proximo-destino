-- Additive defense in depth. Existing app sessions/legacy Trip rows remain unchanged.
-- Only the table owner can continue using legacy operations until a scoped API
-- runtime role and server-derived tenant context are implemented and verified.
-- A non-owner granted SQL access to Trip must see nothing by default.
-- This is deliberately NOT a tenant-allow policy and does not activate companies.
ALTER TABLE "Trip" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_only_trip"
ON "Trip"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

COMMENT ON POLICY "api_only_trip" ON "Trip"
IS 'Default deny for non-owner runtime roles. Tenant-specific access requires separately reviewed restricted policies and validated server context.';
