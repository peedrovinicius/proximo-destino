-- Diagnóstico somente leitura, executado com a conexão usada pela API.
-- Não altera usuários, grants, políticas, sessões ou migrations.
BEGIN READ ONLY;
SELECT
  NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
    AS restricted_role,
  r.rolcanlogin AS login_role,
  NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS no_inherited_roles,
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND pg_has_role(current_user,c.relowner,'MEMBER')) AS no_table_ownership,
  NOT has_schema_privilege(current_user,'public','CREATE') AS no_schema_creation,
  NOT has_table_privilege(current_user,'public."AuthAuditEvent"','UPDATE')
    AND NOT has_table_privilege(current_user,'public."AuthAuditEvent"','DELETE')
    AND NOT has_table_privilege(current_user,'public."AuthAuditEvent"','TRUNCATE') AS audit_append_only,
  NOT has_table_privilege(current_user,'public."_prisma_migrations"','SELECT')
    AND NOT has_table_privilege(current_user,'public."_prisma_migrations"','UPDATE')
    AND NOT has_table_privilege(current_user,'public."_prisma_migrations"','DELETE') AS migrations_separated,
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND
      (has_table_privilege(current_user,c.oid,'TRUNCATE') OR
       has_table_privilege(current_user,c.oid,'TRIGGER') OR
       has_table_privilege(current_user,c.oid,'REFERENCES'))) AS no_ddl_like_table_privileges
FROM pg_roles r WHERE r.rolname=current_user;
SELECT count(*) AS sensitive_tables_with_rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relrowsecurity AND c.relname IN
 ('Client','Companion','Reservation','ReservationPassenger','SeatAssignment','PurchaseOrder',
  'Quote','FinancePlan','Installment','TravelDocument','ManualPayment','ClientCreditTransaction');
ROLLBACK;
