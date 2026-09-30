CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED');
CREATE TYPE "QuoteItemCategory" AS ENUM ('FLIGHT', 'HOTEL', 'TRANSFER', 'TOUR', 'INSURANCE', 'OTHER');
CREATE TYPE "ReservationServiceStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "InstallmentStatus" AS ENUM ('OPEN', 'PAID', 'OVERDUE', 'CANCELLED');

CREATE TABLE "Quote" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
  "title" TEXT NOT NULL,
  "validUntil" TIMESTAMP(3),
  "notes" TEXT,
  "subtotalCostCents" INTEGER NOT NULL DEFAULT 0,
  "subtotalSaleCents" INTEGER NOT NULL DEFAULT 0,
  "discountCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "marginCents" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuoteItem" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "category" "QuoteItemCategory" NOT NULL,
  "description" TEXT NOT NULL,
  "supplier" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitCostCents" INTEGER NOT NULL DEFAULT 0,
  "unitSaleCents" INTEGER NOT NULL DEFAULT 0,
  "totalCostCents" INTEGER NOT NULL DEFAULT 0,
  "totalSaleCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReservationService" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "sourceQuoteItemId" TEXT,
  "category" "QuoteItemCategory" NOT NULL,
  "description" TEXT NOT NULL,
  "supplier" TEXT,
  "amountCents" INTEGER NOT NULL,
  "status" "ReservationServiceStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReservationService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancePlan" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "downPaymentCents" INTEGER NOT NULL DEFAULT 0,
  "installmentCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Installment" (
  "id" TEXT NOT NULL,
  "financePlanId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" "InstallmentStatus" NOT NULL DEFAULT 'OPEN',
  "paidAt" TIMESTAMP(3),
  "paymentMethod" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Quote_reservationId_revision_key" ON "Quote"("reservationId", "revision");
CREATE INDEX "Quote_reservationId_status_idx" ON "Quote"("reservationId", "status");
CREATE INDEX "QuoteItem_quoteId_category_idx" ON "QuoteItem"("quoteId", "category");
CREATE UNIQUE INDEX "ReservationService_sourceQuoteItemId_key" ON "ReservationService"("sourceQuoteItemId");
CREATE INDEX "ReservationService_reservationId_status_idx" ON "ReservationService"("reservationId", "status");
CREATE UNIQUE INDEX "FinancePlan_reservationId_key" ON "FinancePlan"("reservationId");
CREATE UNIQUE INDEX "FinancePlan_quoteId_key" ON "FinancePlan"("quoteId");
CREATE UNIQUE INDEX "Installment_financePlanId_sequence_key" ON "Installment"("financePlanId", "sequence");
CREATE INDEX "Installment_status_dueDate_idx" ON "Installment"("status", "dueDate");

ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuoteItem"
  ADD CONSTRAINT "QuoteItem_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReservationService"
  ADD CONSTRAINT "ReservationService_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReservationService"
  ADD CONSTRAINT "ReservationService_sourceQuoteItemId_fkey"
  FOREIGN KEY ("sourceQuoteItemId") REFERENCES "QuoteItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinancePlan"
  ADD CONSTRAINT "FinancePlan_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancePlan"
  ADD CONSTRAINT "FinancePlan_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Installment"
  ADD CONSTRAINT "Installment_financePlanId_fkey"
  FOREIGN KEY ("financePlanId") REFERENCES "FinancePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
