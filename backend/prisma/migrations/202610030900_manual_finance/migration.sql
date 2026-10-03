CREATE TYPE "ManualPaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'BOLETO');
CREATE TYPE "ManualPaymentStatus" AS ENUM ('RECEIVED', 'REVERSED');

CREATE TABLE "ManualPayment" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "financePlanId" TEXT,
  "installmentId" TEXT,
  "method" "ManualPaymentMethod" NOT NULL,
  "status" "ManualPaymentStatus" NOT NULL DEFAULT 'RECEIVED',
  "amountCents" INTEGER NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "reference" TEXT,
  "note" TEXT,
  "recordedByUserId" TEXT,
  "reversedAt" TIMESTAMP(3),
  "reversedReason" TEXT,
  "reversedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ManualPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManualPayment_reservationId_status_paidAt_idx"
ON "ManualPayment"("reservationId", "status", "paidAt");

CREATE INDEX "ManualPayment_installmentId_status_idx"
ON "ManualPayment"("installmentId", "status");

CREATE INDEX "ManualPayment_method_paidAt_idx"
ON "ManualPayment"("method", "paidAt");

ALTER TABLE "ManualPayment"
ADD CONSTRAINT "ManualPayment_reservationId_fkey"
FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPayment"
ADD CONSTRAINT "ManualPayment_financePlanId_fkey"
FOREIGN KEY ("financePlanId") REFERENCES "FinancePlan"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManualPayment"
ADD CONSTRAINT "ManualPayment_installmentId_fkey"
FOREIGN KEY ("installmentId") REFERENCES "Installment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManualPayment"
ADD CONSTRAINT "ManualPayment_recordedByUserId_fkey"
FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManualPayment"
ADD CONSTRAINT "ManualPayment_reversedByUserId_fkey"
FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
