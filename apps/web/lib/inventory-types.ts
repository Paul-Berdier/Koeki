import type { InventoryStatusCode, StockState } from "@koeki/domain/inventory";

export interface UnitInfo { code: string; label: string; decimals: number }
export interface NinjaOption { id: string; name: string; code: string }

export interface InventoryRow {
  id: string; code: string; name: string; description: string | null;
  categoryCode: string; categoryLabel: string; unit: UnitInfo;
  /** Ledger quantity (sum of movements). `hasMovements` tells "—" apart from a real zero. */
  quantity: number; hasMovements: boolean;
  inventoryStatus: InventoryStatusCode; state: StockState; stateLabel: string;
  minimumStock: number; criticalStock: number;
  /** Entries and exits over the last 30 days. */
  in30: number; out30: number;
  lastMovementAt: string | null; lastMovementLabel: string; lastMovementSummary: string | null; lastAgent: string | null;
  lastCountedAt: string | null; lastCountedLabel: string;
  updatedAt: string; updatedLabel: string;
  aliases: string[]; isActive: boolean; isTreasury: boolean;
}

export interface InventoryStats { total: number; active: number; notInventoried: number; low: number; critical: number; outOfStock: number; movementsToday: number; inToday: number; outToday: number }

export interface InventoryBoardData {
  rows: InventoryRow[];
  categories: Array<{ code: string; label: string }>;
  units: UnitInfo[];
  stats: InventoryStats;
  ninjas: NinjaOption[];
  /** Ledger/cache mismatches (managers only, 0 otherwise). */
  mismatches: number;
  openStocktakes: number;
}

export interface MovementRow {
  id: string; at: string; atLabel: string;
  resourceId: string; resourceName: string; resourceCode: string; unit: UnitInfo;
  type: string; typeLabel: string; quantity: number; before: number | null; after: number | null;
  counterpartyLabel: string | null; counterpartyNinjaId: string | null; counterpartyRole: string;
  agent: string; agentId: string; reason: string; notes: string | null;
  sourceType: string | null; sourceId: string | null; sourceLabel: string;
  reversedMovementId: string | null; reversalId: string | null; canReverse: boolean;
}

export interface JournalFilters {
  q?: string | undefined; ressource?: string | undefined; categorie?: string | undefined; type?: string | undefined; sens?: string | undefined;
  agent?: string | undefined; ninja?: string | undefined; du?: string | undefined; au?: string | undefined; motif?: string | undefined; origine?: string | undefined; page?: number | undefined;
}

export interface JournalData {
  rows: MovementRow[]; total: number; page: number; pageCount: number;
  resources: Array<{ id: string; name: string; code: string }>;
  categories: Array<{ code: string; label: string }>;
  agents: Array<{ id: string; name: string }>;
  ninjas: NinjaOption[];
  types: Array<{ code: string; label: string }>;
  sources: Array<{ code: string; label: string }>;
}

export interface ResourceDetailData {
  resource: InventoryRow;
  metrics: { inMonth: number; outMonth: number; movementsCount: number; lastCountLabel: string };
  movements: MovementRow[]; total: number; page: number; pageCount: number;
  stocktakes: Array<{ id: string; atLabel: string; kindLabel: string; expected: number; counted: number; difference: number; agent: string; status: string }>;
}

export interface StocktakeSummary {
  id: string; kind: "INITIAL" | "COUNT"; kindLabel: string; status: "OPEN" | "COMPLETED" | "CANCELLED"; statusLabel: string;
  startedAt: string; startedLabel: string; completedLabel: string | null; startedBy: string; entries: number; differences: number; notes: string | null;
}

export interface StocktakeLine {
  resourceId: string; code: string; name: string; unit: UnitInfo; categoryLabel: string;
  expected: number; counted: number; difference: number; inventoryStatus: InventoryStatusCode;
  movementType: string | null; movementLabel: string | null; movementId: string | null;
}

export interface StocktakeDetail extends StocktakeSummary { lines: StocktakeLine[] }

export interface StocktakeCandidate { id: string; code: string; name: string; categoryCode: string; categoryLabel: string; unit: UnitInfo; quantity: number; hasMovements: boolean; inventoryStatus: InventoryStatusCode; aliases: string[] }

export interface NinjaInventoryHistory {
  rows: Array<{ id: string; atLabel: string; typeLabel: string; direction: "in" | "out" | "none"; resourceName: string; resourceId: string; quantityLabel: string; agent: string; reason: string }>;
  totals: { donations: number; buybacks: number; taken: number; returned: number };
}

export interface InventoryAgentActivity { id: string; name: string; movements: number; entries: number; exits: number; counts: number; adjustments: number; corrections: number; reversed: number }

/** Result of a form-state server action (movement drawer, corrections). */
export type ActionState = { ok: true; message: string } | { ok: false; error: string } | null;
