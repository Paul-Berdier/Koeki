import Link from "next/link";
import type { TeamAnalytics } from "@/lib/team-analytics";

export function TaskWorkload({ rows }: { rows: TeamAnalytics["workload"] }) {
  const sorted = [...rows].sort((a, b) => b.tasksOpen - a.tasksOpen || a.name.localeCompare(b.name, "fr")).slice(0, 6);
  const maximum = Math.max(1, ...sorted.map((row) => row.tasksOpen));
  return <div className="workload-chart"><ul>{sorted.map((row) => <li key={row.id}><div><Link href={`/taches?agent=${row.id}`}>{row.name}</Link><strong>{row.tasksOpen}</strong></div><div className="load-track" aria-hidden="true"><span style={{ width: `${row.tasksOpen / maximum * 100}%` }} /></div></li>)}</ul><p className="chart-caption">Tâches de suivi actuellement ouvertes, sans attribution de ninjas. Tous les agents restent libres d’intervenir sur le registre partagé.</p></div>;
}
