-- Tax-exemption credit: earned by giving resources to the Koeki, spent on taxes.
ALTER TABLE "Resource" ADD COLUMN "exemptionPerUnit" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "ExemptionLedgerEntry" (
    "id" TEXT NOT NULL,
    "ninjaId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExemptionLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExemptionLedgerEntry_sourceType_sourceId_key" ON "ExemptionLedgerEntry"("sourceType", "sourceId");
CREATE INDEX "ExemptionLedgerEntry_ninjaId_createdAt_idx" ON "ExemptionLedgerEntry"("ninjaId", "createdAt");

ALTER TABLE "ExemptionLedgerEntry" ADD CONSTRAINT "ExemptionLedgerEntry_ninjaId_fkey" FOREIGN KEY ("ninjaId") REFERENCES "NinjaProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
