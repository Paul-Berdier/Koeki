// Pure inventory rules shared by the web app, the worker and the seeds. No Prisma, no React:
// quantities are plain numbers with at most four decimals (the database stores Decimal(20,4)).

export const INVENTORY_MOVEMENT_TYPES = [
  "INITIAL_BALANCE", "IN", "OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DONATION_IN", "BUYBACK_IN",
  "CRAFT_CONSUMPTION", "CRAFT_OUTPUT", "TRANSFER_IN", "TRANSFER_OUT", "LOSS", "RETURN_IN", "REVERSAL",
  "MANUAL_ADJUSTMENT", "OTHER"
] as const;
export type InventoryMovementTypeCode = typeof INVENTORY_MOVEMENT_TYPES[number];

export const movementTypeLabels: Record<InventoryMovementTypeCode, string> = {
  INITIAL_BALANCE: "Inventaire initial", IN: "Entrée", OUT: "Sortie", ADJUSTMENT_IN: "Ajustement (+)", ADJUSTMENT_OUT: "Ajustement (−)",
  DONATION_IN: "Don", BUYBACK_IN: "Rachat", CRAFT_CONSUMPTION: "Consommation atelier", CRAFT_OUTPUT: "Production atelier",
  TRANSFER_IN: "Transfert entrant", TRANSFER_OUT: "Transfert sortant", LOSS: "Perte", RETURN_IN: "Retour", REVERSAL: "Correction",
  MANUAL_ADJUSTMENT: "Ajustement", OTHER: "Autre"
};

/** Types an agent may pick by hand; system types (dons, rachats, atelier, corrections) are set by their flow. */
export const MANUAL_IN_TYPES: InventoryMovementTypeCode[] = ["IN", "RETURN_IN", "TRANSFER_IN"];
export const MANUAL_OUT_TYPES: InventoryMovementTypeCode[] = ["OUT", "TRANSFER_OUT", "LOSS"];

/** Suggested reasons. Free text stays possible through "Autre". */
export const INVENTORY_IN_REASONS = ["Don", "Achat", "Retour", "Transfert", "Production", "Correction", "Autre"] as const;
export const INVENTORY_OUT_REASONS = ["Fabrication", "Mission", "Distribution", "Transfert", "Perte", "Usage interne", "Vente", "Autre"] as const;

export type MovementDirection = "in" | "out" | "none";
export const directionOfQuantity = (quantity: number): MovementDirection => (quantity > 0 ? "in" : quantity < 0 ? "out" : "none");

/** Who the counterparty is for a line: an entry is given by someone, an exit is taken by someone. */
export const counterpartyRoleLabel = (quantity: number): string => (quantity < 0 ? "Pris par" : "Donné par");

export const INVENTORY_STATUSES = ["NOT_INVENTORIED", "COUNTED"] as const;
export type InventoryStatusCode = typeof INVENTORY_STATUSES[number];
export const inventoryStatusLabels: Record<InventoryStatusCode, string> = { NOT_INVENTORIED: "Non inventorié", COUNTED: "Inventorié" };

export type StockState = "NOT_INVENTORIED" | "OUT_OF_STOCK" | "CRITICAL" | "LOW" | "NORMAL";
export const stockStateLabels: Record<StockState, string> = { NOT_INVENTORIED: "Non inventorié", OUT_OF_STOCK: "Rupture", CRITICAL: "Critique", LOW: "Faible", NORMAL: "Normal" };
/** Visual tone per state — never the only carrier of the information (label + icon always shown). */
export const stockStateTone: Record<StockState, "neutral" | "good" | "warn" | "danger"> = { NOT_INVENTORIED: "neutral", OUT_OF_STOCK: "danger", CRITICAL: "danger", LOW: "warn", NORMAL: "good" };

/** Threshold rule (single definition — the worker, the board and the catalog all use it):
 *  a zero threshold means "not configured" and never triggers. A resource never counted is
 *  NOT_INVENTORIED whatever its ledger says. Rupture only applies to counted resources. */
export function deriveStockState(input: { inventoryStatus: InventoryStatusCode; quantity: number; minimumStock: number; criticalStock: number }): StockState {
  if (input.inventoryStatus === "NOT_INVENTORIED") return "NOT_INVENTORIED";
  if (input.quantity <= 0) return "OUT_OF_STOCK";
  if (input.criticalStock > 0 && input.quantity <= input.criticalStock) return "CRITICAL";
  if (input.minimumStock > 0 && input.quantity <= input.minimumStock) return "LOW";
  return "NORMAL";
}

export const QUANTITY_SCALE = 4;
const SCALE_FACTOR = 10 ** QUANTITY_SCALE;
export const MAX_QUANTITY = 1_000_000_000;

