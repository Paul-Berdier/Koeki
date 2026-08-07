"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Filter, Search } from "lucide-react";

export function CraftingFilters({ categories, names }: { categories: string[]; names: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const navigate = (next: Partial<Record<"q" | "categorie", string>>) => {
    const merged = { q: next.q ?? query, categorie: next.categorie ?? params.get("categorie") ?? "" };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) search.set(key, value);
    router.replace(search.size ? `${pathname}?${search}` : pathname, { scroll: false });
  };

  return <form method="get" className="filter-bar" aria-label="Recherche et filtres des recettes" style={{ margin: "12px 18px 0" }} onSubmit={(event) => { event.preventDefault(); navigate({}); }}>
    <datalist id="recettes-noms">{names.map((name) => <option key={name} value={name} />)}</datalist>
    <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Rechercher une recette</span>
      <input type="search" name="q" value={query} list="recettes-noms" placeholder="Recette, code ou ingrédient (Gant T3, Fer…)" autoComplete="off"
        onChange={(event) => { const value = event.target.value; setQuery(value); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => navigate({ q: value }), 250); }} />
    </label>
    <label className="sr-only" htmlFor="filter-recette-categorie">Catégorie</label>
    <select id="filter-recette-categorie" name="categorie" className="button button-ghost" defaultValue={params.get("categorie") ?? ""} onChange={(event) => navigate({ categorie: event.target.value })}>
      <option value="">Toutes catégories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}
    </select>
    <button className="button button-ghost" type="submit"><Filter size={17} /> Filtrer</button>
  </form>;
}
