-- CreateEnum
CREATE TYPE "BoardingStatus" AS ENUM ('PENDING', 'BOARDED', 'ABSENT');

-- AlterTable
ALTER TABLE "ReservationPassenger"
ADD COLUMN "boardingStatus" "BoardingStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "boardedAt" TIMESTAMP(3);
