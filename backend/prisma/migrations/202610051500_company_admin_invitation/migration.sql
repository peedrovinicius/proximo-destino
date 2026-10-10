ALTER TABLE "CompanyMembership"
  ADD COLUMN "inviteTokenHash" TEXT,
  ADD COLUMN "inviteExpiresAt" TIMESTAMP(3),
  ADD COLUMN "inviteUsedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "CompanyMembership_inviteTokenHash_key" ON "CompanyMembership"("inviteTokenHash");
