import { Filter, Grid2X2, List, Plus, Search, SlidersHorizontal } from "lucide-react";
import { GradeBadge, MoneyDisplay, NinjaAvatar, PageHeader, PointDisplay, StatusBadge } from "@koeki/ui";
import { ninjas } from "@/lib/demo-data";

export default function NinjasPage() {
  return <div className="page-wrap">
    <PageHeader eyebrow="Registre administratif" title="Ninjas" description="7 dossiers fictifs · 3 à jour · 3 en retard · 138 000 Ryō dus"
      actions={<button className="button button-primary"><Plus size={17} /> Nouveau ninja</button>} />
    <section className="filter-bar" aria-label="Recherche et filtres">
      <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Rechercher un ninja</span><input type="search" placeholder="Nom, prénom, code ou pseudonyme…" /></label>
      <button className="button button-ghost"><Filter size={17} /> Grade <span className="count">2</span></button>
      <button className="button button-ghost"><SlidersHorizontal size={17} /> Situation fiscale</button>
      <div className="view-switch" aria-label="Mode d’affichage"><button aria-label="Vue en cartes"><Grid2X2 size={17} /></button><button className="active" aria-label="Vue en tableau"><List size={17} /></button></div>
    </section>

    <section className="panel ninja-table-panel">
      <div className="table-scroll"><table className="ninja-table"><thead><tr><th>Ninja</th><th>Grade</th><th>Situation</th><th>Dette</th><th>Points</th><th>Agent</th><th>Échéance</th></tr></thead><tbody>{ninjas.map((ninja) => <tr key={ninja.code} tabIndex={0}><td><div className="person-cell"><NinjaAvatar name={ninja.name} /><span><strong>{ninja.name}</strong><small>{ninja.code}{ninja.alias && ` · ${ninja.alias}`}</small></span></div></td><td><GradeBadge>{ninja.grade}</GradeBadge></td><td><StatusBadge status={ninja.status}>{ninja.status === "paid" ? "À jour" : ninja.status === "overdue" ? "En retard" : ninja.status === "due" ? "À payer" : "Échéance proche"}</StatusBadge></td><td className={ninja.debt > 0 ? "negative" : "muted"}>{ninja.debt ? <MoneyDisplay amount={ninja.debt} /> : "Aucune"}</td><td><PointDisplay points={ninja.points} /></td><td>{ninja.agent}</td><td>{ninja.due}</td></tr>)}</tbody></table></div>
      <footer className="table-footer"><span>1–7 sur 7 ninjas</span><div><button disabled>Précédent</button><button disabled>Suivant</button></div></footer>
    </section>

    <section className="ninja-card-grid" aria-label="Vue mobile des ninjas">{ninjas.map((ninja) => <article className="ninja-card" key={ninja.code}><header><div className="person-cell"><NinjaAvatar name={ninja.name} /><span><strong>{ninja.name}</strong><small>{ninja.code}</small></span></div><StatusBadge status={ninja.status} /></header><div><span><small>Grade</small><GradeBadge>{ninja.grade}</GradeBadge></span><span><small>Dette</small><strong className={ninja.debt ? "negative" : "muted"}>{ninja.debt ? <MoneyDisplay amount={ninja.debt} /> : "Aucune"}</strong></span><span><small>Points</small><PointDisplay points={ninja.points} /></span></div></article>)}</section>
  </div>;
}
