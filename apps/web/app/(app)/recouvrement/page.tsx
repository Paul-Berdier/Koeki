import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, MoneyDisplay, StatusBadge } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";
import { getRecovery } from "@/lib/data";
import { demoMode, hasPermission, requireSession } from "@/lib/session";

export default async function RecoveryPage() {
  const session = await requireSession();
  if (!hasPermission(session, "payments:write") && !hasPermission(session, "business:read")) redirect("/access-denied");
  const data = await getRecovery();
  const canCreateReminder = !demoMode && hasPermission(session, "tasks:manage");
  return <ModulePage eyebrow="Opérations" title="Recouvrement" description="Tous les agents peuvent encaisser une taxe ou relancer n’importe quel ninja. Aucun dossier n’est réservé."
    registerTitle="Dossiers à relancer" registerDescription="Ordre de priorité : ancienneté et dette."
    registerAction={hasPermission(session, "team:read") ? <Link className="text-link" href="/equipe/taxes">Taxes recouvrées par agent</Link> : undefined}
    metrics={[{ label: "Dette prioritaire", value: <MoneyDisplay amount={data.metrics.priorityDebt} />, detail: `${data.metrics.priorityCount} dossiers critiques`, tone: data.metrics.priorityCount ? "danger" : "good" }, { label: "Retard moyen", value: data.metrics.averageLate, detail: "Sur les dossiers ouverts", tone: data.rows.length ? "warn" : "good" }, { label: "Dette en retard", value: <MoneyDisplay amount={data.metrics.totalDebt} />, detail: `${data.rows.length} dossiers ouverts` }, { label: "Reprise à régulariser", value: String(data.metrics.unassigned), detail: data.metrics.unassigned ? "Impayés de l’ancien registre" : "Aucun dossier hérité", tone: data.metrics.unassigned ? "warn" : "good" }]}>
    {data.rows.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Dossiers de recouvrement"><table><thead><tr><th scope="col">Dossier</th><th scope="col" className="num">Dette</th><th scope="col">Situation</th><th scope="col">Action</th></tr></thead><tbody>{data.rows.map((row, index) => <tr key={row.id}><th scope="row"><div className="person-cell"><span className="queue-position">{String(index + 1).padStart(2, "0")}</span><Link className="ninja-record-link" href={`/ninjas/${row.id}`}><strong>{row.name}</strong><small className="cell-detail">{row.code}</small></Link></div></th><td className={`num ${row.debt > 0n ? "negative" : "muted"}`}>{row.debt > 0n ? <MoneyDisplay amount={row.debt} /> : "Ancien registre"}</td><td><StatusBadge status={row.debt > 0n ? "overdue" : "warning"}>{row.debt > 0n ? "Relance requise" : "Reprise à régulariser"}</StatusBadge><small className="cell-detail">{row.due}</small></td><td><div className="work-row-actions"><Link className="button button-ghost" href={`/ninjas/${row.id}`}>Ouvrir le dossier</Link>{canCreateReminder && <Link className="text-link" href={`/taches?nouvelle=1&ninjaId=${encodeURIComponent(row.id)}`}>Créer une relance</Link>}</div></td></tr>)}</tbody></table></div> : <EmptyState title="Aucun dossier en retard" description="Tous les ninjas actifs sont à jour de leurs taxes." />}
  </ModulePage>;
}
