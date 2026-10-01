CREATE TABLE "SeatAssignment" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "seatNumber" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeatAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeatAssignment_tripId_seatNumber_key"
  ON "SeatAssignment"("tripId", "seatNumber");

CREATE UNIQUE INDEX "SeatAssignment_reservationId_seatNumber_key"
  ON "SeatAssignment"("reservationId", "seatNumber");

CREATE INDEX "SeatAssignment_reservationId_idx"
  ON "SeatAssignment"("reservationId");

ALTER TABLE "SeatAssignment"
  ADD CONSTRAINT "SeatAssignment_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeatAssignment"
  ADD CONSTRAINT "SeatAssignment_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
