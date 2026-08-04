"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Filter, Search } from "lucide-react";

export function ResourceFilters({ categories }: { categories: Array<{ code: string; label: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const navigate = (next: Partial<Record<"q" | "categorie" | "besoin" | "etat", string>>) => {
    const merged = { q: next.q ?? query, categorie: next.categorie ?? params.get("categorie") ?? "", besoin: next.besoin ?? params.get("besoin") ?? "", etat: next.etat ?? params.get("etat") ?? "" };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) search.set(key, value);
    router.replace(search.size ? `${pathname}?${search}` : pathname, { scroll: false });
  };

  return <form method="get" className="filter-bar" aria-label="Recherche et filtres du catalogue" style={{ margin: "12px 18px 0" }} onSubmit={(event) => { event.preventDefault(); navigate({}); }}>
    <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Rechercher une ressource</span>
      <input type="search" name="q" value={query} placeholder="Nom ou code (Fer, Plan Bague T4, RES-…)" autoComplete="off"
        onChange={(event) => { const value = event.target.value; setQuery(value); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => navigate({ q: value }), 250); }} />
    </label>
    <label className="sr-only" htmlFor="filter-categorie">Catégorie</label>
    <select id="filter-categorie" name="categorie" className="button button-ghost" defaultValue={params.get("categorie") ?? ""} onChange={(event) => navigate({ categorie: event.target.value })}>
      <option value="">Toutes catégories</option>{categories.map((category) => <option key={category.code} value={category.code}>{category.label}</option>)}
    </select>
    <label className="sr-only" htmlFor="filter-besoin">Besoin du village</label>
    <select id="filter-besoin" name="besoin" className="button button-ghost" defaultValue={params.get("besoin") ?? ""} onChange={(event) => navigate({ besoin: event.target.value })}>
      <option value="">Tous besoins</option><option value="CRITICAL">Critique</option><option value="NEEDED">Besoin</option><option value="NONE">Non besoin</option>
    </select>
    <label className="sr-only" htmlFor="filter-etat">État</label>
    <select id="filter-etat" name="etat" className="button button-ghost" defaultValue={params.get("etat") ?? ""} onChange={(event) => navigate({ etat: event.target.value })}>
      <option value="">Actives</option><option value="inactives">Inactives</option><option value="toutes">Toutes</option>
    </select>
    <button className="button button-ghost" type="submit"><Filter size={17} /> Filtrer</button>
  </form>;
}
