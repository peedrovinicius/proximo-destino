CREATE TYPE "ClientCreditTransactionType" AS ENUM ('CANCELLATION_CREDIT', 'BONUS_USED', 'BONUS_REMOVED');

CREATE TABLE "ClientCreditTransaction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reservationId" TEXT,
    "type" "ClientCreditTransactionType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "sourceKey" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCreditTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientCreditTransaction_sourceKey_key" ON "ClientCreditTransaction"("sourceKey");
CREATE INDEX "ClientCreditTransaction_clientId_createdAt_idx" ON "ClientCreditTransaction"("clientId", "createdAt");
CREATE INDEX "ClientCreditTransaction_reservationId_idx" ON "ClientCreditTransaction"("reservationId");

ALTER TABLE "ClientCreditTransaction"
ADD CONSTRAINT "ClientCreditTransaction_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientCreditTransaction"
ADD CONSTRAINT "ClientCreditTransaction_reservationId_fkey"
FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClientCreditTransaction"
ADD CONSTRAINT "ClientCreditTransaction_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
