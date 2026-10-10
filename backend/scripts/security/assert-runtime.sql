-- Gate somente leitura: pré-requisito para avaliar o papel de execução da API.
-- Executar com a conexão EFETIVA da API em ambiente de homologação controlado:
--   psql -X -v ON_ERROR_STOP=1 -f scripts/security/assert-runtime.sql
-- Não concede privilégios, não ativa empresas e não substitui testes entre tenants.
-- Ao contrário de rehearse-runtime.sql, nunca deve criar políticas permissivas.
BEGIN READ ONLY;

DO $gate$
DECLARE
  expected_tables TEXT[] := ARRAY[
    'Client', 'Companion', 'Trip', 'Reservation', 'ReservationPassenger',
    'SeatAssignment', 'PurchaseOrder', 'Quote', 'QuoteItem', 'ReservationService', 'FinancePlan',
    'Installment', 'TravelDocument', 'ManualPayment', 'ClientCreditTransaction'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname = current_user
      AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb
        OR r.rolcreaterole OR r.rolreplication)
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = current_user
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: papel com poderes administrativos ou herança de funções';
  END IF;

  -- A database-level CREATE grant allows the runtime to create arbitrary
  -- non-public schemas; schema-level CREATE allows planting other functions.
  -- Inspect effective privileges on *all* non-system schemas, not just public.
  IF has_database_privilege(current_user, current_database(), 'CREATE')
    OR EXISTS (
      SELECT 1 FROM pg_namespace n
      WHERE n.nspname <> 'information_schema'
        AND n.nspname !~ '^pg_'
        AND has_schema_privilege(current_user, n.oid, 'CREATE')
    )
    OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND pg_has_role(current_user, c.relowner, 'MEMBER')
    )
    OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
        AND (has_table_privilege(current_user, c.oid, 'TRUNCATE')
          OR has_table_privilege(current_user, c.oid, 'TRIGGER')
          OR has_table_privilege(current_user, c.oid, 'REFERENCES'))
    ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: runtime possui DDL, ownership ou privilegios elevados';
  END IF;

  IF has_table_privilege(current_user, 'public."AuthAuditEvent"', 'UPDATE')
    OR has_table_privilege(current_user, 'public."AuthAuditEvent"', 'DELETE')
    OR has_table_privilege(current_user, 'public."AuthAuditEvent"', 'TRUNCATE')
    -- Runtime uses applied migrations but must never forge migration records.
    OR has_table_privilege(current_user, 'public."_prisma_migrations"', 'INSERT')
    OR has_table_privilege(current_user, 'public."_prisma_migrations"', 'SELECT')
    OR has_table_privilege(current_user, 'public."_prisma_migrations"', 'UPDATE')
    OR has_table_privilege(current_user, 'public."_prisma_migrations"', 'DELETE') THEN
    RAISE EXCEPTION 'GATE_RUNTIME: auditoria ou migrations acessiveis indevidamente';
  END IF;

  IF (
    SELECT count(*) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(expected_tables) AND c.relrowsecurity
      AND c.relkind IN ('r','p')
  ) <> cardinality(expected_tables) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: tabela sensivel sem RLS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc fn
    JOIN pg_namespace n ON n.oid = fn.pronamespace
    WHERE n.nspname = 'public'
      AND fn.proname = 'company_tenant_authorized'
      AND fn.prosecdef
      AND fn.provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: funcao de autorizacao tenant ausente ou insegura';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc fn
    JOIN pg_namespace n ON n.oid = fn.pronamespace
    WHERE n.nspname = 'public'
      AND fn.proname = 'company_write_authorized'
      AND fn.prosecdef
      AND fn.provolatile = 'v'
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: funcao de lock de autorizacao ausente ou insegura';
  END IF;

  -- SECURITY DEFINER is an authority boundary. A name + volatility-only
  -- check can be bypassed by replacing the function body with SELECT true,
  -- leaving SECURITY DEFINER, STABLE/VOLATILE and search_path unchanged.
  -- Pin the complete reviewed prosrc body from the original migrations.
  -- This is a fixed migration-reviewed baseline, never read from the
  -- current database to self-certify a compromised function.
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('company_tenant_authorized', 'public.company_tenant_authorized(text)',
        'sql', 's', '89c73cf7463057fb31dad559036b9d93'),
      ('company_write_authorized', 'public.company_write_authorized(text,text,text,text)',
        'plpgsql', 'v', 'df80a956fd405ae0e9e109ef0c93e783')
    ) AS canonical(name, signature, language_name, expected_volatility, source_md5)
    LEFT JOIN pg_proc fn ON fn.oid = to_regprocedure(canonical.signature)
    LEFT JOIN pg_language lang ON lang.oid = fn.prolang
    WHERE fn.oid IS NULL
      OR fn.proname <> canonical.name
      OR fn.prorettype <> 'pg_catalog.bool'::regtype
      OR lang.lanname IS DISTINCT FROM canonical.language_name
      OR NOT fn.prosecdef
      OR fn.provolatile IS DISTINCT FROM canonical.expected_volatility::"char"
      OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR md5(fn.prosrc) IS DISTINCT FROM canonical.source_md5
      OR pg_has_role(current_user, fn.proowner, 'MEMBER')
      OR NOT has_function_privilege(current_user, fn.oid, 'EXECUTE')
  ) OR (
    SELECT count(*) FROM pg_proc fn JOIN pg_namespace n ON n.oid=fn.pronamespace
    WHERE n.nspname='public'
      AND fn.proname IN ('company_tenant_authorized', 'company_write_authorized')
  ) <> 2 THEN
    RAISE EXCEPTION 'GATE_RUNTIME: integridade de funcao SECURITY DEFINER';
  END IF;

  -- Unknown SECURITY DEFINER routines are a distinct authority boundary.
  -- Auditing only two known functions leaves any later definer able to run
  -- with its owner's privileges (potentially via default PUBLIC EXECUTE).
  -- Fail closed on all unreviewed public-schema definers; adding a reviewed
  -- function requires a deliberate migration, source audit and gate update.
  IF EXISTS (
    SELECT 1 FROM pg_proc fn
    JOIN pg_namespace n ON n.oid = fn.pronamespace
    WHERE n.nspname = 'public'
      AND fn.prosecdef
      AND fn.oid NOT IN (
        'public.company_tenant_authorized(text)'::regprocedure,
        'public.company_write_authorized(text,text,text,text)'::regprocedure
      )
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: funcao SECURITY DEFINER nao revisada';
  END IF;

  -- PostgreSQL gives new functions EXECUTE to PUBLIC unless explicitly
  -- revoked. has_function_privilege(current_user, ..., 'EXECUTE') alone is
  -- therefore insufficient: any unrelated SQL login can call a SECURITY
  -- DEFINER helper, despite not belonging to the application runtime.
  -- Evaluate the effective ACL (including proacl IS NULL defaults), not only
  -- explicit aclitems. This gate is READ ONLY: rollout must GRANT the reviewed
  -- runtime principal first, then REVOKE PUBLIC through approved DBA steps.
  IF EXISTS (
    SELECT 1 FROM pg_proc fn
    JOIN pg_namespace n ON n.oid = fn.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(fn.proacl, acldefault('f', fn.proowner))
    ) granted
    WHERE n.nspname = 'public'
      AND fn.proname IN ('company_tenant_authorized', 'company_write_authorized')
      AND granted.grantee = 0
      AND granted.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: EXECUTE via PUBLIC em funcao SECURITY DEFINER';
  END IF;

  -- The public inventory is not enough when the runtime can invoke a
  -- privileged helper in an extension/application schema. A SECURITY DEFINER
  -- executes as its owner even if this runtime cannot CREATE in that schema.
  -- Inspect effective USAGE + EXECUTE, not just schema ownership or PUBLIC ACL.
  IF EXISTS (
    SELECT 1 FROM pg_proc fn
    JOIN pg_namespace n ON n.oid = fn.pronamespace
    WHERE n.nspname <> 'public'
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND fn.prosecdef
      AND has_schema_privilege(current_user, n.oid, 'USAGE')
      AND has_function_privilege(current_user, fn.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: funcao SECURITY DEFINER acessivel fora de public';
  END IF;

  -- EXECUTE granted directly to an unrelated LOGIN or intermediary group
  -- also crosses this authority boundary. Only the reviewed runtime login
  -- and the function owner may hold named EXECUTE grants. PUBLIC is rejected
  -- separately above, including when proacl is NULL.
  IF EXISTS (
    SELECT 1 FROM pg_proc fn
    JOIN pg_namespace n ON n.oid = fn.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(fn.proacl, acldefault('f', fn.proowner))
    ) granted
    WHERE n.nspname = 'public'
      AND fn.proname IN ('company_tenant_authorized', 'company_write_authorized')
      AND granted.privilege_type = 'EXECUTE'
      AND granted.grantee <> 0
      AND granted.grantee <> fn.proowner
      AND granted.grantee <> (
        SELECT oid FROM pg_roles WHERE rolname = current_user
      )
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: EXECUTE concedido a papel estranho em funcao SECURITY DEFINER';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('Client','tenant_session_client'),
      ('Companion','tenant_session_companion'),
      ('Trip','tenant_session_trip'),
      ('Reservation','tenant_session_reservation'),
      ('ReservationPassenger','tenant_session_reservation_passenger'),
      ('SeatAssignment','tenant_session_seat_assignment'),
      ('PurchaseOrder','tenant_session_purchase_order'),
      ('Quote','tenant_session_quote'),
      ('QuoteItem','tenant_session_quote_item'),
      ('ReservationService','tenant_session_reservation_service'),
      ('FinancePlan','tenant_session_finance_plan'),
      ('Installment','tenant_session_installment'),
      ('TravelDocument','tenant_session_travel_document'),
      ('ManualPayment','tenant_session_manual_payment'),
      ('ClientCreditTransaction','tenant_session_client_credit')
    ) AS required(table_name, policy_name)
    LEFT JOIN pg_policies p
      ON p.schemaname = 'public'
      AND p.tablename = required.table_name
      AND p.policyname = required.policy_name
      AND p.cmd = 'ALL'
      AND 'public' = ANY(p.roles)
    WHERE p.policyname IS NULL
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: politica tenant por sessao ausente';
  END IF;

  -- Políticas USING(true)/WITH CHECK(true) não isolam tenants, mesmo com
  -- relrowsecurity=true. Detectar as que se aplicam ao runtime ou PUBLIC.
  IF EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = ANY(expected_tables)
      AND ('public' = ANY(p.roles) OR current_user = ANY(p.roles))
      AND (
        lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')) = 'true'
        OR lower(regexp_replace(coalesce(p.with_check, ''), '[[:space:]()]', '', 'g')) = 'true'
      )
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: politica RLS permissiva para tabela sensivel';
  END IF;

  -- PostgreSQL OR-combines PERMISSIVE policies. A second SELECT policy
  -- such as USING ("id" IS NOT NULL) can expose every tenant even while
  -- tenant_session_* still exists and no policy contains literal true.
  -- Reject any unexpected permissive policy applying to this login/PUBLIC.
  -- Additional RESTRICTIVE policies may safely narrow access.
  IF EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = ANY(expected_tables)
      AND p.permissive = 'PERMISSIVE'
      AND ('public' = ANY(p.roles) OR current_user = ANY(p.roles))
      AND NOT (
        -- Reviewed tenant policies must still use persisted-session
        -- authorization for both reads and writes.
        (p.cmd = 'ALL' AND p.roles = ARRAY['public']::name[]
          AND position('company_tenant_authorized' IN coalesce(p.qual, '')) > 0
          AND position('company_tenant_authorized' IN coalesce(p.with_check, '')) > 0
          AND (p.tablename, p.policyname) IN (
            VALUES
              ('Client','tenant_session_client'),
              ('Companion','tenant_session_companion'),
              ('Trip','tenant_session_trip'),
              ('Reservation','tenant_session_reservation'),
              ('ReservationPassenger','tenant_session_reservation_passenger'),
              ('SeatAssignment','tenant_session_seat_assignment'),
              ('PurchaseOrder','tenant_session_purchase_order'),
              ('Quote','tenant_session_quote'),
              ('QuoteItem','tenant_session_quote_item'),
              ('ReservationService','tenant_session_reservation_service'),
              ('FinancePlan','tenant_session_finance_plan'),
              ('Installment','tenant_session_installment'),
              ('TravelDocument','tenant_session_travel_document'),
              ('ManualPayment','tenant_session_manual_payment'),
              ('ClientCreditTransaction','tenant_session_client_credit')
          ))
        OR
        -- Legacy default-deny policies are safe only while both clauses
        -- remain literally false; the name alone never establishes safety.
        (p.cmd = 'ALL' AND p.roles = ARRAY['public']::name[]
          AND (p.tablename, p.policyname) IN (
            VALUES
              ('Client','api_only_client'),
              ('Companion','api_only_companion'),
              ('Reservation','api_only_reservation'),
              ('ReservationPassenger','api_only_reservation_passenger'),
              ('PurchaseOrder','api_only_purchase_order'),
              ('FinancePlan','api_only_finance_plan'),
              ('TravelDocument','api_only_travel_document'),
              ('ClientCreditTransaction','api_only_client_credit'),
              ('SeatAssignment','api_only_seat_assignment'),
              ('Quote','api_only_quote'),
              ('Installment','api_only_installment'),
              ('ManualPayment','api_only_manual_payment'),
              ('Trip','api_only_trip'),
              ('QuoteItem','api_only_quote_item'),
              ('ReservationService','api_only_reservation_service')
          )
          AND lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')) = 'false'
          AND lower(regexp_replace(coalesce(p.with_check, ''), '[[:space:]()]', '', 'g')) = 'false')
      )
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: politica RLS permissiva nao revisada ou enfraquecida';
  END IF;

  -- Exact reviewed PostgreSQL expression fingerprints. The earlier
  -- allowlist verifies policy names and that the guard function appears,
  -- but it cannot detect: tenant_authorized(companyId) OR id IS NOT NULL.
  -- A canonical digest of BOTH USING and WITH CHECK closes that gap,
  -- including nested parent joins and the legitimate ClientCredit OR.
  --
  -- Baseline: reviewed 202610071900_session_backed_tenant_rls migration,
  -- captured from pg_policies on CI's disposable PostgreSQL. No runtime-
  -- generated/learned baseline: a compromised policy must never self-certify.
  -- PostgreSQL deparser changes can fail closed after a major upgrade;
  -- rebaseline is permitted only with a manual review of migration SQL.
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('Client', 'tenant_session_client', 'f4667708bd21036303d13e6c4fd55c71'),
      ('ClientCreditTransaction', 'tenant_session_client_credit', 'c97adc205714687c06bbe5c4a697ca9f'),
      ('Companion', 'tenant_session_companion', 'cea2a7dbc10d8ffbb46e6a8854d3fe2b'),
      ('FinancePlan', 'tenant_session_finance_plan', '194a833d67618735e7d71052d178acc1'),
      ('Installment', 'tenant_session_installment', '4a17c0473d864fc579702a339ddf997b'),
      ('ManualPayment', 'tenant_session_manual_payment', 'a86b096072a2a0367e02ac93fc4be083'),
      ('PurchaseOrder', 'tenant_session_purchase_order', 'e22239d3c0054b6aba13c9b0bd0d1d8d'),
      ('Quote', 'tenant_session_quote', '86f6ceba00f957cc1a6a296fcae4029d'),
      ('QuoteItem', 'tenant_session_quote_item', '93017e90283d1796c18860574baac40a'),
      ('Reservation', 'tenant_session_reservation', 'f4667708bd21036303d13e6c4fd55c71'),
      ('ReservationPassenger', 'tenant_session_reservation_passenger', 'e86858580f7328ac131d5e53311edbe1'),
      ('ReservationService', 'tenant_session_reservation_service', 'ed810eb5c5fce2422282dd8aa0449bcc'),
      ('SeatAssignment', 'tenant_session_seat_assignment', '156fec71c58645511ab17bc48368c817'),
      ('TravelDocument', 'tenant_session_travel_document', '0143db501780448ac7da7d61e9653558'),
      ('Trip', 'tenant_session_trip', 'f4667708bd21036303d13e6c4fd55c71')
    ) AS canonical(table_name, policy_name, expression_md5)
    LEFT JOIN pg_policies p
      ON p.schemaname = 'public'
      AND p.tablename = canonical.table_name
      AND p.policyname = canonical.policy_name
    WHERE p.policyname IS NULL
      OR md5(coalesce(p.qual, '') || chr(31) || coalesce(p.with_check, ''))
           IS DISTINCT FROM canonical.expression_md5
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: expressao RLS aprovada foi alterada';
  END IF;

  -- The client portal stores bearer token hashes. It must exist and retain
  -- RLS and the reviewed default-deny policy even if ACLs look restrictive.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'CompanyClientPortalSession'
      AND c.relkind IN ('r','p')
      AND c.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'CompanyClientPortalSession'
      AND p.policyname = 'api_only_company_client_portal_session'
      AND p.cmd = 'ALL'
      AND p.roles = ARRAY['public']::name[]
      AND lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')) = 'false'
      AND lower(regexp_replace(coalesce(p.with_check, ''), '[[:space:]()]', '', 'g')) = 'false'
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: protecao RLS do portal ausente ou alterada';
  END IF;

  -- A reviewed deny policy does not constrain a second PERMISSIVE policy:
  -- PostgreSQL OR-combines them. Reject unreviewed permissive portal policies
  -- applicable to this runtime or PUBLIC, even without literal USING(true).
  IF EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'CompanyClientPortalSession'
      AND p.permissive = 'PERMISSIVE'
      AND ('public' = ANY(p.roles) OR current_user = ANY(p.roles))
      AND NOT (
        p.policyname = 'api_only_company_client_portal_session'
        AND p.cmd = 'ALL'
        AND p.roles = ARRAY['public']::name[]
        AND lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')) = 'false'
        AND lower(regexp_replace(coalesce(p.with_check, ''), '[[:space:]()]', '', 'g')) = 'false'
      )
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: politica permissiva do portal nao revisada';
  END IF;

  -- Secrets and portal/OAuth tokens are not tenant-operational tables.
  -- Fail closed if PUBLIC or any role besides the table owner and this
  -- attested runtime LOGIN has explicit read/write access. This reads the
  -- effective ACL representation, including PostgreSQL default ACLs.
  -- Retain legitimate runtime grants; do not modify grants here.
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(c.relacl, acldefault('r', c.relowner))
    ) acl
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
      AND c.relname IN (
        'CompanyClientPortalSession',
        'EmailOAuthState',
        'PaymentOAuthState',
        'EmailProviderConnection',
        'PaymentProviderConnection',
        'PaymentPlatformConfig'
      )
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      AND acl.grantee <> c.relowner
      AND acl.grantee <> (
        SELECT oid FROM pg_roles WHERE rolname = current_user
      )
  ) THEN
    RAISE EXCEPTION 'GATE_RUNTIME: ACL sensivel concedida a papel nao autorizado';
  END IF;

  -- The runtime must not modify persisted authorization directly. All
  -- mutations to company identity/session/membership require a separately
  -- reviewed path; these privileges can bypass API-level tenancy guards.
  -- Check effective privileges, including grants inherited via PUBLIC.
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('User'), ('AuthSession'), ('Company'), ('CompanyMembership')
    ) AS protected(table_name)
    WHERE has_table_privilege(current_user,
      format('public.%I', protected.table_name), 'UPDATE')
      OR has_table_privilege(current_user,
        format('public.%I', protected.table_name), 'DELETE')
  ) OR has_table_privilege(current_user, 'public."CompanyMembership"', 'INSERT') THEN
    RAISE EXCEPTION 'GATE_RUNTIME: escrita direta em identidade ou vinculos de tenant';
  END IF;
END
$gate$;

ROLLBACK;
