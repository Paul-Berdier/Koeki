// Fictional inventory data for DEMO_MODE (no database, writes disabled). Mirrors the
// initial catalog so the visual audit and the end-to-end tests see realistic rows.
import type { InventoryBoardData, InventoryRow, JournalData, MovementRow, NinjaInventoryHistory, ResourceDetailData, StocktakeCandidate, StocktakeDetail, StocktakeSummary, UnitInfo } from "./inventory-types";

const unite: UnitInfo = { code: "UNIT", label: "unité", decimals: 0 };
const kg: UnitInfo = { code: "KG", label: "kg", decimals: 3 };
const ryo: UnitInfo = { code: "RYO", label: "Ryō", decimals: 0 };

const base = { description: null, hasMovements: true, inventoryStatus: "COUNTED" as const, minimumStock: 0, criticalStock: 0, lastCountedAt: "2026-09-02T08:00:00.000Z", lastCountedLabel: "il y a 3 j", updatedAt: "2026-09-02T08:00:00.000Z", updatedLabel: "il y a 3 j", isActive: true, isTreasury: false };

export const demoInventoryRows: InventoryRow[] = [
  { ...base, id: "res-plan-t1", code: "RES-PLAN-T1", name: "Plan T1", categoryCode: "PLANS", categoryLabel: "Plans", unit: unite, quantity: 120, state: "NORMAL", stateLabel: "Normal", in30: 30, out30: 10, lastMovementAt: "2026-09-05T10:20:00.000Z", lastMovementLabel: "il y a 2 h", lastMovementSummary: "+30 unité · Don · Hiro Tanaka · Sora Kaze", lastAgent: "Sora Kaze", aliases: ["T1"], minimumStock: 40, criticalStock: 15 },
  { ...base, id: "res-plan-t2", code: "RES-PLAN-T2", name: "Plan T2", categoryCode: "PLANS", categoryLabel: "Plans", unit: unite, quantity: 42, state: "LOW", stateLabel: "Faible", in30: 5, out30: 8, lastMovementAt: "2026-09-04T09:00:00.000Z", lastMovementLabel: "hier", lastMovementSummary: "−8 unité · Sortie · Aoki Hoki · Yuki Sabaku", lastAgent: "Yuki Sabaku", aliases: ["T2"], minimumStock: 50, criticalStock: 20 },
  { ...base, id: "res-plan-t3", code: "RES-PLAN-T3", name: "Plan T3", categoryCode: "PLANS", categoryLabel: "Plans", unit: unite, quantity: 12, state: "CRITICAL", stateLabel: "Critique", in30: 0, out30: 3, lastMovementAt: "2026-08-30T15:00:00.000Z", lastMovementLabel: "il y a 6 j", lastMovementSummary: "−3 unité · Sortie · Izen Hoki · Yuki Sabaku", lastAgent: "Yuki Sabaku", aliases: ["T3"], minimumStock: 30, criticalStock: 15 },
  { ...base, id: "res-plan-t4", code: "RES-PLAN-T4", name: "Plan T4", categoryCode: "PLANS", categoryLabel: "Plans", unit: unite, quantity: 0, state: "OUT_OF_STOCK", stateLabel: "Rupture", in30: 0, out30: 2, lastMovementAt: "2026-08-28T11:00:00.000Z", lastMovementLabel: "il y a 8 j", lastMovementSummary: "−2 unité · Sortie · Kagami Hoki · Sora Kaze", lastAgent: "Sora Kaze", aliases: ["T4"], minimumStock: 5, criticalStock: 2 },
  { ...base, id: "res-chakra", code: "RES-CHAKRA-PART", name: "Pièces Chakra", categoryCode: "CHAKRA", categoryLabel: "Chakra", unit: unite, quantity: 850, state: "NORMAL", stateLabel: "Normal", in30: 120, out30: 50, lastMovementAt: "2026-09-05T11:50:00.000Z", lastMovementLabel: "il y a 30 min", lastMovementSummary: "+50 unité · Don · Hiro Tanaka · Yuki Sabaku", lastAgent: "Yuki Sabaku", aliases: ["Chakra Métal", "Chakra"] },
  { ...base, id: "res-titanium", code: "RES-TITANIUM", name: "Titane", categoryCode: "METALS", categoryLabel: "Métaux", unit: kg, quantity: 180, state: "NORMAL", stateLabel: "Normal", in30: 30, out30: 12, lastMovementAt: "2026-09-05T08:10:00.000Z", lastMovementLabel: "il y a 4 h", lastMovementSummary: "+30 kg · Rachat · Tao Hoki · Sora Kaze", lastAgent: "Sora Kaze", aliases: ["Titanium"], minimumStock: 60, criticalStock: 25 },
  { ...base, id: "res-iron", code: "RES-IRON", name: "Fer", categoryCode: "METALS", categoryLabel: "Métaux", unit: kg, quantity: 495, state: "NORMAL", stateLabel: "Normal", in30: 220, out30: 145, lastMovementAt: "2026-09-05T12:32:00.000Z", lastMovementLabel: "il y a 5 min", lastMovementSummary: "−25 kg · Sortie · Aoki Hoki · Yuki Sabaku", lastAgent: "Yuki Sabaku", aliases: ["Iron"], minimumStock: 100, criticalStock: 20 },
  { ...base, id: "res-copper", code: "RES-COPPER", name: "Cuivre", categoryCode: "METALS", categoryLabel: "Métaux", unit: kg, quantity: 190, state: "NORMAL", stateLabel: "Normal", in30: 40, out30: 15, lastMovementAt: "2026-09-03T16:00:00.000Z", lastMovementLabel: "il y a 2 j", lastMovementSummary: "+40 kg · Rachat · Araki Hoki · Sora Kaze", lastAgent: "Sora Kaze", aliases: ["Copper"], minimumStock: 50, criticalStock: 20 },
  { ...base, id: "res-jade", code: "RES-JADE", name: "Jade", categoryCode: "MATERIALS", categoryLabel: "Matériaux", unit: unite, quantity: 25, state: "NORMAL", stateLabel: "Normal", in30: 5, out30: 0, lastMovementAt: "2026-09-01T10:00:00.000Z", lastMovementLabel: "il y a 4 j", lastMovementSummary: "+5 unité · Don · Inao Hoki · Sora Kaze", lastAgent: "Sora Kaze", aliases: [] },
  { ...base, id: "res-plastic", code: "RES-PLASTIC", name: "Plastique", categoryCode: "MATERIALS", categoryLabel: "Matériaux", unit: unite, quantity: 210, state: "NORMAL", stateLabel: "Normal", in30: 0, out30: 20, lastMovementAt: "2026-08-29T14:00:00.000Z", lastMovementLabel: "il y a 7 j", lastMovementSummary: "−20 unité · Consommation atelier · Yuki Sabaku", lastAgent: "Yuki Sabaku", aliases: ["Plastic"] },
  { ...base, id: "res-wood", code: "RES-WOOD", name: "Bois", categoryCode: "MATERIALS", categoryLabel: "Matériaux", unit: unite, quantity: 350, state: "NORMAL", stateLabel: "Normal", in30: 20, out30: 10, lastMovementAt: "2026-09-04T18:20:00.000Z", lastMovementLabel: "hier", lastMovementSummary: "−10 unité · Ajustement (−) · Responsable", lastAgent: "Sonemi Hakumei", aliases: ["Wood"] },
  { ...base, id: "res-wool", code: "RES-WOOL", name: "Laine", categoryCode: "TEXTILES", categoryLabel: "Textiles", unit: unite, quantity: 0, hasMovements: false, inventoryStatus: "NOT_INVENTORIED", state: "NOT_INVENTORIED", stateLabel: "Non inventorié", in30: 0, out30: 0, lastMovementAt: null, lastMovementLabel: "—", lastMovementSummary: null, lastAgent: null, lastCountedAt: null, lastCountedLabel: "Jamais", aliases: ["Wool"] },
  { ...base, id: "res-lavender", code: "RES-LAV-01", name: "Lavande", categoryCode: "OTHER", categoryLabel: "Autre", unit: unite, quantity: 0, hasMovements: false, inventoryStatus: "NOT_INVENTORIED", state: "NOT_INVENTORIED", stateLabel: "Non inventorié", in30: 0, out30: 0, lastMovementAt: null, lastMovementLabel: "—", lastMovementSummary: null, lastAgent: null, lastCountedAt: null, lastCountedLabel: "Jamais", aliases: [] },
  { ...base, id: "res-ryo", code: "RES-RYO", name: "Ryōs", categoryCode: "TREASURY", categoryLabel: "Trésorerie", unit: ryo, quantity: 250000, state: "NORMAL", stateLabel: "Normal", in30: 45000, out30: 12000, lastMovementAt: "2026-09-05T09:00:00.000Z", lastMovementLabel: "il y a 3 h", lastMovementSummary: "−12 000 Ryō · Sortie · Tao Hoki · Sora Kaze", lastAgent: "Sora Kaze", aliases: ["Ryo"], isTreasury: true }
];

