CREATE TABLE "EmailProviderConnection" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "apiKeyEncrypted" TEXT NOT NULL,
  "fromName" TEXT,
  "fromEmail" TEXT NOT NULL,
  "replyToEmail" TEXT,
  "adminCopyEmail" TEXT,
  "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "connectedByUserId" TEXT,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailProviderConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailProviderConnection_provider_key"
ON "EmailProviderConnection"("provider");

CREATE INDEX "EmailProviderConnection_connectedByUserId_idx"
ON "EmailProviderConnection"("connectedByUserId");

ALTER TABLE "EmailProviderConnection"
ADD CONSTRAINT "EmailProviderConnection_connectedByUserId_fkey"
FOREIGN KEY ("connectedByUserId")
REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
