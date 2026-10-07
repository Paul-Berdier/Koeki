"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ArrowUpRight } from "lucide-react";
import { EmptyState, MoneyDisplay, NinjaAvatar, StatusBadge } from "@koeki/ui";
import type { AnalyticsAgent } from "@/lib/team-analytics";

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
export function TeamAgentTable({ agents, from, to, compact = false }: { agents: AnalyticsAgent[]; from: string; to: string; compact?: boolean }) {
  const [search, setSearch] = useState(""), [state, setState] = useState("all"), [sort, setSort] = useState("name"), [page, setPage] = useState(1);
  const size = compact ? 6 : 12;
  const filtered = useMemo(() => agents.filter((agent) => normalize(agent.name).includes(normalize(search)) && (state === "all" || (state === "active" && ["ACTIVE", "RECENT", "ABSENT"].includes(agent.state)) || (state === "absent" && agent.state === "ABSENT") || (state === "attention" && (agent.tasksOverdue > 0 || agent.tasksBlocked > 0)) || (state === "idle" && agent.total === 0) || (state === "inactive" && ["LEFT", "DISABLED"].includes(agent.state)))).sort((a, b) => {
    const money = BigInt(a.collected) === BigInt(b.collected) ? 0 : BigInt(a.collected) > BigInt(b.collected) ? -1 : 1;
    return (sort === "taxes" ? money : sort === "operations" ? b.total - a.total : sort === "workload" ? b.tasksOpen - a.tasksOpen : sort === "overdue" ? b.tasksOverdue - a.tasksOverdue : 0) || a.name.localeCompare(b.name, "fr");
  }), [agents, search, state, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / size)), currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * size, currentPage * size);
  const period = new URLSearchParams({ du: from, au: to });
  return <>
    <div className="agent-filters">
      <label className="agent-search"><span className="sr-only">Rechercher un agent</span><Search size={17} aria-hidden="true" /><input type="search" placeholder="Rechercher un agent…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
      <label><span className="sr-only">Filtrer les agents</span><select value={state} onChange={(event) => { setState(event.target.value); setPage(1); }}><option value="all">Tous les agents</option><option value="active">Participation ouverte</option><option value="absent">Absence déclarée</option><option value="attention">Retard ou blocage</option><option value="idle">Aucune opération</option><option value="inactive">Sortie ou désactivation</option></select></label>
      <label><span className="sr-only">Trier les agents</span><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="name">Identité A → Z</option><option value="taxes">Taxes encaissées</option><option value="operations">Opérations</option><option value="workload">Tâches ouvertes</option><option value="overdue">Tâches en retard</option></select></label>
    </div>
    {rows.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Suivi des agents"><table className="agent-table"><thead><tr><th>Agent</th><th className="num">Opérations</th><th className="num">Taxes encaissées</th><th>Suivi du travail</th><th><span className="sr-only">Fiche</span></th></tr></thead><tbody>{rows.map((agent) => <tr key={agent.id}>
      <td><Link className="person-cell" href={`/equipe/${agent.id}?${period}`}><NinjaAvatar name={agent.name} /><span><strong>{agent.name}</strong><small>{agent.stateLabel}</small></span></Link></td>
      <td className="num" data-label="Opérations"><strong>{agent.total}</strong><small className="cell-detail">{agent.payments} P · {agent.donations} D · {agent.buybacks} R</small></td>
      <td className="num" data-label="Taxes encaissées"><MoneyDisplay amount={BigInt(agent.collected)} /><Link className="cell-detail text-link" href={`/equipe/taxes?${period}&agent=${agent.id}#recus`} aria-label={`Voir les taxes de ${agent.name}`}>Détail des taxes</Link></td>
      <td data-label="Suivi du travail"><Link href={`/taches?agent=${agent.id}`} className="cell-detail">{agent.tasksOpen} tâches ouvertes</Link>{agent.tasksOverdue > 0 || agent.tasksBlocked > 0 ? <span className="agent-alerts">{agent.tasksOverdue > 0 && <StatusBadge status="warning">{agent.tasksOverdue} en retard</StatusBadge>}{agent.tasksBlocked > 0 && <StatusBadge status="overdue">{agent.tasksBlocked} bloquées</StatusBadge>}</span> : <span className="cell-detail muted">Aucun blocage ni retard</span>}</td>
      <td><Link className="icon-link" href={`/equipe/${agent.id}?${period}`} aria-label={`Ouvrir la fiche de ${agent.name}`}><ArrowUpRight size={18} aria-hidden="true" /></Link></td>
    </tr>)}</tbody></table></div> : <EmptyState title="Aucun agent dans cette sélection" description="Essayez une autre identité ou un autre filtre." />}
    <footer className="table-footer"><span>{filtered.length} agents · {currentPage} / {pageCount}<small className="cell-detail">P : paiements · D : dons · R : rachats</small></span><div className="pagination-controls"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Précédent</button><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Suivant</button></div></footer>
  </>;
}
