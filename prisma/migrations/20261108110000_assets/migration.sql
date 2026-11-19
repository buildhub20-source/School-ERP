-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'LOST', 'DISPOSED');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "AssetEventType" AS ENUM ('CREATED', 'MOVED', 'REPAIR', 'VERIFIED', 'STATUS', 'DISPOSED');

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT,
    "assignedTo" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serialNo" TEXT,
    "supplierName" TEXT,
    "invoiceNo" TEXT,
    "purchaseDate" DATE,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "usefulLifeYears" INTEGER NOT NULL DEFAULT 5,
    "salvageValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "warrantyUntil" DATE,
    "warrantyAlertAt" TIMESTAMP(3),
    "condition" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_USE',
    "lastVerifiedAt" TIMESTAMP(3),
    "disposedOn" DATE,
    "disposalValue" DECIMAL(12,2),
    "disposalReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetEvent" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "AssetEventType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromLocation" TEXT,
    "toLocation" TEXT,
    "cost" DECIMAL(12,2),
    "notes" TEXT,
    "byName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asset_branchId_category_idx" ON "Asset"("branchId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_branchId_code_key" ON "Asset"("branchId", "code");

-- CreateIndex
CREATE INDEX "AssetEvent_assetId_date_idx" ON "AssetEvent"("assetId", "date");

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

