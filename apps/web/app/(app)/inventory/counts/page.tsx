import Link from "next/link";
import { ArrowLeft, ClipboardList, FileUp, Sparkles } from "lucide-react";
import { EmptyState, PageHeader, StatusBadge } from "@koeki/ui";
import { getInventoryBoard, getStocktakes } from "@/lib/inventory-data";
import { demoMode, hasPermission, requirePermission } from "@/lib/session";

export default async function StocktakeListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("inventory:read");
  const query = await searchParams;
  const [sessions, board] = await Promise.all([getStocktakes(), getInventoryBoard(session)]);
  const canCount = !demoMode && hasPermission(session, "inventory:count");
  const info = typeof query.info === "string" ? query.info : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const notInventoried = board.stats.notInventoried;
  return <div className="page-wrap">
    <PageHeader eyebrow="Inventaires physiques" title="Comptages" description="Un comptage compare le stock compté au stock système. Chaque écart devient un ajustement audité ; une ressource jamais comptée reçoit un solde initial."
      metrics={[{ label: "Comptages", value: String(sessions.length) }, { label: "À confirmer", value: String(sessions.filter((session) => session.status === "OPEN").length) }, { label: "Non inventoriées", value: String(notInventoried) }]}
      actions={<>
        {canCount && notInventoried > 0 && <Link className="button button-primary" href="/inventory/counts/new?mode=initial"><Sparkles size={17} aria-hidden="true" /> Initialiser l’inventaire</Link>}
        {canCount && <Link className={`button ${notInventoried > 0 ? "button-ghost" : "button-primary"}`} href="/inventory/counts/new?mode=count"><ClipboardList size={17} aria-hidden="true" /> Nouveau comptage</Link>}
        {canCount && <Link className="button button-ghost" href="/inventory/counts/new?mode=import"><FileUp size={17} aria-hidden="true" /> Importer un CSV</Link>}
        <Link className="button button-ghost" href="/inventory"><ArrowLeft size={17} aria-hidden="true" /> Inventaire</Link>
      </>} />
    {info && <p className="notice" role="status">{info}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <section className="panel">
      {sessions.length ? <div className="table-scroll"><table>
        <thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Lancé par</th><th scope="col" className="num">Ressources</th><th scope="col" className="num">Écarts</th><th scope="col">Statut</th><th scope="col">Note</th></tr></thead>
        <tbody>{sessions.map((session) => <tr key={session.id}>
          <td><Link className="ninja-record-link" href={`/inventory/counts/${session.id}`}><strong>{session.startedLabel}</strong></Link>{session.completedLabel && session.status === "COMPLETED" && <><br /><small className="muted">clôturé {session.completedLabel}</small></>}</td>
          <td>{session.kindLabel}</td><td>{session.startedBy}</td>
          <td className="num">{session.entries}</td><td className={`num ${session.differences ? "negative" : "muted"}`}>{session.differences}</td>
          <td><StatusBadge status={session.status === "OPEN" ? "pending" : session.status === "COMPLETED" ? "paid" : "draft"}>{session.statusLabel}</StatusBadge></td>
          <td style={{ whiteSpace: "normal" }}>{session.notes ?? <span className="muted">—</span>}</td>
        </tr>)}</tbody>
      </table></div>
        : <EmptyState title="Aucun comptage" description={canCount ? "Lancez l’inventaire initial pour fixer le point de départ de chaque ressource." : "Les comptages réalisés par les responsables apparaîtront ici."} />}
    </section>
  </div>;
}
