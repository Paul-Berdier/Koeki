import Link from "next/link";
import { ArrowRight, ClipboardList, PackagePlus } from "lucide-react";
import { MetricCard, PageHeader } from "@koeki/ui";
import {
  InventoryBoard,
  QuickMovementButton,
} from "@/components/inventory/inventory-board";
import { getInventoryBoard } from "@/lib/inventory-data";
import { demoMode, hasPermission, requirePermission } from "@/lib/session";
import {
  recordAdjustment,
  recordManualMovement,
  resyncInventory,
} from "./actions";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission("inventory:read");
  const query = await searchParams;
  const data = await getInventoryBoard(session);
  // In demo mode the buttons stay visible (visual audit, tests) — the server refuses every write.
  const canWrite = hasPermission(session, "inventory:write");
  const canAdjust = hasPermission(session, "inventory:adjust");
  const canCount = !demoMode && hasPermission(session, "inventory:count");
  const canCatalog = !demoMode && hasPermission(session, "inventory:catalog");
  const canExport = hasPermission(session, "inventory:export");
  const info = typeof query.info === "string" ? query.info : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const { stats } = data;
  return (
    <div className="page-wrap inventory-page">
      <PageHeader
        eyebrow="Stocks"
        title="Inventaire"
        description="Consultez les quantités disponibles, repérez les seuils à surveiller et enregistrez les mouvements de ressources."
        actions={
          <>
            {canWrite && (
              <QuickMovementButton
                rows={data.rows}
                ninjas={data.ninjas}
                canAdjust={canAdjust}
                movementAction={recordManualMovement}
                adjustmentAction={recordAdjustment}
              />
            )}
            {canCount && (
              <Link
                className="button button-ghost"
                href="/inventory/counts/new?mode=count"
              >
                <ClipboardList size={17} aria-hidden="true" /> Nouveau comptage
              </Link>
            )}
            {canCatalog && (
              <Link className="button button-ghost" href="/resources/new">
                <PackagePlus size={17} aria-hidden="true" /> Ajouter une
                ressource
              </Link>
            )}
          </>
        }
      />
      <section
        className="metric-grid metric-grid-5"
        aria-label="Situation des stocks"
      >
        <MetricCard
          label="Références actives"
          value={String(stats.active)}
          detail={
            stats.total > stats.active
              ? `${stats.total - stats.active} désactivée${stats.total - stats.active > 1 ? "s" : ""} hors tableau`
              : "Ressources du catalogue"
          }
        />
        <MetricCard
          label="Non inventoriées"
          value={String(stats.notInventoried)}
          detail={
            stats.notInventoried
              ? "Jamais comptées — stock non fiable"
              : "Tout le catalogue a été compté"
          }
          tone={stats.notInventoried ? "warn" : "good"}
        />
        <MetricCard
          label="Stock faible"
          value={String(stats.low)}
          detail={stats.low ? "Sous le seuil bas" : "Aucun seuil bas franchi"}
          tone={stats.low ? "warn" : "good"}
        />
        <MetricCard
          label="Stock critique"
          value={String(stats.critical + stats.outOfStock)}
          detail={
            stats.outOfStock
              ? `dont ${stats.outOfStock} en rupture`
              : stats.critical
                ? "Sous le seuil critique"
                : "Aucun seuil critique franchi"
          }
          tone={stats.critical + stats.outOfStock ? "danger" : "good"}
        />
        <MetricCard
          label="Mouvements aujourd’hui"
          value={String(stats.movementsToday)}
          detail={`${stats.inToday} entrée${stats.inToday > 1 ? "s" : ""} · ${stats.outToday} sortie${stats.outToday > 1 ? "s" : ""}`}
        />
      </section>
      {data.openStocktakes > 0 && (
        <p className="notice" role="status">
          {data.openStocktakes} comptage{data.openStocktakes > 1 ? "s" : ""} en
          attente de confirmation —{" "}
          <Link href="/inventory/counts" className="text-link">
            ouvrir les comptages <ArrowRight size={13} />
          </Link>
        </p>
      )}
      {canAdjust && data.mismatches > 0 && (
        <div className="notice error inventory-reconcile" role="alert">
          <span>
            <strong>Inventaire incohérent :</strong> {data.mismatches} ressource
            {data.mismatches > 1 ? "s" : ""} dont le stock affiché diffère de la
            somme des mouvements. Rien n’est corrigé automatiquement.
          </span>
          <form action={resyncInventory}>
            <button className="button button-ghost" type="submit">
              Réaligner sur les mouvements
            </button>
          </form>
        </div>
      )}
      {canCount && stats.notInventoried > 0 && stats.active > 0 && (
        <p className="notice" role="status">
          {stats.notInventoried === stats.active
            ? "Aucune ressource n’a encore été comptée."
            : `${stats.notInventoried} ressource${stats.notInventoried > 1 ? "s" : ""} n’${stats.notInventoried > 1 ? "ont" : "a"} jamais été comptée${stats.notInventoried > 1 ? "s" : ""}.`}{" "}
          Le premier comptage crée un solde initial tracé pour chaque ressource
          —{" "}
          <Link href="/inventory/counts/new?mode=initial" className="text-link">
            initialiser l’inventaire <ArrowRight size={13} />
          </Link>
        </p>
      )}
      <InventoryBoard
        rows={data.rows}
        categories={data.categories}
        ninjas={data.ninjas}
        canWrite={canWrite}
        canAdjust={canAdjust}
        canExport={canExport}
        movementAction={recordManualMovement}
        adjustmentAction={recordAdjustment}
        notice={info}
        error={error}
      />
      <footer className="panel table-footer inventory-footer">
        <span>
          Chaque mouvement conserve son auteur, sa date et son motif dans le
          journal. Une correction y ajoute une nouvelle écriture.
        </span>
      </footer>
    </div>
  );
}
