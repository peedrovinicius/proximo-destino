-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AGENT', 'FINANCE', 'CLIENT');
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Client" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "fullName" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "birthDate" TIMESTAMP(3),
  "document" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Companion" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "document" TEXT,
  "birthDate" TIMESTAMP(3),
  "relationship" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Companion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Trip" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "departureDate" TIMESTAMP(3) NOT NULL,
  "returnDate" TIMESTAMP(3),
  "status" "TripStatus" NOT NULL DEFAULT 'DRAFT',
  "capacity" INTEGER,
  "priceCents" INTEGER,
  "summary" TEXT,
  "imageUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Reservation" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Client_userId_key" ON "Client"("userId");
CREATE INDEX "Client_fullName_idx" ON "Client"("fullName");
CREATE INDEX "Client_birthDate_idx" ON "Client"("birthDate");
CREATE INDEX "Companion_clientId_idx" ON "Companion"("clientId");
CREATE INDEX "Companion_birthDate_idx" ON "Companion"("birthDate");
CREATE INDEX "Trip_origin_destination_departureDate_idx" ON "Trip"("origin", "destination", "departureDate");
CREATE INDEX "Trip_status_departureDate_idx" ON "Trip"("status", "departureDate");
CREATE UNIQUE INDEX "Reservation_clientId_tripId_key" ON "Reservation"("clientId", "tripId");
CREATE INDEX "Reservation_tripId_status_idx" ON "Reservation"("tripId", "status");

-- ForeignKeys
ALTER TABLE "Client"
  ADD CONSTRAINT "Client_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Companion"
  ADD CONSTRAINT "Companion_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
