// Shared between the server page and the client editor — must NOT live in a "use client"
// module: server components importing values from one get opaque client references.
export const EQUIPMENT_SLOTS = [
  ["haut", "Haut"], ["bas", "Bas"], ["bottes", "Bottes"], ["boucles", "Boucles"], ["bague", "Bague"], ["collier", "Collier"], ["gants", "Gants"]
] as const;
