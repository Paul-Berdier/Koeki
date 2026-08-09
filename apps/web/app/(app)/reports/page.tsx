import { redirect } from "next/navigation";
import { CheckCircle2, Undo2 } from "lucide-react";
import { EmptyState, MoneyDisplay, StatusBadge } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";
import { getReports } from "@/lib/data";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { reviewReport } from "./actions";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!hasPermission(session, "reports:write") && !hasPermission(session, "audit:read")) redirect("/access-denied");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const canReview = !demoMode && session.roles.some((role) => role === "SUPER_ADMIN" || role === "KOEKI_MANAGER");
  const canWrite = !demoMode && hasPermission(session, "reports:write");
  const data = await getReports(session, canReview);
  return <ModulePage eyebrow="Suivi des agents" title="Rapports" description="Les chiffres d’activité sont préremplis depuis les écritures réelles — l’agent ne ressaisit rien."
    actionLabel={canWrite ? "Nouveau rapport" : undefined} actionHref="/reports/new" registerDescription="Rapports d’activité par période" metrics={[
    { label: "À examiner", value: String(data.metrics.toReview), detail: data.metrics.toReview ? "Soumis par les agents" : "Rien en attente", tone: data.metrics.toReview ? "warn" : "good" },
    { label: "Approuvés", value: String(data.metrics.approved), detail: "Validés par un responsable", tone: "good" },
    { label: "Opérations couvertes", value: String(data.metrics.covered), detail: "Paiements, dons et rachats" },
    { label: "Montant traité", value: <MoneyDisplay amount={data.metrics.processed} />, detail: `${data.metrics.corrections} correction${data.metrics.corrections > 1 ? "s" : ""}` }
  ]}>
    {error && <p className="notice error" role="alert" style={{ margin: "12px 20px 0" }}>{error}</p>}
    {data.reports.length ? <div className="table-scroll"><table><thead><tr><th>Période</th><th>Agent</th><th>Paiements</th><th>Dons / rachats</th><th>Montant traité</th><th>Statut</th>{canReview && <th>Décision</th>}</tr></thead><tbody>{data.reports.map((report) => <tr key={report.id}><td>{report.period}</td><td><strong>{report.agent}</strong></td><td>{report.payments}</td><td>{report.donationBuybacks}</td><td><MoneyDisplay amount={report.processed} /></td><td><StatusBadge status={report.badge}>{report.statusLabel}</StatusBadge></td>{canReview && <td>{report.canReview ? <span style={{ display: "inline-flex", gap: 6 }}><form action={reviewReport}><input type="hidden" name="reportId" value={report.id} /><input type="hidden" name="intent" value="approve" /><button className="button button-ghost" style={{ minHeight: 30 }} type="submit"><CheckCircle2 size={14} /> Approuver</button></form><form action={reviewReport}><input type="hidden" name="reportId" value={report.id} /><input type="hidden" name="intent" value="return" /><button className="button button-ghost" style={{ minHeight: 30 }} type="submit"><Undo2 size={14} /> Renvoyer</button></form></span> : <span className="muted">—</span>}</td>}</tr>)}</tbody></table></div>
      : <EmptyState title="Aucun rapport" description="Créez un rapport de période : les totaux se remplissent automatiquement." />}
  </ModulePage>;
}
