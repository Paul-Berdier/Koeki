// Shared between the server page and the client editor — must NOT live in a "use client"
// module: server components importing values from one get opaque client references.
export const EQUIPMENT_SLOTS = [
  ["haut", "Haut"], ["bas", "Bas"], ["bottes", "Bottes"], ["boucles", "Boucles"], ["bague", "Bague"], ["collier", "Collier"], ["gants", "Gants"]
] as const;

export interface EquipmentSlotValue {
  tier?: string | null;
  type?: string | null;
}

export interface EquipmentRow {
  id: string;
  code: string;
  name: string;
  grade: string;
  slots: Record<string, EquipmentSlotValue>;
}

const loadout = (...values: Array<[string, string] | null>): EquipmentRow["slots"] =>
  Object.fromEntries(EQUIPMENT_SLOTS.map(([slot], index) => {
    const value = values[index];
    return [slot, value ? { tier: value[0], type: value[1] } : { tier: "Aucun", type: null }];
  }));

export const DEMO_EQUIPMENT_ROWS: EquipmentRow[] = [
  { id: "demo-eq-1", code: "NIN-000041", name: "Kenma Hakumei", grade: "Kage", slots: loadout(["T4", "Armure"], ["T4", "Armure"], ["T4", "Ténacité"], ["T4", "Jutsu"], ["T4", "Jutsu"], ["T4", "Armure"], ["T4", "Ténacité"]) },
  { id: "demo-eq-2", code: "NIN-000058", name: "Seiren Chikatsume", grade: "Commandant Jōnin", slots: loadout(["T4", "Jutsu"], ["T4", "Armure"], ["T4", "Ténacité"], ["T4", "Armure"], ["T3", "Jutsu"], ["T4", "Jutsu"], null) },
  { id: "demo-eq-3", code: "NIN-000063", name: "Araki Hoki", grade: "Jōnin", slots: loadout(["T3", "Jutsu"], ["T3", "Armure"], ["T3", "Armure"], null, null, null, null) },
  { id: "demo-eq-4", code: "NIN-000072", name: "Aoki Hoki", grade: "Jōnin", slots: loadout(null, null, null, null, null, null, null) },
  { id: "demo-eq-5", code: "NIN-000094", name: "Mina Sabaku", grade: "Jōnin", slots: loadout(["T3", "Armure"], ["T4", "Armure"], ["T3", "Jutsu"], null, ["T3", "Ténacité"], ["T2", "Armure"], null) },
  { id: "demo-eq-6", code: "NIN-000109", name: "Toshiro Makaze", grade: "Jōnin", slots: loadout(["T3", "Armure"], ["T3", "Jutsu"], ["T3", "Ténacité"], ["T3", "Jutsu"], ["T3", "Armure"], ["T3", "Jutsu"], ["T3", "Armure"]) }
];
