CREATE TABLE "EmailProviderConnection" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "accessTokenEncrypted" TEXT NOT NULL,
  "refreshTokenEncrypted" TEXT,
  "scope" TEXT,
  "expiresAt" TIMESTAMP(3),
  "fromEmail" TEXT,
  "fromName" TEXT,
  "connectedByUserId" TEXT,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailProviderConnection_pkey" PRIMARY KEY ("id")
);

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

CREATE UNIQUE INDEX "EmailProviderConnection_provider_key"
ON "EmailProviderConnection"("provider");

CREATE INDEX "EmailProviderConnection_connectedByUserId_idx"
ON "EmailProviderConnection"("connectedByUserId");

CREATE UNIQUE INDEX "EmailOAuthState_stateHash_key"
ON "EmailOAuthState"("stateHash");

CREATE INDEX "EmailOAuthState_userId_expiresAt_idx"
ON "EmailOAuthState"("userId", "expiresAt");

ALTER TABLE "EmailProviderConnection"
ADD CONSTRAINT "EmailProviderConnection_connectedByUserId_fkey"
FOREIGN KEY ("connectedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailOAuthState"
ADD CONSTRAINT "EmailOAuthState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