/** Exact-ish helpers: every arithmetic on quantities goes through integer ten-thousandths. */
export const toScaled = (value: number): number => Math.round(value * SCALE_FACTOR);
export const fromScaled = (scaled: number): number => scaled / SCALE_FACTOR;
export const addQuantities = (a: number, b: number): number => fromScaled(toScaled(a) + toScaled(b));
export const subtractQuantities = (a: number, b: number): number => fromScaled(toScaled(a) - toScaled(b));

export type QuantityParse = { ok: true; value: number } | { ok: false; error: string };

/** Parses a user-entered quantity (comma or dot accepted) against the unit precision.
 *  Returns a non-negative number; the caller decides the sign. */
export function parseQuantityInput(raw: string, decimals: number, unitLabel = "unité"): QuantityParse {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return { ok: false, error: "Indiquez une quantité" };
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return { ok: false, error: "Quantité invalide — chiffres uniquement" };
  const allowed = Math.max(0, Math.min(QUANTITY_SCALE, decimals));
  const fraction = normalized.split(".")[1] ?? "";
  if (fraction.length > allowed) {
    return { ok: false, error: allowed === 0 ? `Cette ressource se compte en ${unitLabel}s entières` : `${allowed} décimale${allowed > 1 ? "s" : ""} maximum pour cette unité` };
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value > MAX_QUANTITY) return { ok: false, error: `Quantité trop grande (maximum ${MAX_QUANTITY.toLocaleString("fr-FR")})` };
  return { ok: true, value: fromScaled(toScaled(value)) };
}

export function formatQuantity(value: number, decimals = 0): string {
  const allowed = Math.max(0, Math.min(QUANTITY_SCALE, decimals));
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: allowed }).format(value);
}

export function formatQuantityWithUnit(value: number, unit: { label: string; decimals: number }): string {
  return `${formatQuantity(value, unit.decimals)} ${unit.label}`;
}

/** "+25 kg" / "−25 kg" — the typographic minus reads better than a hyphen in tables. */
export function formatSignedQuantity(value: number, unit: { label: string; decimals: number }): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatQuantityWithUnit(Math.abs(value), unit)}`;
}

export type StocktakeMovementType = "INITIAL_BALANCE" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";
export interface StocktakePlanInput { resourceId: string; inventoryStatus: InventoryStatusCode; expected: number; counted: number }
export interface StocktakePlanLine extends StocktakePlanInput { difference: number; movementType: StocktakeMovementType | null }

/** Turns counted quantities into the movements a count must produce. A first count always
 *  writes an INITIAL_BALANCE (even at zero: "we checked, there is none"); later counts only
 *  write a signed adjustment when the counted stock differs from the ledger. */
export function planStocktake(entries: StocktakePlanInput[]): StocktakePlanLine[] {
  return entries.map((entry) => {
    const difference = subtractQuantities(entry.counted, entry.expected);
    const movementType: StocktakeMovementType | null = entry.inventoryStatus === "NOT_INVENTORIED" ? "INITIAL_BALANCE"
      : difference > 0 ? "ADJUSTMENT_IN" : difference < 0 ? "ADJUSTMENT_OUT" : null;
    return { ...entry, difference, movementType };
  });
}

/** Refuses to take more than the ledger holds unless an explicit override is granted. */
export function checkAvailability(input: { current: number; delta: number; allowNegative: boolean }): { ok: true; next: number } | { ok: false; next: number; available: number; requested: number } {
  const next = addQuantities(input.current, input.delta);
  if (next < 0 && !input.allowNegative) return { ok: false, next, available: Math.max(0, input.current), requested: Math.abs(input.delta) };
  return { ok: true, next };
}

/** CSV for French spreadsheets: UTF-8 BOM, semicolon separator, RFC 4180 quoting. */
export const CSV_SEPARATOR = ";";
/** Free text that a spreadsheet would evaluate as a formula (=, +, -, @, tab, CR) is neutralised
 *  with a leading apostrophe; numbers are passed as numbers and keep their sign. */
export function csvEscape(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const text = typeof value === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function buildCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [header, ...rows].map((row) => row.map(csvEscape).join(CSV_SEPARATOR));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Search normalisation shared by the board (client) and the journal (server): accents and case are ignored. */
export const normalizeSearch = (value: string): string => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** Stable machine code suggested for a new resource: RES-<slug>. Uniqueness is enforced by the database. */
export function suggestResourceCode(name: string): string {
  const slug = normalizeSearch(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase().slice(0, 24);
  return `RES-${slug || "X"}`;
}