export const demoInventoryBoard: InventoryBoardData = {
  rows: demoInventoryRows,
  categories: [{ code: "PLANS", label: "Plans" }, { code: "CHAKRA", label: "Chakra" }, { code: "METALS", label: "Métaux" }, { code: "MATERIALS", label: "Matériaux" }, { code: "TEXTILES", label: "Textiles" }, { code: "TREASURY", label: "Trésorerie" }, { code: "OTHER", label: "Autre" }],
  units: [unite, { code: "PIECE", label: "pièce", decimals: 0 }, kg, ryo],
  stats: { total: 14, active: 14, notInventoried: 2, low: 1, critical: 1, outOfStock: 1, movementsToday: 5, inToday: 3, outToday: 2 },
  ninjas: [{ id: "demo-41", name: "Aoki Hoki", code: "NIN-000041" }, { id: "demo-58", name: "Araki Hoki", code: "NIN-000058" }, { id: "demo-63", name: "Inao Hoki", code: "NIN-000063" }, { id: "demo-94", name: "Tao Hoki", code: "NIN-000094" }],
  mismatches: 0, openStocktakes: 0
};

const movementBase = { unit: kg, before: 520, after: 495, notes: null, sourceType: null, sourceId: null, sourceLabel: "Saisie manuelle", reversedMovementId: null, reversalId: null, canReverse: false, counterpartyNinjaId: "demo-41" };
export const demoMovements: MovementRow[] = [
  { ...movementBase, id: "mov-1", at: "2026-09-05T12:32:00.000Z", atLabel: "05/09/2026 14:32", resourceId: "res-iron", resourceName: "Fer", resourceCode: "RES-IRON", type: "OUT", typeLabel: "Sortie", quantity: -25, counterpartyLabel: "Aoki Hoki", counterpartyRole: "Pris par", agent: "Yuki Sabaku", agentId: "u-yuki", reason: "Fabrication" },
  { ...movementBase, id: "mov-2", at: "2026-09-05T08:14:00.000Z", atLabel: "05/09/2026 10:14", resourceId: "res-iron", resourceName: "Fer", resourceCode: "RES-IRON", type: "DONATION_IN", typeLabel: "Don", quantity: 50, before: 470, after: 520, counterpartyLabel: "Hiro Tanaka", counterpartyNinjaId: null, counterpartyRole: "Donné par", agent: "Sora Kaze", agentId: "u-sora", reason: "Don DON-2026-000412", sourceType: "ResourceTransaction", sourceId: "tx-1", sourceLabel: "Reçu DON-2026-000412" },
  { ...movementBase, id: "mov-3", at: "2026-09-04T16:20:00.000Z", atLabel: "04/09/2026 18:20", resourceId: "res-iron", resourceName: "Fer", resourceCode: "RES-IRON", type: "ADJUSTMENT_OUT", typeLabel: "Ajustement (−)", quantity: -10, before: 480, after: 470, counterpartyLabel: null, counterpartyNinjaId: null, counterpartyRole: "Pris par", agent: "Sonemi Hakumei", agentId: "u-sonemi", reason: "Comptage physique — écart constaté", sourceType: "StocktakeSession", sourceId: "st-1", sourceLabel: "Comptage" },
  { ...movementBase, id: "mov-4", at: "2026-09-02T08:00:00.000Z", atLabel: "02/09/2026 10:00", resourceId: "res-iron", resourceName: "Fer", resourceCode: "RES-IRON", type: "INITIAL_BALANCE", typeLabel: "Inventaire initial", quantity: 480, before: 0, after: 480, counterpartyLabel: null, counterpartyNinjaId: null, counterpartyRole: "Donné par", agent: "Sonemi Hakumei", agentId: "u-sonemi", reason: "Inventaire initial", sourceType: "StocktakeSession", sourceId: "st-0", sourceLabel: "Comptage" },
  { ...movementBase, id: "mov-5", at: "2026-09-05T11:50:00.000Z", atLabel: "05/09/2026 13:50", resourceId: "res-chakra", resourceName: "Pièces Chakra", resourceCode: "RES-CHAKRA-PART", unit: unite, type: "DONATION_IN", typeLabel: "Don", quantity: 50, before: 800, after: 850, counterpartyLabel: "Hiro Tanaka", counterpartyNinjaId: null, counterpartyRole: "Donné par", agent: "Yuki Sabaku", agentId: "u-yuki", reason: "Don au service économique" }
];

