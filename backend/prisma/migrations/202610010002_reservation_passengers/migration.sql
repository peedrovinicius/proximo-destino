-- CreateTable
CREATE TABLE "ReservationPassenger" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "fullName" TEXT,
    "document" TEXT,
    "birthDate" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationPassenger_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "SeatAssignment" ADD COLUMN "passengerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ReservationPassenger_reservationId_sequence_key" ON "ReservationPassenger"("reservationId", "sequence");

-- CreateIndex
CREATE INDEX "ReservationPassenger_reservationId_idx" ON "ReservationPassenger"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "SeatAssignment_passengerId_key" ON "SeatAssignment"("passengerId");

-- AddForeignKey
ALTER TABLE "ReservationPassenger" ADD CONSTRAINT "ReservationPassenger_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatAssignment" ADD CONSTRAINT "SeatAssignment_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "ReservationPassenger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
