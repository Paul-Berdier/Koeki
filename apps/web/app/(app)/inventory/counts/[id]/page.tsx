import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { EmptyState, PageHeader, SectionHeader, StatusBadge } from "@koeki/ui";
import { formatQuantity } from "@koeki/domain";
import { getStocktakeDetail } from "@/lib/inventory-data";
import { demoMode, hasPermission, requirePermission } from "@/lib/session";
import { cancelStocktakeAction, confirmStocktakeAction } from "../actions";

export default async function StocktakeReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("inventory:read");
  const { id } = await params;
  const query = await searchParams;
  const data = await getStocktakeDetail(id);
  if (!data) notFound();
  const canCount = !demoMode && hasPermission(session, "inventory:count");
  const info = typeof query.info === "string" ? query.info : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const differences = data.lines.filter((line) => line.difference !== 0 || line.inventoryStatus === "NOT_INVENTORIED");
  const isOpen = data.status === "OPEN";
  return <div className="page-wrap">
    <PageHeader eyebrow={`${data.kindLabel} · ${data.startedLabel}`} title={isOpen ? "Revue des écarts" : data.kindLabel}
      description={isOpen ? "Vérifiez les écarts ci-dessous. Confirmer crée un mouvement audité par écart et passe chaque ressource comptée en « Inventorié ». Le stock système est recalculé au moment de la confirmation." : `Lancé par ${data.startedBy}${data.completedLabel ? ` · clôturé ${data.completedLabel}` : ""}${data.notes ? ` · ${data.notes}` : ""}`}
      metrics={[{ label: "Ressources comptées", value: String(data.entries) }, { label: "Écarts", value: String(differences.length) }, { label: "Statut", value: data.statusLabel }]}
      actions={<Link className="button button-ghost" href="/inventory/counts"><ArrowLeft size={17} aria-hidden="true" /> Comptages</Link>} />
    {info && <p className="notice" role="status">{info}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {isOpen && <div className="notice stocktake-banner" role="status">
      <span><strong>{differences.length} écart{differences.length > 1 ? "s" : ""} détecté{differences.length > 1 ? "s" : ""}</strong> sur {data.entries} ressource{data.entries > 1 ? "s" : ""} comptée{data.entries > 1 ? "s" : ""}.{differences.length === 0 && " Le stock compté correspond au stock système : confirmer marquera simplement les ressources comme inventoriées."}</span>
      {canCount && <div className="stocktake-banner-actions">
        <form action={cancelStocktakeAction}><input type="hidden" name="sessionId" value={data.id} /><button className="button button-ghost" type="submit">Annuler le comptage</button></form>
        <form action={confirmStocktakeAction}><input type="hidden" name="sessionId" value={data.id} /><button className="button button-primary" type="submit"><CheckCircle2 size={16} aria-hidden="true" /> Confirmer les ajustements</button></form>
      </div>}
    </div>}
    <section className="panel">
      <SectionHeader title={isOpen ? "Écarts proposés" : "Lignes du comptage"} description="Stock système au moment de la saisie, stock compté, écart et mouvement produit" />
      {data.lines.length ? <div className="table-scroll"><table>
        <thead><tr><th scope="col">Ressource</th><th scope="col">Catégorie</th><th scope="col" className="num">Stock système</th><th scope="col" className="num">Stock compté</th><th scope="col" className="num">Écart</th><th scope="col">Mouvement</th></tr></thead>
        <tbody>{data.lines.map((line) => <tr key={line.resourceId} className={line.difference ? "has-diff" : ""}>
          <td><Link className="ninja-record-link" href={`/inventory/${line.resourceId}`}><strong>{line.name}</strong></Link><br /><small className="muted"><code>{line.code}</code>{line.inventoryStatus === "NOT_INVENTORIED" && !line.movementId && " · jamais compté"}</small></td>
          <td>{line.categoryLabel}</td>
          <td className="num muted">{formatQuantity(line.expected, line.unit.decimals)} {line.unit.label}</td>
          <td className="num"><strong>{formatQuantity(line.counted, line.unit.decimals)}</strong> {line.unit.label}</td>
          <td className={`num ${line.difference < 0 ? "negative" : line.difference > 0 ? "positive" : "muted"}`}>{line.difference === 0 ? "aucun" : `${line.difference > 0 ? "+" : "−"}${formatQuantity(Math.abs(line.difference), line.unit.decimals)}`}</td>
          <td>{line.movementId ? <StatusBadge status="paid">{line.movementLabel}</StatusBadge> : isOpen ? <span className="muted">{line.inventoryStatus === "NOT_INVENTORIED" ? "Solde initial à créer" : line.difference ? `${line.difference > 0 ? "Ajustement (+)" : "Ajustement (−)"} à créer` : "Aucun mouvement"}</span> : <span className="muted">{data.status === "CANCELLED" ? "Annulé" : "Aucun"}</span>}</td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="Aucune ligne" description="Ce comptage ne contient aucune ressource." />}
    </section>
  </div>;
}