export const demoJournal: JournalData = {
  rows: demoMovements, total: demoMovements.length, page: 1, pageCount: 1,
  resources: demoInventoryRows.map((row) => ({ id: row.id, name: row.name, code: row.code })),
  categories: demoInventoryBoard.categories,
  agents: [{ id: "u-yuki", name: "Yuki Sabaku" }, { id: "u-sora", name: "Sora Kaze" }, { id: "u-sonemi", name: "Sonemi Hakumei" }],
  ninjas: demoInventoryBoard.ninjas,
  types: [{ code: "IN", label: "Entrée" }, { code: "OUT", label: "Sortie" }, { code: "DONATION_IN", label: "Don" }, { code: "BUYBACK_IN", label: "Rachat" }, { code: "ADJUSTMENT_OUT", label: "Ajustement (−)" }, { code: "INITIAL_BALANCE", label: "Inventaire initial" }],
  sources: [{ code: "MANUAL", label: "Saisie manuelle" }, { code: "ResourceTransaction", label: "Don / rachat" }, { code: "StocktakeSession", label: "Comptage" }]
};

export function demoResourceDetail(id: string): ResourceDetailData | null {
  const resource = demoInventoryRows.find((row) => row.id === id);
  if (!resource) return null;
  const movements = demoMovements.filter((movement) => movement.resourceId === id);
  return {
    resource, metrics: { inMonth: resource.in30, outMonth: resource.out30, movementsCount: movements.length, lastCountLabel: "02/09/2026 10:00" },
    movements, total: movements.length, page: 1, pageCount: 1,
    stocktakes: [{ id: "st-1", atLabel: "04/09/2026 18:20", kindLabel: "Comptage", expected: 480, counted: 470, difference: -10, agent: "Sonemi Hakumei", status: "COMPLETED" }]
  };
}

