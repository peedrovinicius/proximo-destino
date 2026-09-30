ALTER TABLE "User"
  ADD COLUMN "refreshTokenHash" TEXT,
  ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");
