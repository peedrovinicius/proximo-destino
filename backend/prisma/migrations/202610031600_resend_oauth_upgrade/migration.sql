ALTER TABLE "EmailProviderConnection"
ALTER COLUMN "apiKeyEncrypted" DROP NOT NULL;

ALTER TABLE "EmailProviderConnection"
ADD COLUMN "accessTokenEncrypted" TEXT,
ADD COLUMN "refreshTokenEncrypted" TEXT,
ADD COLUMN "scope" TEXT,
ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE TABLE "EmailOAuthState" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeVerifierEncrypted" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOAuthState_stateHash_key"
ON "EmailOAuthState"("stateHash");

CREATE INDEX "EmailOAuthState_userId_expiresAt_idx"
ON "EmailOAuthState"("userId", "expiresAt");

ALTER TABLE "EmailOAuthState"
ADD CONSTRAINT "EmailOAuthState_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
