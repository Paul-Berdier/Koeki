"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpDown, ArrowUpFromLine, Columns3, Download, Rows3, Search, SearchX, SlidersHorizontal } from "lucide-react";
import { StatusBadge } from "@koeki/ui";
import { formatQuantity, normalizeSearch, type StockState } from "@koeki/domain/inventory";
import type { BadgeStatus } from "@/lib/format";
import type { ActionState, InventoryRow, NinjaOption } from "@/lib/inventory-types";
import { MovementDrawer, type DrawerMode } from "./movement-drawer";

type SortKey = "name" | "category" | "quantity" | "in30" | "out30" | "lastMovement" | "state" | "updated";
type FormAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

const FILTERS = [
  { value: "", label: "Toutes les ressources" }, { value: "not-inventoried", label: "Non inventoriées" }, { value: "inventoried", label: "Inventoriées" },
  { value: "low", label: "Stock faible" }, { value: "critical", label: "Stock critique" }, { value: "out", label: "En rupture" },
  { value: "recent", label: "Mouvements récents (30 j)" }, { value: "idle", label: "Sans mouvement" }, { value: "inactive", label: "Désactivées" }
] as const;
type FilterValue = typeof FILTERS[number]["value"];

const COLUMNS: Array<{ key: string; label: string; always?: boolean; hidden?: boolean; num?: boolean }> = [
  { key: "name", label: "Ressource", always: true }, { key: "category", label: "Catégorie" }, { key: "unit", label: "Unité" },
  { key: "quantity", label: "Stock", always: true, num: true }, { key: "in30", label: "Entrées 30 j", num: true }, { key: "out30", label: "Sorties 30 j", num: true },
  { key: "lastMovement", label: "Dernier mouvement" }, { key: "updated", label: "Dernière mise à jour", hidden: true },
  { key: "minimum", label: "Seuil bas", hidden: true, num: true }, { key: "critical", label: "Seuil critique", hidden: true, num: true }, { key: "lastAgent", label: "Dernier agent", hidden: true },
  { key: "state", label: "État", always: true }
];

const stateOrder: Record<StockState, number> = { OUT_OF_STOCK: 0, CRITICAL: 1, LOW: 2, NOT_INVENTORIED: 3, NORMAL: 4 };
const badgeOf: Record<StockState, BadgeStatus> = { NOT_INVENTORIED: "draft", OUT_OF_STOCK: "overdue", CRITICAL: "overdue", LOW: "warning", NORMAL: "paid" };

const readStorage = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStorage = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

