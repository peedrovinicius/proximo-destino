CREATE TYPE "TravelDocumentType" AS ENUM ('TRAVEL_VOUCHER', 'PURCHASE_RECEIPT');

CREATE TABLE "TravelDocument" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "type" "TravelDocumentType" NOT NULL,
  "version" INTEGER NOT NULL,
  "documentNumber" TEXT NOT NULL,
  "verificationCode" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "issuedByUserId" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TravelDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TravelDocument_documentNumber_key"
  ON "TravelDocument"("documentNumber");

CREATE UNIQUE INDEX "TravelDocument_verificationCode_key"
  ON "TravelDocument"("verificationCode");

CREATE UNIQUE INDEX "TravelDocument_reservationId_type_version_key"
  ON "TravelDocument"("reservationId", "type", "version");

CREATE INDEX "TravelDocument_reservationId_type_issuedAt_idx"
  ON "TravelDocument"("reservationId", "type", "issuedAt");

ALTER TABLE "TravelDocument"
  ADD CONSTRAINT "TravelDocument_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TravelDocument"
  ADD CONSTRAINT "TravelDocument_issuedByUserId_fkey"
  FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
