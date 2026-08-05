"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Filter, Search } from "lucide-react";

export function NinjaFilters({ grades }: { grades: Array<{ code: string; label: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const navigate = (next: Partial<Record<"q" | "grade" | "statut", string>>) => {
    const merged = { q: next.q ?? query, grade: next.grade ?? params.get("grade") ?? "", statut: next.statut ?? params.get("statut") ?? "" };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) search.set(key, value);
    router.replace(search.size ? `${pathname}?${search}` : pathname, { scroll: false });
  };

  return <form method="get" className="filter-bar" aria-label="Recherche et filtres" onSubmit={(event) => { event.preventDefault(); navigate({}); }}>
    <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Rechercher un ninja</span>
      <input type="search" name="q" value={query} placeholder="Nom, prénom, code ou pseudonyme…" autoComplete="off"
        onChange={(event) => { const value = event.target.value; setQuery(value); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => navigate({ q: value }), 250); }} />
    </label>
    <label className="sr-only" htmlFor="filter-grade">Grade</label>
    <select id="filter-grade" name="grade" className="button button-ghost" defaultValue={params.get("grade") ?? ""} onChange={(event) => navigate({ grade: event.target.value })}>
      <option value="">Tous les grades</option>{grades.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
    </select>
    <label className="sr-only" htmlFor="filter-statut">Situation fiscale</label>
    <select id="filter-statut" name="statut" className="button button-ghost" defaultValue={params.get("statut") ?? ""} onChange={(event) => navigate({ statut: event.target.value })}>
      <option value="">Toutes situations</option><option value="paid">À jour</option><option value="due">À payer</option><option value="warning">Échéance proche / reprise</option><option value="overdue">En retard</option>
    </select>
    <button className="button button-ghost" type="submit"><Filter size={17} /> Filtrer</button>
  </form>;
}
