-- Procedimento opt-in: não é uma migration e não é executado pelo deploy.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v audit_runtime_role=nome_do_papel -f protect-audit.sql
-- Primeiro ensaiar em banco isolado; nunca usar papel proprietário como runtime.
\if :{?audit_runtime_role}
\else
  \echo 'Falta audit_runtime_role; nenhuma alteração aplicada.'
  \quit 3
\endif
BEGIN;
SELECT set_config('audit.runtime_role', :'audit_runtime_role', true);
DO $$
DECLARE target TEXT := current_setting('audit.runtime_role');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Papel inexistente, superuser ou BYPASSRLS: procedimento recusado';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'AuthAuditEvent'
      AND pg_has_role(target, c.relowner, 'MEMBER')
  ) THEN
    RAISE EXCEPTION 'Papel proprietário ou membro do proprietário: procedimento recusado';
  END IF;
END $$;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public."AuthAuditEvent" FROM :"audit_runtime_role";
GRANT SELECT, INSERT ON TABLE public."AuthAuditEvent" TO :"audit_runtime_role";
DO $$
DECLARE target TEXT := current_setting('audit.runtime_role');
BEGIN
  IF has_table_privilege(target, 'public."AuthAuditEvent"', 'UPDATE')
    OR has_table_privilege(target, 'public."AuthAuditEvent"', 'DELETE')
    OR has_table_privilege(target, 'public."AuthAuditEvent"', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Privilégio herdado ou PUBLIC ainda permite alterar logs; rollback';
  END IF;
END $$;
COMMIT;
