CREATE TABLE "PaymentPlatformConfig" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" TEXT NOT NULL,
    "webhookSecretEncrypted" TEXT NOT NULL,
    "configuredByUserId" TEXT,
    "configuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentPlatformConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentPlatformConfig_provider_key"
ON "PaymentPlatformConfig"("provider");

CREATE INDEX "PaymentPlatformConfig_configuredByUserId_idx"
ON "PaymentPlatformConfig"("configuredByUserId");
