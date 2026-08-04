import Link from "next/link";
import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";
import { EmptyState, PageHeader, StatusBadge } from "@koeki/ui";
import { getAudit } from "@/lib/data";
import { requirePermission } from "@/lib/session";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("audit:read");
  void session;
  const query = await searchParams;
  const page = typeof query.page === "string" ? Number(query.page) || 1 : 1;
  const data = await getAudit(page);
  if (page > data.pageCount) redirect("/audit");
  return <div className="page-wrap">
    <PageHeader eyebrow="Journal immuable" title="Registre d’audit" description="Traçabilité des accès, décisions financières et changements de configuration." actions={<span className="button button-ghost"><ScrollText size={17}/> {data.total.toLocaleString("fr-FR")} écritures</span>} />
    <section className="panel">
      {data.rows.length ? <div className="table-scroll"><table><thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Entité</th><th>Résumé</th><th>Intégrité</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td>{row.at}</td><td><strong>{row.actor}</strong></td><td><code>{row.action}</code></td><td><code>{row.entity}</code></td><td>{row.summary}</td><td><StatusBadge status="paid">Scellé</StatusBadge></td></tr>)}</tbody></table></div>
        : <EmptyState title="Journal vide" description="Chaque opération sensible créera une écriture scellée ici." />}
      <footer className="table-footer"><span>Page {data.page} sur {data.pageCount}</span><div>{data.page > 1 ? <Link className="button button-ghost" href={`/audit?page=${data.page - 1}`}>Précédent</Link> : <button disabled>Précédent</button>}{data.page < data.pageCount ? <Link className="button button-ghost" href={`/audit?page=${data.page + 1}`}>Suivant</Link> : <button disabled>Suivant</button>}</div></footer>
    </section>
  </div>;
}
