import Link from "next/link";
import { Filter, ScrollText, Search } from "lucide-react";
import { EmptyState, PageHeader, StatusBadge } from "@koeki/ui";
import { auditCategories, getAudit } from "@/lib/data";
import { requirePermission } from "@/lib/session";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("audit:read");
  const query = await searchParams;
  const page = typeof query.page === "string" ? Number(query.page) || 1 : 1;
  const filters = {
    categorie: typeof query.categorie === "string" && query.categorie ? query.categorie : undefined,
    q: typeof query.q === "string" && query.q ? query.q : undefined,
    acteur: typeof query.acteur === "string" && query.acteur ? query.acteur : undefined
  };
  const data = await getAudit(page, filters);
  const pageQuery = (target: number) => `?${new URLSearchParams({ ...(filters.categorie ? { categorie: filters.categorie } : {}), ...(filters.q ? { q: filters.q } : {}), ...(filters.acteur ? { acteur: filters.acteur } : {}), page: String(target) })}`;
  return <div className="page-wrap">
    <PageHeader eyebrow="Journal immuable" title="Registre d’audit" description="Traçabilité des accès, décisions financières et changements de configuration." actions={<span className="button button-ghost"><ScrollText size={17}/> {data.total.toLocaleString("fr-FR")} écritures</span>} />
    <form method="get" className="filter-bar" aria-label="Filtres du registre">
      <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Rechercher</span><input type="search" name="q" defaultValue={filters.q ?? ""} placeholder="Action, référence, motif (PAY-2026, NINJA_CREATED…)" /></label>
      <label className="sr-only" htmlFor="filter-categorie">Thème</label>
      <select id="filter-categorie" name="categorie" className="button button-ghost" defaultValue={filters.categorie ?? ""}>
        <option value="">Tous les thèmes</option>
        {Object.entries(auditCategories).map(([code, category]) => <option key={code} value={code}>{category.label}</option>)}
      </select>
      <label className="sr-only" htmlFor="filter-acteur">Auteur</label>
      <select id="filter-acteur" name="acteur" className="button button-ghost" defaultValue={filters.acteur ?? ""}>
        <option value="">Tous les auteurs</option>
        {data.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
      </select>
      <button className="button button-ghost" type="submit"><Filter size={17} /> Filtrer</button>
    </form>
    <section className="panel">
      {data.rows.length ? <div className="table-scroll"><table><thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Entité</th><th>Résumé</th><th>Intégrité</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td>{row.at}</td><td><strong>{row.actor}</strong></td><td><code>{row.action}</code></td><td><code>{row.entity}</code></td><td style={{ whiteSpace: "normal" }}>{row.summary}</td><td><StatusBadge status="paid">Scellé</StatusBadge></td></tr>)}</tbody></table></div>
        : <EmptyState title="Aucune écriture" description="Aucune entrée ne correspond à ces filtres." />}
      <footer className="table-footer"><span>Page {data.page} sur {data.pageCount}</span><div>{data.page > 1 ? <Link className="button button-ghost" href={pageQuery(data.page - 1)}>Précédent</Link> : <button disabled>Précédent</button>}{data.page < data.pageCount ? <Link className="button button-ghost" href={pageQuery(data.page + 1)}>Suivant</Link> : <button disabled>Suivant</button>}</div></footer>
    </section>
  </div>;
}
