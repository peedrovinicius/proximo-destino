# PR #67 — Portal RLS under a restricted runtime (design gate)

Status: **BLOCKED FOR RELEASE — isolated CI prototype, not an approved production authorization change**. This file records a reproduced incompatibility and the acceptance tests required before introducing privileged SQL. It must not be used as a deployment or privilege-grant script.

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

## Explicit authorization architecture review (2026-10-10)

**Verified limitation:** the customer portal begins with an unauthenticated code/email submission, while the existing tenant helper proves *staff* membership via `AuthSession`. Assigning `app.company_id`, `app.user_id` or `app.session_id` is not an authentication primitive and cannot securely bridge the bootstrap. Furthermore the portal login queries four operational tables whose RLS is scoped to staff membership. Making just the session table writable is neither sufficient nor safe.

**Historical candidate boundary — production integration remains unimplemented:**

- An internal portal-authentication component owns a narrow, audited transaction that looks up the company/reservation/client/trip relationship, verifies normalized email and Argon2-hashed code, enforces expiration/lockout, rotates prior sessions, inserts a single token hash and audit events; input is never accepted as proof merely because a tenant ID matches.
- Subsequent customer operations are limited to the verified reservation and company bound to an unrevoked, unexpired bearer-token hash and current access-code version. Revocation, logout and concurrent logins must serialize on the reservation/session row.
- Do not widen `company_tenant_authorized` to accept portal sessions: staff and customer permissions must remain distinct. No table-wide PUBLIC policies, arbitrary tenant context setters, unconditional definer or broad owner grants.
- If a database definer is needed, its execution owner must have narrowly scoped access rather than all-table ownership. A definer cannot safely take a boolean `code_verified` from a caller as proof. A trusted backend may validate Argon2, but the DB privilege boundary must account explicitly for a compromised/misused runtime. Treat a second trusted component/connection as a new privilege boundary that requires a dedicated security review.
- The gate must reject unexpected SECURITY DEFINER functions and unexpected EXECUTE grants; any reviewed new function requires its exact signature, body fingerprint, owner and grants to be pinned and negative-tested.
- A dedicated test-only harness should instantiate the **real** CompanyClientPortalService through a restricted PostgreSQL connection for both A and B; verify that valid login, token access, rotation and logout succeed, that cross-company and expired/revoked attempts fail, and that direct SQL ACL/RLS probes still fail. The existing 13 passing SQL tests do not satisfy this.

**Review decision:** keep the repair blocked until an authorization design can meet every criterion without turning a caller-controlled datum into a privilege. No migration, executable privileged function or gate allowlist was introduced by this design update.


## Corrected service acceptance harness (2026-10-11)

The prior service-denial test used `service_...` in company slugs. The service rejects underscores before SQL, so that assertion did **not** demonstrate runtime RLS or database access. Valid synthetic slugs now use hyphens, and the test requires Prisma P2010 / PostgreSQL 42501 naming Company; generic rejection is no longer sufficient.

The same two-company fixtures are exercised as a positive control with the disposable migration-owner connection: incorrect code/email rejection, successful login and reservation reads, cross-company denial, session rotation, expiration, credential-version invalidation, concurrent login serialization, logout/replay rejection and preservation of the other company's session. These owner results are **fixture/service controls, not restricted-runtime acceptance**.

The restricted connection must reach the Company SQL query and fail with the exact permission error. With only portal-table SELECT temporarily granted in the disposable database, its portal read and logout must return 401 for both otherwise valid control tokens, leave both sessions unchanged and keep the runtime gate passing. No production grants or policies are changed.

**Remaining release blocker:** successful customer login/read/logout through a reviewed restricted authorization boundary is still unimplemented. Company `FOR SHARE` and the staff-scoped operational RLS path must be addressed together with portal session bootstrap. Do not mark this gate complete, approve merge or activate companies based on the passing owner controls or expected-denial tests.


## Column-level privilege attestation (2026-10-16)

The RED proof at 4449a7abcc9fb5e37bdf48e78940bf65ba442ed2, workflow [38884434106](https://github.com/peedrovinicius/proximo-destino/actions/runs/38884434106), rejected three new assertions: column-only SELECT on portal tokenHash granted to an unrelated LOGIN or PUBLIC, and runtime column-only UPDATE on User.role. In each case PostgreSQL reported the column privilege while the table-level privilege was false, and the old gate incorrectly returned success. These are disposable privilege-attestation counterexamples, not evidence of production grants or a demonstrated production data leak; RLS remains a separate protection.

The gate now inventories both pg_class.relacl and pg_attribute.attacl for the six sensitive tables, retaining the existing owner/runtime allowlist. Protected runtime UPDATE/INSERT/SELECT and REFERENCES checks use has_any_column_privilege, which also recognizes table-level grants. DELETE, TRUNCATE and TRIGGER retain table checks because those privileges are not column-scoped.

The disposable suite covers 54 sensitive-column grant combinations (six tables, three privileges, unrelated LOGIN/PUBLIC/authorized runtime), five forbidden identity/membership column writes, and five column-only audit/migration/REFERENCES permissions. Each temporary grant is revoked in finally and followed by a clean baseline gate. No application privilege is granted by the gate, and no RLS policy or SQL definer is added.

**Portal release status is unchanged:** these ACL corrections do not implement customer credential bootstrap or functional login/read/logout under the restricted runtime. Keep the PR in draft and the portal authorization gate blocked.


## Current experiment status (2026-10-16)

An isolated implementation now exists in [experimental-portal-capability.md](experimental-portal-capability.md). It is a separate CI-only adapter, not the original controller/service. At ecd64523a3f9f133061f4d639125e3734aea5704, disposable workflow [38886833103](https://github.com/peedrovinicius/proximo-destino/actions/runs/38886833103) passed 19 ACL tests and 14 functional capability tests: actual restricted LOGIN login/read/logout for both synthetic companies, isolation, revocation, concurrent logins, signed-proof rejection, challenge single use and direct SQL denial. The subsequent test extension covers credential expiration during a real lock wait and temporary-table shadowing of integrity checks.

The new boundary authenticates backend Argon2 decisions using a distinct synthetic HMAC key and short-lived, row-bound, single-use challenges. An unsigned caller boolean does not suffice. The non-login definer remains under RLS with scoped policies, column-only authority and no table ownership; API SQL cannot read its key or base tables. The existing release gate deliberately rejects the prototype's unreviewed definers. No privileged authorization migration or gate allowlist is introduced. A separate invoker-only integrity-trigger migration repairs the reproduced unqualified-table failure under a pinned search path.

**Delivery remains blocked:** independently review the authority, signing-key provisioning/rotation, challenge retention, HTTP/API contracts/rate limits, gate fingerprints and integration/rollback before connecting the adapter to routes or activating any company. A passing experimental functional test is not a deployed or production-approved portal.
