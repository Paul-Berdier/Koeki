import Link from "next/link";
import { ArrowLeft, Download, Filter, Search } from "lucide-react";
import { PageHeader } from "@koeki/ui";
import { MovementTable } from "@/components/inventory/movement-table";
import { getMovementJournal } from "@/lib/inventory-data";
import type { JournalFilters } from "@/lib/inventory-types";
import { demoMode, hasPermission, requirePermission } from "@/lib/session";
import { reverseMovementAction } from "../actions";

const pick = (query: Record<string, string | string[] | undefined>, key: string) => (typeof query[key] === "string" && query[key] ? (query[key] as string) : undefined);

export default async function MovementJournalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("inventory:read");
  const query = await searchParams;
  const filters: JournalFilters = {
    q: pick(query, "q"), ressource: pick(query, "ressource"), categorie: pick(query, "categorie"), type: pick(query, "type"), sens: pick(query, "sens"),
    agent: pick(query, "agent"), ninja: pick(query, "ninja"), du: pick(query, "du"), au: pick(query, "au"), motif: pick(query, "motif"), origine: pick(query, "origine"),
    page: Number(pick(query, "page")) || 1
  };
  const data = await getMovementJournal(session, filters);
  const canAdjust = !demoMode && hasPermission(session, "inventory:adjust");
  const canExport = hasPermission(session, "inventory:export");
  const active = Object.entries(filters).filter(([key, value]) => key !== "page" && value);
  const search = new URLSearchParams(active.map(([key, value]) => [key, String(value)]));
  const pageQuery = (target: number) => { const next = new URLSearchParams(search); next.set("page", String(target)); return `/inventory/movements?${next}`; };
  return <div className="page-wrap">
    <PageHeader eyebrow="Traçabilité" title="Journal des mouvements" description="Chaque ligne dit ce qui s’est passé : quoi, combien, avant et après, qui a donné ou pris, quel agent a enregistré, pourquoi et quand."
      metrics={[{ label: "Mouvements", value: data.total.toLocaleString("fr-FR") }, { label: "Page", value: `${data.page} / ${data.pageCount}` }]}
      actions={<>{canExport && <a className="button button-ghost" href={`/api/inventory/export?type=movements&${search}`}><Download size={17} aria-hidden="true" /> Exporter CSV</a>}<Link className="button button-ghost" href="/inventory"><ArrowLeft size={17} aria-hidden="true" /> Inventaire</Link></>} />
    <form method="get" className="filter-bar journal-filters" aria-label="Filtres du journal">
      <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Recherche libre</span><input type="search" name="q" defaultValue={filters.q ?? ""} placeholder="Aoki, Fer, DON-2026-000412, fabrication…" /></label>
      <label className="sr-only" htmlFor="journal-resource">Ressource</label>
      <select id="journal-resource" name="ressource" className="button button-ghost" defaultValue={filters.ressource ?? ""}><option value="">Toutes ressources</option>{data.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select>
      <label className="sr-only" htmlFor="journal-category">Catégorie</label>
      <select id="journal-category" name="categorie" className="button button-ghost" defaultValue={filters.categorie ?? ""}><option value="">Toutes catégories</option>{data.categories.map((category) => <option key={category.code} value={category.code}>{category.label}</option>)}</select>
      <label className="sr-only" htmlFor="journal-type">Type</label>
      <select id="journal-type" name="type" className="button button-ghost" defaultValue={filters.type ?? ""}><option value="">Tous types</option>{data.types.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</select>
      <label className="sr-only" htmlFor="journal-direction">Sens</label>
      <select id="journal-direction" name="sens" className="button button-ghost" defaultValue={filters.sens ?? ""}><option value="">Entrées et sorties</option><option value="in">Entrées</option><option value="out">Sorties</option></select>
      <label className="sr-only" htmlFor="journal-agent">Agent</label>
      <select id="journal-agent" name="agent" className="button button-ghost" defaultValue={filters.agent ?? ""}><option value="">Tous agents</option>{data.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
      <label className="sr-only" htmlFor="journal-ninja">Ninja</label>
      <select id="journal-ninja" name="ninja" className="button button-ghost" defaultValue={filters.ninja ?? ""}><option value="">Tous ninjas</option>{data.ninjas.map((ninja) => <option key={ninja.id} value={ninja.id}>{ninja.name}</option>)}</select>
      <label className="sr-only" htmlFor="journal-source">Origine</label>
      <select id="journal-source" name="origine" className="button button-ghost" defaultValue={filters.origine ?? ""}><option value="">Toutes origines</option>{data.sources.map((source) => <option key={source.code} value={source.code}>{source.label}</option>)}</select>
      <label className="report-date-filter">Du <input type="date" name="du" defaultValue={filters.du ?? ""} /></label>
      <label className="report-date-filter">Au <input type="date" name="au" defaultValue={filters.au ?? ""} /></label>
      <label className="sr-only" htmlFor="journal-reason">Motif</label>
      <input id="journal-reason" name="motif" className="journal-reason-filter" defaultValue={filters.motif ?? ""} placeholder="Motif ou note" />
      <button className="button button-ghost" type="submit"><Filter size={17} aria-hidden="true" /> Filtrer</button>
      {active.length > 0 && <Link className="button button-ghost" href="/inventory/movements">Réinitialiser</Link>}
    </form>
    <section className="panel">
      <MovementTable rows={data.rows} showResource reverseAction={reverseMovementAction} canOverride={canAdjust} />
      <footer className="table-footer"><span>{data.total.toLocaleString("fr-FR")} mouvement{data.total > 1 ? "s" : ""} · page {data.page} sur {data.pageCount}</span><div>{data.page > 1 ? <Link className="button button-ghost" href={pageQuery(data.page - 1)}>Précédent</Link> : <button disabled>Précédent</button>}{data.page < data.pageCount ? <Link className="button button-ghost" href={pageQuery(data.page + 1)}>Suivant</Link> : <button disabled>Suivant</button>}</div></footer>
    </section>
  </div>;
}
