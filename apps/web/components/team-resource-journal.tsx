import Link from "next/link";
import { EmptyState, SectionHeader, StatusBadge } from "@koeki/ui";
import { getTeamResourceJournal, type ResourceJournalFilters } from "@/lib/team-resource-journal";
import type { SessionInfo } from "@/lib/session";
import { ResourceOperationItems, ResourceOperationValue, ResourceStockEffects } from "./resource-operation-details";
import styles from "./resource-journal.module.css";

const statusLabels: Record<string, string> = { VALIDATED: "Validé", REVERSED: "Inversé", CANCELLED: "Annulé", PENDING_APPROVAL: "À approuver", DRAFT: "Brouillon" };

export async function TeamResourceJournal({ session, filters, preview = false }: { session: SessionInfo; filters: ResourceJournalFilters; preview?: boolean }) {
  const data = await getTeamResourceJournal(session, { ...filters, preview });
  const base = new URLSearchParams({ du: data.from, au: data.to, vue: "ressources" });
  if (data.q) base.set("q", data.q);
  if (data.type) base.set("type", data.type);
  const pageHref = (page: number) => { const query = new URLSearchParams(base); query.set("page", String(page)); return `/equipe?${query}#journal-ressources`; };
  return <section className="panel" id="journal-ressources" aria-label="Dons et rachats détaillés">
    <SectionHeader title="Dons et rachats — objets enregistrés" description={preview ? "Aperçu de 8 opérations de la période, avec leur contenu réel" : "Les objets et leurs quantités, distincts de leur équivalent en Ryō"}
      action={preview ? <Link href={pageHref(1)} className="text-link">Voir tous les dons et rachats</Link> : undefined} />
    <p className="notice">Un don apporte des ressources, pas un encaissement en Ryō. Un rachat apporte aussi des ressources, en contrepartie de son coût. <Link href="/inventory/movements" className="text-link">Voir toutes les entrées et sorties de stock</Link>.</p>
    {!preview && <form action="/equipe" method="get" className="filter-bar" aria-label="Filtrer les dons et rachats">
      <input type="hidden" name="vue" value="ressources" /><input type="hidden" name="du" value={data.from} /><input type="hidden" name="au" value={data.to} />
      <label>Objet, code, reçu ou ninja<input name="q" type="search" defaultValue={data.q} maxLength={100} placeholder="Métal de chakra, DON-…" /></label>
      <label>Opération<select name="type" defaultValue={data.type ?? ""}><option value="">Dons et rachats</option><option value="DONATION">Dons</option><option value="BUYBACK">Rachats</option></select></label>
      <button type="submit" className="button button-primary">Filtrer les objets</button>
    </form>}
    {data.rows.length ? <div className={`table-scroll ${styles.scroll}`} tabIndex={0} role="region" aria-label="Contenu des dons et rachats"><table className={styles.table} role="table">
      <caption>{data.total} opération(s) sur la période · {preview ? `${data.rows.length} affichée(s)` : `page ${data.page} sur ${data.pages}`}</caption>
      <thead role="rowgroup"><tr role="row"><th scope="col">Date / reçu</th><th scope="col">Agent / ninja</th><th scope="col">Objets et quantités</th><th scope="col">État / stock</th><th scope="col" className="num">Valeur distincte</th></tr></thead>
      <tbody role="rowgroup">{data.rows.map((row) => <tr key={row.id} role="row">
        <th scope="row" role="rowheader" data-label="Date / reçu"><strong>{row.type === "DONATION" ? "Don" : "Rachat"} {row.receiptNumber}</strong><small className="cell-detail">{row.at.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</small>{!row.dateKnown && <small className="cell-detail">Date de création · validation inconnue</small>}</th>
        <td role="cell" data-label="Agent / ninja"><Link href={`/equipe/${encodeURIComponent(row.agentId)}?du=${data.from}&au=${data.to}&vue=activite`} className="text-link">{row.agentName}</Link>{!row.authorKnown && <small className="cell-detail">Agent associé · auteur historique non renseigné</small>}<small className="cell-detail">Ninja : <Link href={`/ninjas/${row.details.ninja.id}`}>{row.details.ninja.firstName} {row.details.ninja.lastName} · {row.details.ninja.code}</Link></small></td>
        <td role="cell" data-label="Objets et quantités"><ResourceOperationItems details={row.details} /></td>
        <td role="cell" data-label="État / stock"><StatusBadge status={row.status === "VALIDATED" ? "paid" : "draft"}>{statusLabels[row.status] ?? row.status}</StatusBadge><small className="cell-detail">{row.origin === "BUSINESS" ? "Métier" : row.origin === "SELF_DECLARED" ? "Déclaration ninja" : "Historique ou technique"}</small><ResourceStockEffects details={row.details} /></td>
        <td role="cell" data-label="Valeur distincte" className="num"><ResourceOperationValue type={row.type} amount={row.totalAmount} /></td>
      </tr>)}</tbody>
    </table></div> : <EmptyState title="Aucun don ou rachat dans cette sélection" description="Modifiez la période ou la recherche. Les paiements en Ryō restent dans Taxes par agent." />}
    {!preview && <footer className="table-footer"><span>{data.total} opération(s) · page {data.page} sur {data.pages}</span><nav className="form-actions" aria-label="Pagination des dons et rachats">{data.page > 1 && <Link className="button button-ghost" href={pageHref(data.page - 1)}>Page précédente</Link>}{data.page < data.pages && <Link className="button button-ghost" href={pageHref(data.page + 1)}>Page suivante</Link>}</nav></footer>}
  </section>;
}
