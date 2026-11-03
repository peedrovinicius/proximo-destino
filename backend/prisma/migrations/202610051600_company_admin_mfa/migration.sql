ALTER TABLE "CompanyMembership"
  ADD COLUMN "onboardingTokenHash" TEXT,
  ADD COLUMN "onboardingExpiresAt" TIMESTAMP(3),
  ADD COLUMN "onboardingFailedAttempts" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "CompanyMembership_onboardingTokenHash_key" ON "CompanyMembership"("onboardingTokenHash");
