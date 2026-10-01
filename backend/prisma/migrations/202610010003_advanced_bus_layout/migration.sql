ALTER TABLE "Trip"
  ADD COLUMN "deckCount" INTEGER,
  ADD COLUMN "lowerDeckCapacity" INTEGER,
  ADD COLUMN "vehicleFeatures" JSONB,
  ADD COLUMN "blockedSeats" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
