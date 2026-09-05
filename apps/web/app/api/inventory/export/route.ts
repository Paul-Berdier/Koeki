import { NextResponse, type NextRequest } from "next/server";
import { buildCsv, normalizeSearch } from "@koeki/domain";
import { getInventoryBoard, listMovementsForExport } from "@/lib/inventory-data";
import type { JournalFilters } from "@/lib/inventory-types";
import { getSession, hasPermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);

/** CSV export of the register (inventory), the movement journal or the catalog, honouring the page filters. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!hasPermission(session, "inventory:export")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const type = params.get("type") ?? "inventory";
  let filename = `inventory-${today()}.csv`;
  let csv = "";
  if (type === "movements") {
    const filters: JournalFilters = {};
    for (const key of ["q", "ressource", "categorie", "type", "sens", "agent", "ninja", "du", "au", "motif", "origine"] as const) { const value = params.get(key); if (value) filters[key] = value; }
    const rows = await listMovementsForExport(filters);
    filename = `mouvements-${today()}.csv`;
    csv = buildCsv(["date", "resourceCode", "resourceName", "type", "quantity", "unit", "quantityBefore", "quantityAfter", "counterparty", "counterpartyRole", "agent", "reason", "notes", "source", "movementId", "reversedMovementId"],
      rows.map((row) => [row.at, row.resourceCode, row.resourceName, row.type, row.quantity, row.unit.label, row.before, row.after, row.counterpartyLabel, row.counterpartyLabel ? row.counterpartyRole : null, row.agent, row.reason, row.notes, row.sourceLabel, row.id, row.reversedMovementId]));
  } else {
    const board = await getInventoryBoard(session);
    const category = params.get("categorie") ?? "";
    const filter = params.get("filtre") ?? "";
    const needle = normalizeSearch(params.get("q") ?? "");
    const rows = board.rows.filter((row) => {
      if (filter === "inactive" ? row.isActive : !row.isActive) return false;
      if (category && row.categoryCode !== category) return false;
      if (filter === "not-inventoried" && row.inventoryStatus !== "NOT_INVENTORIED") return false;
      if (filter === "inventoried" && row.inventoryStatus !== "COUNTED") return false;
      if (filter === "low" && row.state !== "LOW") return false;
      if (filter === "critical" && row.state !== "CRITICAL") return false;
      if (filter === "out" && row.state !== "OUT_OF_STOCK") return false;
      if (filter === "recent" && !(row.in30 > 0 || row.out30 > 0)) return false;
      if (filter === "idle" && row.lastMovementAt) return false;
      return !needle || normalizeSearch(`${row.name} ${row.code} ${row.categoryLabel} ${row.aliases.join(" ")}`).includes(needle);
    });
    if (type === "catalog") {
      filename = `catalogue-${today()}.csv`;
      csv = buildCsv(["resourceCode", "resourceName", "category", "unit", "unitDecimals", "minimumStock", "criticalStock", "aliases", "isActive", "inventoryStatus"],
        rows.map((row) => [row.code, row.name, row.categoryLabel, row.unit.label, row.unit.decimals, row.minimumStock, row.criticalStock, row.aliases.join(", "), row.isActive ? "1" : "0", row.inventoryStatus]));
    } else {
      csv = buildCsv(["resourceCode", "resourceName", "category", "unit", "quantity", "status", "state", "in30d", "out30d", "lastMovementAt", "lastCountedAt"],
        rows.map((row) => [row.code, row.name, row.categoryLabel, row.unit.label, row.hasMovements || row.inventoryStatus === "COUNTED" ? row.quantity : "", row.inventoryStatus, row.stateLabel, row.in30, row.out30, row.lastMovementAt, row.lastCountedAt]));
    }
  }
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}
