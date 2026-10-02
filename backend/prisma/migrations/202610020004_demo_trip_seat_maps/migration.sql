UPDATE "Trip"
SET
  "capacity" = 44,
  "busTemplate" = 'CONVENCIONAL_44',
  "seatLayout" = 'TWO_BY_TWO',
  "deckCount" = 1,
  "lowerDeckCapacity" = NULL,
  "vehicleFeatures" = '[]'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('ACTIVE', 'SCHEDULED')
  AND (
    "capacity" IS NULL
    OR "capacity" < 1
    OR "capacity" > 80
  );
