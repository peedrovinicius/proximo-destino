CREATE TYPE "OutboundMessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "OutboundMessage" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "eventType" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "recipientPhone" TEXT NOT NULL,
  "recipientName" TEXT,
  "body" TEXT NOT NULL,
  "templateName" TEXT,
  "templateLanguage" TEXT,
  "templateParams" JSONB,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "status" "OutboundMessageStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutboundMessage_idempotencyKey_key"
ON "OutboundMessage"("idempotencyKey");

CREATE INDEX "OutboundMessage_status_scheduledAt_idx"
ON "OutboundMessage"("status", "scheduledAt");

CREATE INDEX "OutboundMessage_eventType_createdAt_idx"
ON "OutboundMessage"("eventType", "createdAt");

CREATE INDEX "OutboundMessage_sourceType_sourceId_idx"
ON "OutboundMessage"("sourceType", "sourceId");
