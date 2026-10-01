CREATE TABLE "PaymentProviderConnection" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalUserId" TEXT,
  "accessTokenEncrypted" TEXT NOT NULL,
  "refreshTokenEncrypted" TEXT,
  "publicKey" TEXT,
  "scope" TEXT,
  "liveMode" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "connectedByUserId" TEXT,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentProviderConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentProviderConnection_provider_key" ON "PaymentProviderConnection"("provider");
CREATE INDEX "PaymentProviderConnection_connectedByUserId_idx" ON "PaymentProviderConnection"("connectedByUserId");
ALTER TABLE "PaymentProviderConnection" ADD CONSTRAINT "PaymentProviderConnection_connectedByUserId_fkey" FOREIGN KEY ("connectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PaymentOAuthState" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentOAuthState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentOAuthState_stateHash_key" ON "PaymentOAuthState"("stateHash");
CREATE INDEX "PaymentOAuthState_userId_expiresAt_idx" ON "PaymentOAuthState"("userId","expiresAt");
ALTER TABLE "PaymentOAuthState" ADD CONSTRAINT "PaymentOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
