# PR #67 — Portal RLS under a restricted runtime (design gate)

Status: **BLOCKED — design only, not an approved database change**. This file records a reproduced incompatibility and the acceptance tests required before introducing privileged SQL. It must not be used as a deployment or privilege-grant script.

## Confirmed evidence

- CI #38067589436: successful at 7ea7718.
- Disposable PostgreSQL proof #38067586737: 12/12 passing. Its synthetic-company test **expects the portal session INSERT to fail** under the current RLS; passing does not mean portal login works.
- The application currently performs `CompanyClientPortalSession.updateMany/create/findUnique/update` from `CompanyClientPortalService`. Existing `api_only_company_client_portal_session` is FOR ALL TO PUBLIC USING(false) WITH CHECK(false). A non-owner runtime with table privileges cannot create or read sessions.
- `company_tenant_authorized` checks persisted **staff AuthSession** plus active membership; a customer portal token is not such a session. Reusing it for customer access is incorrect.
- `CompanyClientPortalService.scope` reads Company, Reservation, Client and Trip; those paths also need examination with the *real restricted runtime* before portal login can succeed. Do not silently replace owner-only access with open policies.

## Required security design, subject to review

1. Keep portal session base-table RLS default-deny and runtime non-owner, non-BYPASSRLS. No `USING(true)` or blanket `TO PUBLIC` grants.
2. Define an explicit, tightly scoped backend/DB authorization boundary for initial login, token verification, session rotation and logout. The initial login requires *server-side* verification of the stored Argon2 access code and normalized customer email; never authorize merely because a caller knows a company or reservation ID or can set `app.*` GUCs.
3. If introducing any SECURITY DEFINER routines: fixed `search_path=pg_catalog`, schema-qualified objects, least-privileged non-login owner, explicit EXECUTE grants only to the runtime, PUBLIC EXECUTE revoked, pinned reviewed function bodies and signatures in `assert-runtime.sql`, validation of record-company-reservation-client relationships and revocation/expiry inside a race-safe transaction. Do not add them to the gate allowlist without reviewing their complete authority.
4. If using a separate portal role, it must have no ownership/DDL/BYPASSRLS and cannot acquire unrestricted reads of sensitive tokens. Treat internal server-to-DB operations as a privileged trust boundary; never accept caller-supplied tenant settings as proof of authorization.
5. Preserve `DELETE` denial for the portal session table and `PaymentPlatformConfig` unless a functional case proves otherwise. The latter already passed synthetic INSERT/UPDATE/SELECT with DELETE denied.

## Required disposable PostgreSQL acceptance cases

- Two ACTIVE synthetic companies A and B, with separate synthetic clients, trips, reservations and Argon2-hashed access codes; test only in the dedicated local CI PostgreSQL database.
- Login A with correct code/email succeeds, creates exactly one A-bound, expiring, hashed session; incorrect code/email fails without session. A subsequent login revokes the preceding session.
- A token grants only A's own reservation; B's slug, reservation and client are inaccessible even when supplied deliberately. Test for session replay, expired/revoked token, rotated access-code version and absent membership where applicable.
- Session read and logout succeed through the restricted runtime; logout invalidates future access; B's sessions remain unchanged. Concurrent logins cannot leave multiple active sessions.
- Negative SQL tests: caller cannot directly INSERT a portal session for another tenant, SELECT token hashes, UPDATE another tenant's session or DELETE sessions. Unexpected PUBLIC/group grants and permissive RLS policies fail the gate.
- `PaymentPlatformConfig` synthetic insert/upsert/read succeeds without DELETE. A direct DELETE fails with permission denied.
- Rerun disposable PostgreSQL workflow, all backend/frontend/backup CI jobs and security checks on the final head SHA.

## Non-goals and safety limits

No changes to `main`, production, real database, credentials, deployment or company activation. Keep PR #67 in draft. **Do not claim the end-to-end customer portal is validated until its service methods pass with a restricted connection**, not merely because ACL catalog checks or denied INSERT assertions pass.
