"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Filter, Search } from "lucide-react";

export function DonsFilters({ suggestions }: { suggestions: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const navigate = (next: Partial<Record<"q" | "statut", string>>) => {
    const merged = { q: next.q ?? query, statut: next.statut ?? params.get("statut") ?? "" };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) search.set(key, value);
    router.replace(search.size ? `${pathname}?${search}` : pathname, { scroll: false });
  };

  return <form method="get" className="filter-bar" aria-label="Recherche et filtres du registre des dons" style={{ margin: "0 18px 14px" }} onSubmit={(event) => { event.preventDefault(); navigate({}); }}>
    <datalist id="dons-suggestions">{suggestions.map((entry) => <option key={entry} value={entry} />)}</datalist>
    <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Rechercher un don</span>
      <input type="search" name="q" value={query} list="dons-suggestions" placeholder="Ninja, objet ou reçu (Aoki, Fer, DON-…)" autoComplete="off"
        onChange={(event) => { const value = event.target.value; setQuery(value); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => navigate({ q: value }), 250); }} />
    </label>
    <label className="sr-only" htmlFor="filter-don-statut">Statut</label>
    <select id="filter-don-statut" name="statut" className="button button-ghost" defaultValue={params.get("statut") ?? ""} onChange={(event) => navigate({ statut: event.target.value })}>
      <option value="">Tous statuts</option><option value="valides">Validés</option><option value="attente">En attente</option>
    </select>
    <button className="button button-ghost" type="submit"><Filter size={17} /> Filtrer</button>
  </form>;
}
