-- Additive only: all legacy rows remain NULL; no operational activation.
ALTER TABLE "Client" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Trip" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Client_companyId_fullName_idx" ON "Client"("companyId", "fullName");
CREATE INDEX "Trip_companyId_departureDate_idx" ON "Trip"("companyId", "departureDate");
CREATE INDEX "Reservation_companyId_createdAt_idx" ON "Reservation"("companyId", "createdAt");

-- Null-safe checks preserve legacy null/null/null relationships but prohibit
-- mixing scoped and unscoped rows. Deferred mode permits a future reviewed,
-- transactional backfill without temporarily disabling integrity checks.
CREATE FUNCTION "check_reservation_company_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_company TEXT; client_company TEXT; trip_company TEXT; client_id TEXT; trip_id TEXT;
BEGIN
  SELECT "companyId", "clientId", "tripId" INTO current_company, client_id, trip_id
    FROM "Reservation" WHERE "id" = NEW."id";
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT "companyId" INTO client_company FROM "Client" WHERE "id" = client_id FOR SHARE;
  SELECT "companyId" INTO trip_company FROM "Trip" WHERE "id" = trip_id FOR SHARE;
  IF current_company IS DISTINCT FROM client_company OR current_company IS DISTINCT FROM trip_company THEN
    RAISE EXCEPTION 'Reservation company scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Reservation_company_scope_check" AFTER INSERT OR UPDATE ON "Reservation"
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION "check_reservation_company_scope"();

CREATE FUNCTION "check_parent_company_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_company TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Client' THEN
    SELECT "companyId" INTO current_company FROM "Client" WHERE "id" = NEW."id";
    IF EXISTS (SELECT 1 FROM "Reservation" WHERE "clientId" = NEW."id" AND "companyId" IS DISTINCT FROM current_company) THEN
      RAISE EXCEPTION 'Client company scope mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT "companyId" INTO current_company FROM "Trip" WHERE "id" = NEW."id";
    IF EXISTS (SELECT 1 FROM "Reservation" WHERE "tripId" = NEW."id" AND "companyId" IS DISTINCT FROM current_company) THEN
      RAISE EXCEPTION 'Trip company scope mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Client_company_scope_check" AFTER UPDATE ON "Client"
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION "check_parent_company_scope"();
CREATE CONSTRAINT TRIGGER "Trip_company_scope_check" AFTER UPDATE ON "Trip"
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION "check_parent_company_scope"();
