import Link from "next/link";
import { EmptyState, MoneyDisplay, PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, requirePermission } from "@/lib/session";
import { getResourceValues } from "@/lib/resource-values";
import { updateValues } from "./actions";

export default async function ResourceValuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("settings:manage");
  const query = await searchParams;
  const text = (key: string) => typeof query[key] === "string" ? query[key] as string : undefined;
  const data = await getResourceValues(session, { q: text("q"), resourceId: text("ressource"), page: text("page") });
  const pageHref = (page: number) => `/resources/valeurs?${new URLSearchParams({ q: data.q, ...(text("ressource") ? { ressource: text("ressource")! } : {}), page: String(page) })}`;
  return <div className="page-wrap">
    <PageHeader eyebrow="Réglages du catalogue" title="Valeurs & tarifs" description="Modifiez le prix de rachat, les points, le crédit d’exonération et le besoin du village, sans toucher aux stocks ni aux anciens reçus."
      actions={<Link className="button button-ghost" href="/resources">Voir le catalogue</Link>} />
    {text("info") && <p className="notice" role="status">{text("info")}</p>}
    {text("erreur") && <p className="notice error" role="alert">{text("erreur")}</p>}
    {demoMode && <p className="notice">Démonstration : les écritures sont désactivées.</p>}
    <section className="panel stack-panel">
      <SectionHeader title="Rechercher une ressource" description={`${data.total} ressource(s), y compris celles désactivées`} />
      <form action="/resources/valeurs" className="filter-bar">
        <label>Nom ou code<input type="search" name="q" defaultValue={data.q} maxLength={120} /></label>
        <button className="button button-primary" type="submit">Rechercher</button>
        <Link className="button button-ghost" href="/resources/valeurs">Tout afficher</Link>
      </form>
    </section>
    <div className="settings-stack">
      {data.resources.map((resource) => <section className="panel" key={resource.id} aria-label={`Valeurs de ${resource.name}`}>
        <SectionHeader title={resource.name} description={`${resource.code} · ${resource.category} · unité : ${resource.unit}${resource.active ? "" : " · désactivée"}`} />
        <p>Prix actuel : {resource.price === null ? "Non défini" : <MoneyDisplay amount={resource.price} />} · {resource.pointsPerUnit.toLocaleString("fr-FR")} points · <MoneyDisplay amount={resource.exemptionPerUnit} /> de crédit par unité donnée.</p>
        <form action={updateValues} className="form-grid">
          <input type="hidden" name="resourceId" value={resource.id} />
          <input type="hidden" name="revision" value={resource.revision} />
          <div className="form-row">
            <label>Prix de rachat par unité (Ryō)<input type="number" name="price" min={0} max={100_000_000} step={1} defaultValue={resource.price?.toString() ?? ""} required={resource.price !== null} />
              <small className="field-help">Zéro désactive le rachat. Un prix absent peut rester vide.</small></label>
            <label>Points par unité donnée<input type="number" name="pointsPerUnit" min={0} max={1_000_000} step={1} required defaultValue={resource.pointsPerUnit} /></label>
            <label>Crédit d’exonération par unité (Ryō)<input type="number" name="exemptionPerUnit" min={0} max={100_000_000_000} step={1} required defaultValue={resource.exemptionPerUnit.toString()} /></label>
          </div>
          <div className="form-row">
            <label>Besoin du village<select name="demand" defaultValue={resource.demand}><option value="NONE">Non besoin</option><option value="NEEDED">Besoin</option><option value="CRITICAL">Besoin critique</option></select></label>
            <label>Motif du changement<input name="reason" required minLength={3} maxLength={300} placeholder="Ex. Ajustement du barème du village" /></label>
          </div>
          <p className="field-help">Les crédits déjà gagnés et les prix des opérations passées restent inchangés. Le crédit de don ne constitue pas un encaissement de taxe.</p>
          <div className="form-actions"><button className="button button-primary" type="submit">Enregistrer les valeurs de {resource.name}</button><Link className="text-link" href={`/resources/${resource.id}/modifier`}>Modifier la fiche complète</Link></div>
        </form>
      </section>)}
    </div>
    {!data.resources.length && <EmptyState title="Aucune ressource" description="Modifiez votre recherche ou consultez le catalogue." />}
    <footer className="table-footer"><span>Page {data.page} sur {data.pageCount}</span><div className="pagination-controls">{data.page > 1 && <Link href={pageHref(data.page - 1)}>Précédent</Link>}{data.page < data.pageCount && <Link href={pageHref(data.page + 1)}>Suivant</Link>}</div></footer>
  </div>;
}
