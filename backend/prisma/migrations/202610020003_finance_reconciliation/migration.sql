ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

ALTER TABLE "PurchaseOrder"
ADD COLUMN "providerPaymentId" TEXT,
ADD COLUMN "providerOrderId" TEXT,
ADD COLUMN "providerStatus" TEXT,
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "refundedAt" TIMESTAMP(3),
ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

ALTER TABLE "FinancePlan"
ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "PurchaseOrder_providerPaymentId_idx" ON "PurchaseOrder"("providerPaymentId");
CREATE INDEX "PurchaseOrder_providerOrderId_idx" ON "PurchaseOrder"("providerOrderId");
