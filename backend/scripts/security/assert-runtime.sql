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

  IF has_schema_privilege(current_user, 'public', 'CREATE')
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
