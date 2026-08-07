-- Jonin+ loadout tracking: one row per ninja, slots stored as JSON.
CREATE TABLE "NinjaEquipment" (
    "id" TEXT NOT NULL,
    "ninjaId" TEXT NOT NULL,
    "slots" JSONB NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NinjaEquipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NinjaEquipment_ninjaId_key" ON "NinjaEquipment"("ninjaId");

ALTER TABLE "NinjaEquipment" ADD CONSTRAINT "NinjaEquipment_ninjaId_fkey" FOREIGN KEY ("ninjaId") REFERENCES "NinjaProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
