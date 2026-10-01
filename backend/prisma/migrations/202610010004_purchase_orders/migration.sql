CREATE TYPE "PurchaseStatus" AS ENUM (
  'PENDING_PAYMENT',
  'PAID',
  'CANCELLED',
  'EXPIRED'
);

CREATE TYPE "PurchasePaymentMethod" AS ENUM (
  'PIX',
  'CARD',
  'BOLETO',
  'TRANSFER'
);

CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "paymentMethod" "PurchasePaymentMethod" NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  "passengerCount" INTEGER NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrder_reservationId_key"
  ON "PurchaseOrder"("reservationId");

CREATE INDEX "PurchaseOrder_status_createdAt_idx"
  ON "PurchaseOrder"("status", "createdAt");

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
