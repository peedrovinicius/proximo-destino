-- Additive foundation only. No legacy users or operational data are reassigned.
ALTER TYPE "UserRole" ADD VALUE 'CREATOR';
CREATE TYPE "CompanyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "CompanyMemberRole" AS ENUM ('ADMIN', 'AGENT', 'FINANCE');
CREATE TABLE "Company" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "tradeName" TEXT NOT NULL,
  "legalName" TEXT,
  "registrationNumber" TEXT,
  "contactEmail" TEXT NOT NULL,
  "contactPhone" TEXT,
  "address" TEXT,
  "responsibleName" TEXT NOT NULL,
  "responsibleEmail" TEXT NOT NULL,
  "status" "CompanyStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Company_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
CREATE INDEX "Company_status_createdAt_idx" ON "Company"("status", "createdAt");
CREATE TABLE "CompanyMembership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "CompanyMemberRole" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CompanyMembership_companyId_userId_key" ON "CompanyMembership"("companyId", "userId");
CREATE INDEX "CompanyMembership_userId_isActive_idx" ON "CompanyMembership"("userId", "isActive");
