-- Existing company codes fail closed until reissued; legacy access is unchanged.
ALTER TABLE "Reservation" ADD COLUMN "companyPortalCodeExpiresAt" TIMESTAMP(3);
