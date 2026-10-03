CREATE TABLE "EmailOutboundMessage" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "recipientName" TEXT,
  "adminCopyEmails" JSONB,
  "subject" TEXT NOT NULL,
  "textBody" TEXT NOT NULL,
  "htmlBody" TEXT,
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

  CONSTRAINT "EmailOutboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOutboundMessage_idempotencyKey_key"
ON "EmailOutboundMessage"("idempotencyKey");

CREATE INDEX "EmailOutboundMessage_status_scheduledAt_idx"
ON "EmailOutboundMessage"("status", "scheduledAt");

CREATE INDEX "EmailOutboundMessage_eventType_createdAt_idx"
ON "EmailOutboundMessage"("eventType", "createdAt");

CREATE INDEX "EmailOutboundMessage_sourceType_sourceId_idx"
ON "EmailOutboundMessage"("sourceType", "sourceId");
