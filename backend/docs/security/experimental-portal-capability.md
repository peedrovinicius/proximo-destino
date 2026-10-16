# Experimental portal capability proof

This is a disposable PostgreSQL 18 experiment, not an approved migration, production adapter or deployment instruction. The existing portal controller and service are unchanged. The adapter requires NODE_ENV=test and is not registered in any Nest module. No real key, credential or connection is used.

## Trust boundary

The backend is trusted to verify Argon2 credentials. A separate random 256-bit signing key authenticates its requests to the database. The API SQL LOGIN cannot SELECT this key, obtain role membership, read any base table, call private helpers or choose a boolean verification verdict without a valid HMAC. A compromise of the backend/signing key is outside the SQL-only boundary and can authorize logins: protecting, provisioning and rotating that key requires review before any real integration.

Signed lookup binds operation, normalized email, company slug, reservation ID, random nonce and a short expiry. It returns only the scoped Argon2 hash after signature verification. Argon2 verification happens in the backend. Signed completion binds the verification result to the stored challenge. Completion locks and consumes the challenge once, locks company/reservation rows, rechecks company/client/trip relationships, credential version, current email, expiration and lockout, then rotates sessions atomically. A bare caller-supplied valid=true cannot authorize a login.

Bearer session access verifies a 256-bit raw token against its persisted SHA-256 hash, rechecks company/reservation/client and credential version, and serializes against rotation/logout. Logout updates only the verified session. No raw session token is persisted.

## Database authority

The SECURITY DEFINER owner is NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB and NOCREATEROLE. It owns only these routines; schema/table ownership stays with the disposable provisioner. It receives column grants needed for the operations, including UPDATE(id) solely because PostgreSQL row locks require UPDATE privilege. The API LOGIN receives only schema usage and three explicit entry-point EXECUTE grants, alongside the two existing reviewed staff helpers. PUBLIC EXECUTE is revoked on every experimental routine.

RLS remains active. Additional fixture policies apply exclusively to the non-login definer and match the exact reservation/company/client/trip or bearer hash. There is no USING(true), TO PUBLIC policy or API role membership. Each entry point clears all context settings and derives them from authenticated data, so setting caller GUCs alone provides no authority. All identifiers and objects are schema-qualified; search_path is pinned to pg_catalog and no dynamic SQL is used.

## Release blockers

The existing runtime gate must REJECT this unreviewed authority while installed. It is intentionally not extended with allowlists or fingerprints for the prototype. Before integration, review the complete function authority, key lifecycle, independent security checks, challenge retention/cleanup, all application contracts, HTTP rate limiting, audit compatibility, rollout/rollback and the exact policy/function fingerprints. Verify the definer's identity/privileges and absence of extra policy/EXECUTE grants in the eventual gate. Keep PR #67 draft; no merge, main, deploy, company activation or real resources.

The SQL fixture lives under scripts/security/experimental and is invoked only by the dedicated test harness after validating NODE_ENV=test, loopback database host and the dedicated database name. The production migration chain never executes it. Tests use the real existing operational/session tables with synthetic rows, then remove the schema, policies, grants, roles and synthetic data.

## Confirmed compatibility repair

The disposable experiment reproduced SQLSTATE 42P01 in check_reservation_company_scope when invoked under the fixed pg_catalog search path. Migration 202610161030_qualify_company_scope_triggers schema-qualifies the two existing integrity-trigger bodies and pins their search_path. They remain SECURITY INVOKER and retain their existing locks and null-safe relationship checks; no integrity trigger is disabled. Existing tenant policies also require explicit EXECUTE on the two reviewed staff helpers for the non-login definer; this grant exists solely in the disposable fixture.

The CI experiment additionally rechecks access-code expiration after acquiring locks, including a real blocked runtime query released after credential expiry. No stale authorization may survive that wait.
