-- Qualify integrity-trigger reads under restricted SECURITY DEFINER callers.
-- Reproduced by the disposable portal proof: search_path=pg_catalog caused
-- check_reservation_company_scope to fail with 42P01 on unqualified tables.
-- Keep invoker authority, row locks and null-safe tenant constraints intact.
CREATE OR REPLACE FUNCTION public."check_reservation_company_scope"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $
DECLARE current_company TEXT; client_company TEXT; trip_company TEXT; client_id TEXT; trip_id TEXT;
BEGIN
  SELECT "companyId", "clientId", "tripId" INTO current_company, client_id, trip_id
    FROM public."Reservation" WHERE "id" = NEW."id";
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT "companyId" INTO client_company FROM public."Client" WHERE "id" = client_id FOR SHARE;
  SELECT "companyId" INTO trip_company FROM public."Trip" WHERE "id" = trip_id FOR SHARE;
  IF current_company IS DISTINCT FROM client_company OR current_company IS DISTINCT FROM trip_company THEN
    RAISE EXCEPTION 'Reservation company scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public."check_parent_company_scope"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $
DECLARE current_company TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Client' THEN
    SELECT "companyId" INTO current_company FROM public."Client" WHERE "id" = NEW."id";
    IF EXISTS (SELECT 1 FROM public."Reservation" WHERE "clientId" = NEW."id" AND "companyId" IS DISTINCT FROM current_company) THEN
      RAISE EXCEPTION 'Client company scope mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT "companyId" INTO current_company FROM public."Trip" WHERE "id" = NEW."id";
    IF EXISTS (SELECT 1 FROM public."Reservation" WHERE "tripId" = NEW."id" AND "companyId" IS DISTINCT FROM current_company) THEN
      RAISE EXCEPTION 'Trip company scope mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
