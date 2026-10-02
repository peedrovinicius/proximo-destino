CREATE TYPE "CancellationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Reservation"
ADD COLUMN "cancellationRequestStatus" "CancellationRequestStatus",
ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3),
ADD COLUMN "cancellationRequestReason" TEXT,
ADD COLUMN "cancellationRequestResolvedAt" TIMESTAMP(3),
ADD COLUMN "cancellationRequestResolutionNote" TEXT,
ADD COLUMN "cancellationRequestResolvedByUserId" TEXT;
