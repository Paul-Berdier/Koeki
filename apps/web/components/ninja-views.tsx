"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";

/** Bascule table / cartes du registre des ninjas — préférence mémorisée par navigateur.
 *  Les deux vues sont rendues côté serveur ; seule la visibilité change (CSS .cards-mode). */
export function NinjaViews({ table, cards }: { table: ReactNode; cards: ReactNode }) {
  const [view, setView] = useState<"table" | "cards">("table");
  useEffect(() => { if (localStorage.getItem("koeki.ninjas.view") === "cards") setView("cards"); }, []);
  const pick = (next: "table" | "cards") => { setView(next); localStorage.setItem("koeki.ninjas.view", next); };
  return <div className={view === "cards" ? "cards-mode" : ""}>
    <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 10px" }}>
      <div className="view-switch" role="group" aria-label="Mode d’affichage du registre">
        <button type="button" className={view === "table" ? "active" : ""} aria-pressed={view === "table"} onClick={() => pick("table")} title="Vue tableau"><Rows3 size={16} aria-hidden="true" /><span className="sr-only">Tableau</span></button>
        <button type="button" className={view === "cards" ? "active" : ""} aria-pressed={view === "cards"} onClick={() => pick("cards")} title="Vue cartes"><LayoutGrid size={16} aria-hidden="true" /><span className="sr-only">Cartes</span></button>
      </div>
    </div>
    {table}
    {cards}
  </div>;
}
