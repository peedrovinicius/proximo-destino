ALTER TABLE "Reservation" ADD COLUMN "companyPortalFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Reservation" ADD COLUMN "companyPortalLockedUntil" TIMESTAMP(3);
CREATE TABLE "CompanyClientPortalSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "credentialVersion" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyClientPortalSession_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CompanyClientPortalSession_tokenHash_key" ON "CompanyClientPortalSession"("tokenHash");
CREATE INDEX "CompanyClientPortalSession_reservationId_createdAt_idx" ON "CompanyClientPortalSession"("reservationId", "createdAt");
ALTER TABLE "CompanyClientPortalSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_only_company_client_portal_session" ON "CompanyClientPortalSession" FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
