"use client";

import { useState, type ReactNode } from "react";

/** Onglets de page de détail — le contenu est rendu côté serveur et simplement masqué,
 *  les formulaires gardent donc leur état quand on change d'onglet. */
export function DetailTabs({ tabs }: { tabs: Array<{ id: string; label: string; count?: number | undefined; content: ReactNode }> }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  return <>
    <div className="tabs-bar" role="tablist" aria-label="Sections du dossier">
      {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} className={active === tab.id ? "active" : ""} onClick={() => setActive(tab.id)}>
        {tab.label}{tab.count !== undefined && <b aria-label={`${tab.count} éléments`}>{tab.count}</b>}
      </button>)}
    </div>
    {tabs.map((tab) => <div key={tab.id} role="tabpanel" hidden={active !== tab.id}>{tab.content}</div>)}
  </>;
}
