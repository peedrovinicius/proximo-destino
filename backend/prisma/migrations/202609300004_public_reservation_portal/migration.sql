ALTER TABLE "Client"
  ADD CONSTRAINT "Client_email_key" UNIQUE ("email");

ALTER TABLE "Reservation"
  ADD COLUMN "passengerCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "accessCodeHash" TEXT;

INSERT INTO "Trip" (
  "id", "title", "origin", "destination", "departureDate", "returnDate",
  "status", "priceCents", "summary", "imageUrl", "createdAt", "updatedAt"
) VALUES
  (
    'trip-bue-001',
    'Buenos Aires',
    'Fortaleza',
    'Buenos Aires',
    '2026-10-03T12:00:00.000Z',
    '2026-10-08T12:00:00.000Z',
    'ACTIVE',
    324000,
    'Cinco noites em Buenos Aires com condições sujeitas à confirmação da agência.',
    'https://images.unsplash.com/photo-1589909202802-8f4aadce1849?auto=format&fit=crop&w=1200&q=84',
    NOW(),
    NOW()
  ),
  (
    'trip-mcz-002',
    'Maceió',
    'Fortaleza',
    'Maceió',
    '2026-10-10T12:00:00.000Z',
    '2026-10-16T12:00:00.000Z',
    'SCHEDULED',
    268000,
    'Seis noites em Maceió com condições sujeitas à confirmação da agência.',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=84',
    NOW(),
    NOW()
  ),
  (
    'trip-gra-003',
    'Gramado',
    'Fortaleza',
    'Gramado',
    '2026-11-05T12:00:00.000Z',
    '2026-11-09T12:00:00.000Z',
    'SCHEDULED',
    358000,
    'Quatro noites em Gramado com condições sujeitas à confirmação da agência.',
    'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?auto=format&fit=crop&w=1200&q=84',
    NOW(),
    NOW()
  ),
  (
    'trip-rec-004',
    'Recife',
    'Fortaleza',
    'Recife',
    '2026-10-18T12:00:00.000Z',
    '2026-10-22T12:00:00.000Z',
    'ACTIVE',
    198000,
    'Quatro noites em Recife com condições sujeitas à confirmação da agência.',
    'https://images.unsplash.com/photo-1544989164-31dc3c645987?auto=format&fit=crop&w=1200&q=84',
    NOW(),
    NOW()
  ),
  (
    'trip-lis-005',
    'Lisboa',
    'Fortaleza',
    'Lisboa',
    '2026-12-02T12:00:00.000Z',
    '2026-12-10T12:00:00.000Z',
    'SCHEDULED',
    789000,
    'Oito noites em Lisboa com condições sujeitas à confirmação da agência.',
    'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=1200&q=84',
    NOW(),
    NOW()
  ),
  (
    'trip-rio-006',
    'Rio de Janeiro',
    'Juazeiro do Norte',
    'Rio de Janeiro',
    '2026-10-24T12:00:00.000Z',
    '2026-10-29T12:00:00.000Z',
    'ACTIVE',
    294000,
    'Cinco noites no Rio de Janeiro com condições sujeitas à confirmação da agência.',
    'https://images.unsplash.com/photo-1483729558449-99ef09a8c325?auto=format&fit=crop&w=1200&q=84',
    NOW(),
    NOW()
  )
ON CONFLICT ("id") DO NOTHING;
