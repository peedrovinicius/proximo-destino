ALTER TABLE "Client"
  ADD CONSTRAINT "Client_email_key" UNIQUE ("email");

ALTER TABLE "Reservation"
  ADD COLUMN "passengerCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "accessCodeHash" TEXT;
