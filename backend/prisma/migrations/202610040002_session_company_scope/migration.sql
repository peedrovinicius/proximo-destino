-- Existing sessions remain unscoped; no automatic tenant reassignment.
ALTER TABLE "AuthSession" ADD COLUMN "companyId" TEXT;
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AuthSession_companyId_userId_idx" ON "AuthSession"("companyId", "userId");
