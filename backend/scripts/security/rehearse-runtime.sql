-- Somente ensaio isolado. Fora das migrations/deploy; não cria login nem senha.
-- Políticas USING(true) servem APENAS aos testes sintéticos: nunca usar em produção.
\if :{?runtime_role}
\else
  \quit 3
\endif
BEGIN;
SELECT set_config('security.runtime_role', :'runtime_role', true);
DO $$
DECLARE target TEXT := current_setting('security.runtime_role');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=target AND NOT rolcanlogin
    AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=target))
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND pg_has_role(target,c.relowner,'MEMBER')) THEN
    RAISE EXCEPTION 'Exige papel NOLOGIN novo, sem poderes administrativos, propriedade ou memberships';
  END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"runtime_role";
REVOKE CREATE ON SCHEMA public FROM :"runtime_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."User" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."AuthSession" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."MfaRecoveryCode" TO :"runtime_role";
GRANT SELECT, INSERT ON TABLE public."AuthAuditEvent" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."Client" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."Companion" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."Trip" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."Reservation" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ReservationPassenger" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."SeatAssignment" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."PurchaseOrder" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."Quote" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."QuoteItem" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."ReservationService" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."FinancePlan" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."Installment" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."TravelDocument" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."ClientCreditTransaction" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PaymentProviderConnection" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."PaymentPlatformConfig" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."EmailProviderConnection" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."EmailOAuthState" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PaymentOAuthState" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."OutboundMessage" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."EmailOutboundMessage" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."AdminNotification" TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public."ManualPayment" TO :"runtime_role";
DO $$
DECLARE target TEXT := current_setting('security.runtime_role'); table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Client','Companion','Trip','Reservation','ReservationPassenger','SeatAssignment','PurchaseOrder','Quote','FinancePlan','Installment','TravelDocument','ManualPayment','ClientCreditTransaction'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass(format('public.%I',table_name))) THEN
      RAISE EXCEPTION 'RLS ausente: %', table_name;
    END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
      'api_runtime_' || md5(target), table_name, target);
  END LOOP;
  IF has_schema_privilege(target,'public','CREATE')
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND (has_table_privilege(target,c.oid,'TRUNCATE')
          OR has_table_privilege(target,c.oid,'TRIGGER')
          OR has_table_privilege(target,c.oid,'REFERENCES')))
    OR has_table_privilege(target,'public."AuthAuditEvent"','UPDATE')
    OR has_table_privilege(target,'public."AuthAuditEvent"','DELETE')
    OR has_table_privilege(target,'public."AuthAuditEvent"','TRUNCATE')
    OR has_table_privilege(target,'public."User"','DELETE')
    OR has_table_privilege(target,'public."_prisma_migrations"','SELECT') THEN
    RAISE EXCEPTION 'Privilégio efetivo excedente; rollback';
  END IF;
END $$;
COMMIT;