export const demoStocktakes: StocktakeSummary[] = [
  { id: "st-1", kind: "COUNT", kindLabel: "Comptage", status: "COMPLETED", statusLabel: "Clôturé", startedAt: "2026-09-04T16:00:00.000Z", startedLabel: "04/09/2026 18:00", completedLabel: "04/09/2026 18:20", startedBy: "Sonemi Hakumei", entries: 12, differences: 3, notes: "Inventaire hebdomadaire" },
  { id: "st-0", kind: "INITIAL", kindLabel: "Inventaire initial", status: "COMPLETED", statusLabel: "Clôturé", startedAt: "2026-09-02T08:00:00.000Z", startedLabel: "02/09/2026 10:00", completedLabel: "02/09/2026 10:05", startedBy: "Sonemi Hakumei", entries: 12, differences: 12, notes: null }
];

export function demoStocktakeDetail(id: string): StocktakeDetail | null {
  const summary = demoStocktakes.find((session) => session.id === id);
  if (!summary) return null;
  return { ...summary, lines: [
    { resourceId: "res-iron", code: "RES-IRON", name: "Fer", unit: kg, categoryLabel: "Métaux", expected: 480, counted: 470, difference: -10, inventoryStatus: "COUNTED", movementType: "ADJUSTMENT_OUT", movementLabel: "Ajustement (−)", movementId: "mov-3" },
    { resourceId: "res-copper", code: "RES-COPPER", name: "Cuivre", unit: kg, categoryLabel: "Métaux", expected: 185, counted: 190, difference: 5, inventoryStatus: "COUNTED", movementType: "ADJUSTMENT_IN", movementLabel: "Ajustement (+)", movementId: "mov-9" },
    { resourceId: "res-plan-t2", code: "RES-PLAN-T2", name: "Plan T2", unit: unite, categoryLabel: "Plans", expected: 44, counted: 42, difference: -2, inventoryStatus: "COUNTED", movementType: "ADJUSTMENT_OUT", movementLabel: "Ajustement (−)", movementId: "mov-10" },
    { resourceId: "res-wood", code: "RES-WOOD", name: "Bois", unit: unite, categoryLabel: "Matériaux", expected: 350, counted: 350, difference: 0, inventoryStatus: "COUNTED", movementType: null, movementLabel: null, movementId: null }
  ] };
}

export function demoStocktakeCandidates(mode: "initial" | "count"): StocktakeCandidate[] {
  return demoInventoryRows.filter((row) => mode === "count" || row.inventoryStatus === "NOT_INVENTORIED").map((row) => ({ id: row.id, code: row.code, name: row.name, categoryCode: row.categoryCode, categoryLabel: row.categoryLabel, unit: row.unit, quantity: row.quantity, hasMovements: row.hasMovements, inventoryStatus: row.inventoryStatus, aliases: row.aliases }));
}

export const demoNinjaInventory: NinjaInventoryHistory = {
  rows: [
    { id: "n1", atLabel: "05/09/2026 14:32", typeLabel: "Sortie", direction: "out", resourceName: "Fer", resourceId: "res-iron", quantityLabel: "−25 kg", agent: "Yuki Sabaku", reason: "Fabrication" },
    { id: "n2", atLabel: "03/09/2026 11:10", typeLabel: "Rachat", direction: "in", resourceName: "Cuivre", resourceId: "res-copper", quantityLabel: "+20 kg", agent: "Sora Kaze", reason: "Rachat BUY-2026-000067" },
    { id: "n3", atLabel: "02/09/2026 09:40", typeLabel: "Don", direction: "in", resourceName: "Pièces Chakra", resourceId: "res-chakra", quantityLabel: "+50 unité", agent: "Sora Kaze", reason: "Don DON-2026-000401" }
  ],
  totals: { donations: 1, buybacks: 1, taken: 1, returned: 0 }
};
