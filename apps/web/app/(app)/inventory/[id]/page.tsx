import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { EmptyState, MetricCard, PageHeader, SectionHeader, StatusBadge } from "@koeki/ui";
import { formatQuantity, formatQuantityWithUnit, inventoryStatusLabels, type StockState } from "@koeki/domain";
import { ResourceActions } from "@/components/inventory/resource-actions";
import { MovementTable } from "@/components/inventory/movement-table";
import type { BadgeStatus } from "@/lib/format";
import { getResourceInventoryDetail } from "@/lib/inventory-data";
import { demoMode, hasPermission, requirePermission } from "@/lib/session";
import { listNinjaOptions } from "@/lib/inventory-data";
import { recordAdjustment, recordManualMovement, reverseMovementAction } from "../actions";

const badgeOf: Record<StockState, BadgeStatus> = { NOT_INVENTORIED: "draft", OUT_OF_STOCK: "overdue", CRITICAL: "overdue", LOW: "warning", NORMAL: "paid" };

export default async function ResourceInventoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("inventory:read");
  const { id } = await params;
  const query = await searchParams;
  const page = typeof query.page === "string" ? Number(query.page) || 1 : 1;
  const data = await getResourceInventoryDetail(session, id, page);
  if (!data) notFound();
  const { resource } = data;
  // Same rule as the register: buttons visible in demo mode, every write refused by the server.
  const canWrite = hasPermission(session, "inventory:write");
  const canAdjust = hasPermission(session, "inventory:adjust");
  const canCatalog = !demoMode && hasPermission(session, "inventory:catalog");
  const ninjas = canWrite ? await listNinjaOptions() : [];
  const info = typeof query.info === "string" ? query.info : null;
  const counted = resource.hasMovements || resource.inventoryStatus === "COUNTED";
  const pageQuery = (target: number) => `/inventory/${resource.id}?page=${target}`;
  return <div className="page-wrap">
    <PageHeader eyebrow={`${resource.categoryLabel} · ${resource.code}`} title={resource.name}
      description={resource.description ?? `Historique complet de ${resource.name} : chaque ligne indique le stock avant et après, la personne concernée, l’agent et le motif.`}
      actions={<>
        {canWrite && resource.isActive && <ResourceActions row={resource} ninjas={ninjas} canAdjust={canAdjust} movementAction={recordManualMovement} adjustmentAction={recordAdjustment} />}
        {canCatalog && <Link className="button button-ghost" href={`/resources/${resource.id}/modifier`}><Pencil size={17} aria-hidden="true" /> Modifier</Link>}
        <Link className="button button-ghost" href="/inventory"><ArrowLeft size={17} aria-hidden="true" /> Inventaire</Link>
      </>} />
    {info && <p className="notice" role="status">{info}</p>}
    {!resource.isActive && <p className="notice error" role="alert">Ressource désactivée : son historique reste consultable, aucun nouveau mouvement n’est possible.</p>}
    <section className="metric-grid" aria-label="Situation de la ressource">
      <MetricCard label="Stock actuel" value={counted ? formatQuantityWithUnit(resource.quantity, resource.unit) : "—"} detail={resource.inventoryStatus === "COUNTED" ? `Inventorié · dernier comptage ${resource.lastCountedLabel}` : counted ? "Non inventorié — somme des mouvements connus" : inventoryStatusLabels.NOT_INVENTORIED} tone={resource.state === "NORMAL" ? "good" : resource.state === "LOW" ? "warn" : resource.state === "NOT_INVENTORIED" ? "neutral" : "danger"} />
      <MetricCard label="Entrées ce mois" value={`+${formatQuantity(data.metrics.inMonth, resource.unit.decimals)}`} detail={`${resource.unit.label} · 30 derniers jours : +${formatQuantity(resource.in30, resource.unit.decimals)}`} tone="good" />
      <MetricCard label="Sorties ce mois" value={`−${formatQuantity(data.metrics.outMonth, resource.unit.decimals)}`} detail={`${resource.unit.label} · 30 derniers jours : −${formatQuantity(resource.out30, resource.unit.decimals)}`} tone={data.metrics.outMonth ? "warn" : "neutral"} />
      <MetricCard label="Dernier inventaire" value={resource.lastCountedAt ? resource.lastCountedLabel : "Jamais"} detail={data.metrics.lastCountLabel} tone={resource.lastCountedAt ? "neutral" : "warn"} />
    </section>
    <div className="duo-grid resource-facts">
      <section className="panel">
        <SectionHeader title="Fiche" description="Référentiel et seuils" />
        <div className="identity-list">
          <div><span>Code</span><code>{resource.code}</code></div>
          <div><span>Unité</span>{resource.unit.label}{resource.unit.decimals ? ` (${resource.unit.decimals} décimales)` : " (entière)"}</div>
          <div><span>Catégorie</span>{resource.categoryLabel}</div>
          <div><span>État</span><StatusBadge status={badgeOf[resource.state]}>{resource.stateLabel}</StatusBadge></div>
          <div><span>Seuil bas</span>{resource.minimumStock ? formatQuantityWithUnit(resource.minimumStock, resource.unit) : "Non défini"}</div>
          <div><span>Seuil critique</span>{resource.criticalStock ? formatQuantityWithUnit(resource.criticalStock, resource.unit) : "Non défini"}</div>
          <div style={{ gridColumn: "1/-1" }}><span>Alias de recherche</span>{resource.aliases.length ? resource.aliases.join(", ") : "—"}</div>
        </div>
      </section>
      <section className="panel">
        <SectionHeader title="Comptages" description="Derniers inventaires physiques de cette ressource" />
        {data.stocktakes.length ? <div className="mini-list">{data.stocktakes.map((entry) => <div key={`${entry.id}-${entry.atLabel}`}><span><Link className="ninja-record-link" href={`/inventory/counts/${entry.id}`}><strong>{entry.kindLabel}</strong></Link><small>{entry.atLabel} · {entry.agent}{entry.status !== "COMPLETED" ? ` · ${entry.status === "OPEN" ? "à confirmer" : "annulé"}` : ""}</small></span><strong className={entry.difference < 0 ? "negative" : entry.difference > 0 ? "positive" : "muted"}>{formatQuantity(entry.expected, resource.unit.decimals)} → {formatQuantity(entry.counted, resource.unit.decimals)}{entry.difference ? ` (${entry.difference > 0 ? "+" : "−"}${formatQuantity(Math.abs(entry.difference), resource.unit.decimals)})` : ""}</strong></div>)}</div>
          : <EmptyState title="Jamais comptée" description="Le premier comptage fixera le solde initial de cette ressource." />}
      </section>
    </div>
    <section className="panel stack-panel">
      <SectionHeader title="Historique" description={`${data.total} mouvement${data.total > 1 ? "s" : ""} — du plus récent au plus ancien`} />
      <MovementTable rows={data.movements} showResource={false} reverseAction={reverseMovementAction} canOverride={canAdjust} />
      {data.pageCount > 1 && <footer className="table-footer"><span>Page {data.page} sur {data.pageCount}</span><div>{data.page > 1 ? <Link className="button button-ghost" href={pageQuery(data.page - 1)}>Précédent</Link> : <button disabled>Précédent</button>}{data.page < data.pageCount ? <Link className="button button-ghost" href={pageQuery(data.page + 1)}>Suivant</Link> : <button disabled>Suivant</button>}</div></footer>}
    </section>
  </div>;
}