export function InventoryBoard({ rows, categories, ninjas, canWrite, canAdjust, canExport, movementAction, adjustmentAction, notice, error }: {
  rows: InventoryRow[]; categories: Array<{ code: string; label: string }>; ninjas: NinjaOption[];
  canWrite: boolean; canAdjust: boolean; canExport: boolean; movementAction: FormAction; adjustmentAction: FormAction; notice: string | null; error: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState(params.get("categorie") ?? "");
  const [filter, setFilter] = useState<FilterValue>((FILTERS.find((entry) => entry.value === params.get("filtre"))?.value ?? "") as FilterValue);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>(() => {
    const [key, dir] = (params.get("tri") ?? "name:asc").split(":");
    return { key: (key as SortKey) || "name", dir: dir === "desc" ? "desc" : "asc" };
  });
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(COLUMNS.filter((column) => column.hidden).map((column) => column.key)));
  const [drawer, setDrawer] = useState<{ mode: DrawerMode; resource: InventoryRow | null } | null>(null);
  const [message, setMessage] = useState<string | null>(notice);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const storedDensity = readStorage("koeki.inventory.density");
    if (storedDensity === "compact") setDensity("compact");
    const storedColumns = readStorage("koeki.inventory.columns");
    if (storedColumns) { try { setHidden(new Set(JSON.parse(storedColumns) as string[])); } catch { /* ignore */ } }
  }, []);
  useEffect(() => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (category) search.set("categorie", category);
    if (filter) search.set("filtre", filter);
    if (sort.key !== "name" || sort.dir !== "asc") search.set("tri", `${sort.key}:${sort.dir}`);
    const url = search.size ? `/inventory?${search}` : "/inventory";
    window.history.replaceState(null, "", url);
  }, [query, category, filter, sort]);

  const toggleDensity = () => setDensity((current) => { const next = current === "compact" ? "comfortable" : "compact"; writeStorage("koeki.inventory.density", next); return next; });
  const toggleColumn = (key: string) => setHidden((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); writeStorage("koeki.inventory.columns", JSON.stringify([...next])); return next; });
  const sortBy = (key: SortKey) => setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
  const show = (key: string) => !hidden.has(key);
  const onSuccess = useCallback((text: string) => { setDrawer(null); setMessage(text); router.refresh(); }, [router]);

  const visible = useMemo(() => {
    const needle = normalizeSearch(deferredQuery);
    const filtered = rows.filter((row) => {
      if (filter === "inactive") { if (row.isActive) return false; } else if (!row.isActive) return false;
      if (category && row.categoryCode !== category) return false;
      if (filter === "not-inventoried" && row.inventoryStatus !== "NOT_INVENTORIED") return false;
      if (filter === "inventoried" && row.inventoryStatus !== "COUNTED") return false;
      if (filter === "low" && row.state !== "LOW") return false;
      if (filter === "critical" && row.state !== "CRITICAL") return false;
      if (filter === "out" && row.state !== "OUT_OF_STOCK") return false;
      if (filter === "recent" && !(row.in30 > 0 || row.out30 > 0)) return false;
      if (filter === "idle" && row.lastMovementAt) return false;
      if (!needle) return true;
      return normalizeSearch(`${row.name} ${row.code} ${row.categoryLabel} ${row.aliases.join(" ")}`).includes(needle);
    });
    const direction = sort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      switch (sort.key) {
        case "quantity": return direction * (a.quantity - b.quantity);
        case "in30": return direction * (a.in30 - b.in30);
        case "out30": return direction * (a.out30 - b.out30);
        case "category": return direction * (a.categoryLabel.localeCompare(b.categoryLabel, "fr") || a.name.localeCompare(b.name, "fr"));
        case "lastMovement": return direction * ((a.lastMovementAt ?? "").localeCompare(b.lastMovementAt ?? "")) || a.name.localeCompare(b.name, "fr");
        case "updated": return direction * a.updatedAt.localeCompare(b.updatedAt);
        case "state": return direction * (stateOrder[a.state] - stateOrder[b.state]) || a.name.localeCompare(b.name, "fr");
        default: return direction * a.name.localeCompare(b.name, "fr");
      }
    });
  }, [rows, deferredQuery, category, filter, sort]);

  const exportHref = `/api/inventory/export?type=inventory${category ? `&categorie=${encodeURIComponent(category)}` : ""}${filter ? `&filtre=${encodeURIComponent(filter)}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const headerCell = (key: SortKey, label: string, num = false) => <th scope="col" className={num ? "num" : undefined} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
    <button type="button" className={`sort-button${sort.key === key ? " active" : ""}`} onClick={() => sortBy(key)}>{label}<ArrowUpDown size={11} aria-hidden="true" /></button>
  </th>;
  const stockCell = (row: InventoryRow) => row.hasMovements || row.inventoryStatus === "COUNTED"
    ? <><strong className={row.quantity < 0 ? "negative" : ""}>{formatQuantity(row.quantity, row.unit.decimals)}</strong> <small>{row.unit.label}</small></>
    : <span className="muted" title="Jamais compté, aucun mouvement">—</span>;

  return <section className={`panel inventory-panel${density === "compact" ? " density-compact" : ""}`}>
    <div className="inventory-toolbar">
      <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Rechercher une ressource</span>
        <input type="search" value={query} placeholder="Fer, Iron, RES-IRON, Plan T2…" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label className="sr-only" htmlFor="inventory-category">Catégorie</label>
      <select id="inventory-category" className="button button-ghost" value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="">Toutes catégories</option>{categories.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
      </select>
      <label className="sr-only" htmlFor="inventory-filter">Filtre</label>
      <select id="inventory-filter" className="button button-ghost" value={filter} onChange={(event) => setFilter(event.target.value as FilterValue)}>
        {FILTERS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
      <div className="toolbar-tools">
        <button type="button" className="button button-ghost" onClick={toggleDensity} aria-pressed={density === "compact"} title="Densité du tableau"><Rows3 size={15} aria-hidden="true" /> {density === "compact" ? "Compact" : "Confortable"}</button>
        <details className="columns-menu">
          <summary className="button button-ghost"><Columns3 size={15} aria-hidden="true" /> Colonnes</summary>
          <div className="columns-popover" role="group" aria-label="Colonnes affichées">
            {COLUMNS.map((column) => <label key={column.key}><input type="checkbox" checked={column.always || show(column.key)} disabled={column.always} onChange={() => toggleColumn(column.key)} /> {column.label}</label>)}
          </div>
        </details>
        {canExport && <a className="button button-ghost" href={exportHref} title="Exporter le tableau filtré en CSV"><Download size={15} aria-hidden="true" /> CSV</a>}
      </div>
    </div>
    <div className="inventory-result-count" aria-live="polite">{visible.length} ressource{visible.length > 1 ? "s" : ""} affichée{visible.length > 1 ? "s" : ""}{query || category || filter ? " (filtre actif)" : ""}</div>
    {message && <p className="notice inventory-notice" role="status">{message}</p>}
    {error && <p className="notice error inventory-notice" role="alert">{error}</p>}
    {visible.length ? <div className="inventory-table-wrap"><table className="inventory-table board-table">
      <thead><tr>
        {headerCell("name", "Ressource")}
        {show("category") && headerCell("category", "Catégorie")}
        {show("unit") && <th scope="col">Unité</th>}
        {headerCell("quantity", "Stock", true)}
        {show("in30") && headerCell("in30", "Entrées 30 j", true)}
        {show("out30") && headerCell("out30", "Sorties 30 j", true)}
        {show("lastMovement") && headerCell("lastMovement", "Dernier mouvement")}
        {show("updated") && headerCell("updated", "Dernière mise à jour")}
        {show("minimum") && <th scope="col" className="num">Seuil bas</th>}
        {show("critical") && <th scope="col" className="num">Seuil critique</th>}
        {show("lastAgent") && <th scope="col">Dernier agent</th>}
        {headerCell("state", "État")}
        {canWrite && <th scope="col" className="actions-col">Actions</th>}
      </tr></thead>
      <tbody>{visible.map((row) => <tr key={row.id} className={`state-${row.state.toLowerCase().replaceAll("_", "-")}${row.isActive ? "" : " is-inactive"}`}>
        <th scope="row" data-col="name"><Link href={`/inventory/${row.id}`} className="resource-link"><strong>{row.name}</strong><small><code>{row.code}</code>{row.aliases.length ? ` · ${row.aliases.slice(0, 3).join(", ")}` : ""}</small></Link></th>
        {show("category") && <td data-col="category">{row.categoryLabel}</td>}
        {show("unit") && <td data-col="unit">{row.unit.label}</td>}
        <td className="num stock-cell" data-col="quantity">{stockCell(row)}</td>
        {show("in30") && <td className="num" data-col="in30">{row.in30 ? <span className="positive">+{formatQuantity(row.in30, row.unit.decimals)}</span> : <span className="muted">0</span>}</td>}
        {show("out30") && <td className="num" data-col="out30">{row.out30 ? <span className="negative">−{formatQuantity(row.out30, row.unit.decimals)}</span> : <span className="muted">0</span>}</td>}
        {show("lastMovement") && <td data-col="lastMovement" title={row.lastMovementSummary ?? undefined}>{row.lastMovementAt ? <><span>{row.lastMovementLabel}</span>{row.lastMovementSummary && <small>{row.lastMovementSummary}</small>}</> : <span className="muted">Aucun</span>}</td>}
        {show("updated") && <td data-col="updated">{row.updatedLabel}</td>}
        {show("minimum") && <td className="num" data-col="minimum">{row.minimumStock ? formatQuantity(row.minimumStock, row.unit.decimals) : <span className="muted">—</span>}</td>}
        {show("critical") && <td className="num" data-col="critical">{row.criticalStock ? formatQuantity(row.criticalStock, row.unit.decimals) : <span className="muted">—</span>}</td>}
        {show("lastAgent") && <td data-col="lastAgent">{row.lastAgent ?? <span className="muted">—</span>}</td>}
        <td data-col="state"><StatusBadge status={badgeOf[row.state]}>{row.stateLabel}</StatusBadge>{!row.isActive && <small className="muted"> · désactivée</small>}</td>
        {canWrite && <td className="actions-col" data-col="actions"><div className="row-actions">
          <button type="button" className="row-action in" disabled={!row.isActive} onClick={() => setDrawer({ mode: "in", resource: row })} aria-label={`Entrée de stock pour ${row.name}`}><ArrowDownToLine size={14} aria-hidden="true" /><span>Entrée</span></button>
          <button type="button" className="row-action out" disabled={!row.isActive} onClick={() => setDrawer({ mode: "out", resource: row })} aria-label={`Sortie de stock pour ${row.name}`}><ArrowUpFromLine size={14} aria-hidden="true" /><span>Sortie</span></button>
          {canAdjust && <button type="button" className="row-action adjust" disabled={!row.isActive} onClick={() => setDrawer({ mode: "adjust", resource: row })} aria-label={`Ajuster le stock de ${row.name}`} title="Ajustement (responsable)"><SlidersHorizontal size={14} aria-hidden="true" /></button>}
        </div></td>}
      </tr>)}</tbody>
    </table></div>
      : <div className="equipment-no-result"><SearchX size={25} aria-hidden="true" /><strong>Aucune ressource ne correspond</strong><p>Modifiez la recherche ou le filtre. Les alias (Iron, T1…) et les codes sont acceptés.</p></div>}
    {drawer && <MovementDrawer mode={drawer.mode} resource={drawer.resource} resources={rows} ninjas={ninjas} canAdjust={canAdjust} action={movementAction} adjustmentAction={adjustmentAction} onClose={() => setDrawer(null)} onSuccess={onSuccess} />}
  </section>;
}

/** Header button that opens the drawer without a preselected resource. */
export function QuickMovementButton({ rows, ninjas, canAdjust, movementAction, adjustmentAction }: { rows: InventoryRow[]; ninjas: NinjaOption[]; canAdjust: boolean; movementAction: FormAction; adjustmentAction: FormAction }) {
  const router = useRouter();
  const [open, setOpen] = useState<DrawerMode | null>(null);
  const onSuccess = useCallback((text: string) => { setOpen(null); router.push(`/inventory?info=${encodeURIComponent(text)}`); router.refresh(); }, [router]);
  return <>
    <button type="button" className="button button-primary" onClick={() => setOpen("in")}><ArrowDownToLine size={17} aria-hidden="true" /> Nouveau mouvement</button>
    {open && <MovementDrawer mode={open} resource={null} resources={rows} ninjas={ninjas} canAdjust={canAdjust} action={movementAction} adjustmentAction={adjustmentAction} onClose={() => setOpen(null)} onSuccess={onSuccess} />}
  </>;
}
