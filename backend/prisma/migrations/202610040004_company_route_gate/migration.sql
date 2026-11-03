-- A managed company account must never fall back to global legacy privileges.
ALTER TABLE "User" ADD COLUMN "companyManaged" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" u SET "companyManaged" = true
  WHERE EXISTS (SELECT 1 FROM "CompanyMembership" m WHERE m."userId" = u."id");
CREATE FUNCTION "mark_company_managed_user"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "User" SET "companyManaged" = true WHERE "id" = NEW."userId";
  RETURN NEW;
END $$;
CREATE TRIGGER "CompanyMembership_mark_managed" AFTER INSERT OR UPDATE OF "userId" ON "CompanyMembership"
  FOR EACH ROW EXECUTE FUNCTION "mark_company_managed_user"();
CREATE FUNCTION "prevent_company_managed_reset"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."companyManaged" AND NOT NEW."companyManaged" THEN
    RAISE EXCEPTION 'Company managed account cannot become legacy' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_company_managed_no_reset" BEFORE UPDATE OF "companyManaged" ON "User"
  FOR EACH ROW EXECUTE FUNCTION "prevent_company_managed_reset"();
