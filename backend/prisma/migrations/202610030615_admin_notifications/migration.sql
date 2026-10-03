CREATE TABLE "AdminNotification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "actionTab" TEXT,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminNotification_userId_sourceKey_key"
ON "AdminNotification"("userId", "sourceKey");

CREATE INDEX "AdminNotification_userId_isRead_createdAt_idx"
ON "AdminNotification"("userId", "isRead", "createdAt");

CREATE INDEX "AdminNotification_type_createdAt_idx"
ON "AdminNotification"("type", "createdAt");

ALTER TABLE "AdminNotification"
ADD CONSTRAINT "AdminNotification_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
