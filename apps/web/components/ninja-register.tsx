"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowRight, Filter, LayoutGrid, Rows3, Search } from "lucide-react";
import { EmptyState, GradeBadge, MoneyDisplay, NinjaAvatar, PointDisplay, StatusBadge } from "@koeki/ui";
import type { BadgeStatus } from "@/lib/format";
import { matchesNinjaQuery } from "@/lib/ninja-search";

/** Serialisable register row (the debt travels as a string: bigint cannot cross the RSC boundary). */
export interface NinjaRegisterRow { id: string; code: string; name: string; alias: string | null; grade: string; points: number; debt: string; badge: BadgeStatus; statusLabel: string; agent: string; due: string }

const readView = () => { try { return localStorage.getItem("koeki.ninjas.view") === "cards" ? "cards" : "table"; } catch { return "table"; } };
const storeView = (view: "table" | "cards") => { try { localStorage.setItem("koeki.ninjas.view", view); } catch { /* private mode */ } };

/** The register is loaded once; the search filters it in the browser instantly. Only the grade
 *  and situation selects reload from the server (they change which dossiers are loaded). The
 *  typed query is mirrored in the URL through history.replaceState so links stay shareable —
 *  never through a navigation, which used to re-render the whole register on every keystroke. */
export function NinjaRegister({ ninjas, grades, initialQuery, initialGrade, initialStatut }: {
  ninjas: NinjaRegisterRow[]; grades: Array<{ code: string; label: string }>; initialQuery: string; initialGrade: string; initialStatut: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);
  const [view, setView] = useState<"table" | "cards">("table");
  const [mounted, setMounted] = useState(false);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    setMounted(true);
    setView(readView());
    const media = window.matchMedia("(max-width: 820px)");
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    if (!mounted) return;
    const search = new URLSearchParams(window.location.search);
    if (query) search.set("q", query); else search.delete("q");
    window.history.replaceState(window.history.state, "", search.size ? `${pathname}?${search}` : pathname);
  }, [query, mounted, pathname]);

  const visible = useMemo(() => ninjas.filter((row) => matchesNinjaQuery(row, deferredQuery)), [ninjas, deferredQuery]);
  const pickView = (next: "table" | "cards") => { setView(next); storeView(next); };
  const navigate = (next: { grade?: string; statut?: string }) => {
    const search = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(next)) { if (value) search.set(key, value); else search.delete(key); }
    router.replace(search.size ? `${pathname}?${search}` : pathname, { scroll: false });
  };
  // Server render and first client render show both views (CSS picks one, JavaScript optional);
  // once mounted only the active view stays in the DOM.
  const showTable = !mounted || (!narrow && view === "table");
  const showCards = !mounted || narrow || view === "cards";
  const count = visible.length;

  return <div className={view === "cards" ? "cards-mode" : ""}>
    <form method="get" className="filter-bar" aria-label="Recherche et filtres" onSubmit={(event) => event.preventDefault()}>
      <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Rechercher un ninja</span>
        <input type="search" name="q" value={query} placeholder="Nom, prénom, code ou pseudonyme…" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label className="sr-only" htmlFor="filter-grade">Grade</label>
      <select id="filter-grade" name="grade" className="button button-ghost" defaultValue={initialGrade} onChange={(event) => navigate({ grade: event.target.value })}>
        <option value="">Tous les grades</option>{grades.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
      </select>
      <label className="sr-only" htmlFor="filter-statut">Situation du ninja</label>
      <select id="filter-statut" name="statut" className="button button-ghost" defaultValue={initialStatut} onChange={(event) => navigate({ statut: event.target.value })}>
        <option value="">Toutes situations</option><option value="grade_missing">Grade à mettre à jour</option><option value="paid">À jour</option><option value="due">À payer</option><option value="warning">Échéance proche / reprise</option><option value="overdue">En retard</option><option value="inactive">Inactifs</option><option value="deceased">Décédés</option><option value="archived">Archivés</option>
      </select>
      <button className="button button-ghost" type="submit"><Filter size={17} /> Filtrer</button>
    </form>
    <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 10px" }}>
      <div className="view-switch" role="group" aria-label="Mode d’affichage du registre">
        <button type="button" className={view === "table" ? "active" : ""} aria-pressed={view === "table"} onClick={() => pickView("table")} title="Vue tableau"><Rows3 size={16} aria-hidden="true" /><span className="sr-only">Tableau</span></button>
        <button type="button" className={view === "cards" ? "active" : ""} aria-pressed={view === "cards"} onClick={() => pickView("cards")} title="Vue cartes"><LayoutGrid size={16} aria-hidden="true" /><span className="sr-only">Cartes</span></button>
      </div>
    </div>
    {showTable && <section className="panel ninja-table-panel">
      {visible.length ? <div className="table-scroll"><table className="ninja-table"><thead><tr><th>Ninja</th><th>Grade</th><th>Situation</th><th className="num">Dette</th><th className="num">Points</th><th>Agent</th><th>Échéance</th></tr></thead><tbody>{visible.map((ninja) => <tr key={ninja.code}><td><Link href={`/ninjas/${ninja.id}`} className="person-cell" prefetch={false}><NinjaAvatar name={ninja.name} /><span><strong>{ninja.name}</strong><small>{ninja.code}{ninja.alias && ` · ${ninja.alias}`}</small></span></Link></td><td><GradeBadge>{ninja.grade}</GradeBadge></td><td><StatusBadge status={ninja.badge}>{ninja.statusLabel}</StatusBadge></td><td className={`num ${ninja.debt !== "0" ? "negative" : "muted"}`}>{ninja.debt !== "0" ? <MoneyDisplay amount={BigInt(ninja.debt)} /> : "Aucune"}</td><td className="num"><PointDisplay points={ninja.points} /></td><td>{ninja.agent}</td><td>{ninja.due}</td></tr>)}</tbody></table></div>
        : <EmptyState title="Aucun ninja trouvé" description="Ajustez la recherche ou les filtres — ou créez un nouveau dossier." />}
    </section>}
    {showCards && <section className="ninja-card-grid" aria-label="Registre des ninjas en cartes">{visible.map((ninja) => <article className="ninja-card" key={ninja.code}>
      <header><Link href={`/ninjas/${ninja.id}`} className="person-cell" prefetch={false}><NinjaAvatar name={ninja.name} /><span><strong>{ninja.name}</strong><small>{ninja.code}</small></span></Link><StatusBadge status={ninja.badge}>{ninja.statusLabel}</StatusBadge></header>
      <div>
        <span><small>Grade</small><GradeBadge>{ninja.grade}</GradeBadge></span>
        <span><small>Dette</small><strong className={ninja.debt !== "0" ? "negative" : "muted"}>{ninja.debt !== "0" ? <MoneyDisplay amount={BigInt(ninja.debt)} /> : "Aucune"}</strong></span>
        <span><small>Points</small><PointDisplay points={ninja.points} /></span>
      </div>
      <div style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
        <span><small>Échéance</small><strong className="muted" style={{ fontWeight: 400 }}>{ninja.due}</strong></span>
        <Link className="text-link" href={`/ninjas/${ninja.id}`} prefetch={false}>Voir <ArrowRight size={13} /></Link>
      </div>
    </article>)}</section>}
    <footer className="panel table-footer ninja-register-footer" aria-live="polite"><span>{count ? `${count.toLocaleString("fr-FR")} ninja${count > 1 ? "s" : ""} affiché${count > 1 ? "s" : ""}${count !== ninjas.length ? ` sur ${ninjas.length.toLocaleString("fr-FR")}` : ""} · chaque nom ouvre son dossier` : "0 ninja"}</span></footer>
  </div>;
}
