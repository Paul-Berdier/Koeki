import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, MoneyDisplay, StatusBadge } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";
import { getRecovery } from "@/lib/data";
import { hasPermission, requireSession } from "@/lib/session";

export default async function RecoveryPage() {
  const session = await requireSession();
  if (!hasPermission(session, "payments:write") && !hasPermission(session, "audit:read")) redirect("/access-denied");
  const data = await getRecovery();
  return <ModulePage eyebrow="File de suivi" title="Recouvrement" description="Dossiers à relancer, classés par ancienneté et exposition." registerDescription="Dette calculée depuis les écritures réelles" metrics={[
    { label: "Dette prioritaire", value: <MoneyDisplay amount={data.metrics.priorityDebt} />, detail: `${data.metrics.priorityCount} dossier${data.metrics.priorityCount > 1 ? "s" : ""} critiques`, tone: data.metrics.priorityCount ? "danger" : "good" },
    { label: "Retard moyen", value: data.metrics.averageLate, detail: "Sur les dossiers ouverts", tone: data.rows.length ? "warn" : "good" },
    { label: "Dette en retard", value: <MoneyDisplay amount={data.metrics.totalDebt} />, detail: `${data.rows.length} dossier${data.rows.length > 1 ? "s" : ""} ouverts` },
    { label: "Sans agent", value: String(data.metrics.unassigned), detail: data.metrics.unassigned ? "À attribuer aujourd’hui" : "Tous les dossiers sont suivis" }
  ]}>{data.rows.length ? <div className="table-scroll"><table><thead><tr><th>Priorité</th><th>Ninja</th><th>Dette</th><th>Ancienneté</th><th>Agent</th><th>État</th></tr></thead><tbody>{data.rows.map((row, index) => <tr key={row.id}><td><strong>{String(index + 1).padStart(2, "0")}</strong></td><td><Link href={`/ninjas/${row.id}`}><strong>{row.name}</strong><br/><code>{row.code}</code></Link></td><td className="negative"><MoneyDisplay amount={row.debt} /></td><td>{row.due}</td><td>{row.agent}</td><td><StatusBadge status="overdue">Relance requise</StatusBadge></td></tr>)}</tbody></table></div>
    : <EmptyState title="Aucun dossier en retard" description="Tous les ninjas actifs sont à jour de leurs taxes." />}</ModulePage>;
}
