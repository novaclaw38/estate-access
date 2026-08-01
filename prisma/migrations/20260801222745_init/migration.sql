-- CreateEnum
CREATE TYPE "PassStatus" AS ENUM ('PENDING', 'ACTIVE', 'CHECKED_IN', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "GateAccessStatus" AS ENUM ('GRANTED', 'DENIED_INVALID_CODE', 'DENIED_EXPIRED', 'DENIED_NOT_YET_VALID', 'DENIED_REVOKED', 'DENIED_ALREADY_CHECKED_IN', 'DENIED_MANUAL_INCIDENT', 'EXIT_GRANTED', 'DENIED_NO_ACTIVE_ENTRY');

-- CreateTable
CREATE TABLE "Estate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Estate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "estateId" TEXT NOT NULL,
    "residentPhone" TEXT,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorPass" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "visitorPhone" TEXT NOT NULL,
    "accessCodeHash" TEXT NOT NULL,
    "status" "PassStatus" NOT NULL DEFAULT 'PENDING',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "isMultiEntry" BOOLEAN NOT NULL DEFAULT false,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "isInside" BOOLEAN NOT NULL DEFAULT false,
    "licensePlate" TEXT,
    "vehicleMake" TEXT,
    "vehicleColor" TEXT,
    "licenceDiscNo" TEXT,
    "discExpired" BOOLEAN,
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "checkedInGateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorPass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "estateId" TEXT NOT NULL,

    CONSTRAINT "Gate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateAccessLog" (
    "id" TEXT NOT NULL,
    "passId" TEXT,
    "gateId" TEXT NOT NULL,
    "accessCodeHash" TEXT,
    "reason" TEXT,
    "licensePlate" TEXT,
    "licenceDiscNo" TEXT,
    "vehicleMake" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isOfflineSync" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "status" "GateAccessStatus" NOT NULL,

    CONSTRAINT "GateAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Estate_code_key" ON "Estate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_residentPhone_key" ON "Unit"("residentPhone");

-- CreateIndex
CREATE INDEX "Unit_estateId_idx" ON "Unit"("estateId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorPass_accessCodeHash_key" ON "VisitorPass"("accessCodeHash");

-- CreateIndex
CREATE INDEX "VisitorPass_unitId_idx" ON "VisitorPass"("unitId");

-- CreateIndex
CREATE INDEX "VisitorPass_status_idx" ON "VisitorPass"("status");

-- CreateIndex
CREATE INDEX "VisitorPass_validTo_idx" ON "VisitorPass"("validTo");

-- CreateIndex
CREATE INDEX "VisitorPass_licensePlate_isInside_idx" ON "VisitorPass"("licensePlate", "isInside");

-- CreateIndex
CREATE INDEX "Gate_estateId_idx" ON "Gate"("estateId");

-- CreateIndex
CREATE UNIQUE INDEX "GateAccessLog_idempotencyKey_key" ON "GateAccessLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GateAccessLog_gateId_idx" ON "GateAccessLog"("gateId");

-- CreateIndex
CREATE INDEX "GateAccessLog_passId_idx" ON "GateAccessLog"("passId");

-- CreateIndex
CREATE INDEX "GateAccessLog_scannedAt_idx" ON "GateAccessLog"("scannedAt");

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_estateId_fkey" FOREIGN KEY ("estateId") REFERENCES "Estate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorPass" ADD CONSTRAINT "VisitorPass_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorPass" ADD CONSTRAINT "VisitorPass_checkedInGateId_fkey" FOREIGN KEY ("checkedInGateId") REFERENCES "Gate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gate" ADD CONSTRAINT "Gate_estateId_fkey" FOREIGN KEY ("estateId") REFERENCES "Estate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateAccessLog" ADD CONSTRAINT "GateAccessLog_passId_fkey" FOREIGN KEY ("passId") REFERENCES "VisitorPass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateAccessLog" ADD CONSTRAINT "GateAccessLog_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "Gate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
